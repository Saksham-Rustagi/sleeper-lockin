// P10 (ENGINE_V2 Phase 3): one complete decision per tip-off, chosen by racing rollouts on the P8 index policy.
// At every tip-off the P8 context (lib/engine/p8.ts) gives each candidate player's priced advantage for every action:
// tonight's players start (which slot) or sit; every held score is kept (hold), locked (which slot) or let go, his own
// deadline included (lock / play the new game / let go). P10 builds a set of complete joint decisions from these prices:
//  - P8's own decision (the incumbent);
//  - single changes: seat / unseat each candidate; swap a held score's action (hold <-> lock <-> play); lock in another
//    slot type; local swaps (a seated candidate gives his slot to an unseated one who is eligible for it);
// each re-solved as one exact assignment, so the rest of the lineup adapts. Candidates within `margin` priced points of
// the incumbent are repaired (a held score let go while an eligible slot stays free is kept; a tipping player sat while
// an eligible slot stays idle for his whole game is started: both are weakly dominated), made reachable by legal Sleeper
// moves (rule 9, `reachable`), checked for legality, de-duplicated, and the best `nCand` by priced score are raced:
// continuations of the week (common random numbers: every surviving candidate is scored on the same scenarios) are
// played by the base policy (P8f or P8), in rounds of `batch` scenarios; a candidate clearly below the leader is dropped,
// and the race stops when no challenger can still beat the incumbent by `minGain`, when one challenger is left and
// significantly better, or at `kMax` scenarios. P8's decision is replaced only by a significantly better one.
// Locks are part of the same search (no separate lock rollout), and holding is an evaluated option, not a fallback.
import * as E from "./core";
import { reach, placeAll } from "./moves";
import { assign, toDecision, fillIdle, reachable, applyIndexDecision, seedPrices, exportPrices, type Cand, type IndexContext, type IndexDecision, type PriceSnap } from "./p8";

export interface P10Opts {
  nCand?: number;   // candidates raced, P8's decision included (default 8)
  margin?: number;  // only alternatives within this many priced points of P8's decision (default 15)
  batch?: number;   // scenarios per racing round (default 16)
  kMin?: number;    // scenarios before any candidate is dropped or the race stopped (default 32)
  kMax?: number;    // scenarios at most (default 256)
  zDrop?: number;   // drop a challenger when mean(it - leader) + zDrop * se < 0 (default 2)
  zAcc?: number;    // switch from P8's decision only if the gain is > zAcc * se ... (default 2)
  minGain?: number; // ... and > minGain points (default 0.5, the clear-gain threshold of P7H / P9)
  pairs?: boolean;  // local swaps (default true)
  // Confirmation (P10c, research/REPORT.md "P10b acceptance fix"): after the race, its best challenger is re-scored
  // against P8's decision on `confirm` FRESH scenarios (own random stream, independent of the race that selected it, so
  // free of the race's winner's curse). Default 0 = off (P10 / P10b exactly).
  confirm?: number;  // fresh scenarios in the confirmation batch (default 0 = no confirmation)
  confGate?: number; // a challenger the race did not accept is confirmed if its race gain is > confGate (default 0.5)
  confKinds?: string; // ... and its kind (first word of `why`, '+'-separated, e.g. "lock" or "lock+in"; "" = any; default "lock")
  confMin?: number;  // switch if the confirmation's mean gain is > confMin ... (default 0)
  confZ?: number;    // ... and > confZ * its se (one-sided test; default 0)
  confAll?: boolean; // the race's own accepted switches must pass the confirmation too (default false: kept as P10b)
}
const DEF: Required<P10Opts> = { nCand: 8, margin: 15, batch: 16, kMin: 32, kMax: 256, zDrop: 2, zAcc: 2, minGain: 0.5, pairs: true,
  confirm: 0, confGate: 0.5, confKinds: "lock", confMin: 0, confZ: 0, confAll: false };
// P10c: P10b's race + the confirmation (fixed before the season backtests, from model-scenario tuning: REPORT "P10b acceptance fix")
// (tuning: 138 model weeks, research/l_tune.py pick; +1.18 ± 0.29 pts/wk one-step, 1,400 extra continuations/wk = +6%)
export const P10C_OPTS: P10Opts = { confirm: 128, confGate: 0.25, confKinds: "", confMin: 0, confZ: 0, confAll: false };
const NEG = -Infinity;

export const decisionKey = (d: IndexDecision) =>
  [...d.starts].sort((a, b) => a[0] - b[0]).join(";") + "|" + [...d.locks].sort((a, b) => a[0] - b[0]).join(";") + "|" + [...d.holds.keys()].sort((a, b) => a - b).join(";");

// ---------------- legality of one complete decision ----------------
// Rules 1-9 for one moment: starts only for players tipping now (not locked), locks/holds only for held scores, a held
// player whose own game tips now can't keep holding (rule 5), every slot free (not locked, not in a game), eligible and
// used once; the held players' rearrangement (kept + lockers, from where they sit) is reachable by legal moves.
export function decisionProblem(tw: E.TeamWeek, st: E.State, e: E.Ev, d: IndexDecision, checkReach = true): string | null {
  const free = E.unpinnedOpen(st); const used = new Set<number>(); const who = new Set<number>();
  const tip = new Set<number>(); for (const g of e.group!) if (!st.isLocked[tw.games[g].p] && E.usable(tw, tw.games[g].p, e.t)) tip.add(tw.games[g].p);
  const held = (p: number) => !st.isLocked[p] && !Number.isNaN(st.pendingX[p]);
  const slotOk = (p: number, s: number, what: string) => {
    if (who.has(p)) return `player ${p} has two actions`; who.add(p);
    if (!((free >> s) & 1)) return `${what} ${p} into slot ${s}, which is locked or in a game`;
    if (!(tw.slots[s] & tw.pmask[p])) return `${what} ${p} into ineligible slot ${s}`;
    if (used.has(s)) return `slot ${s} used twice`; used.add(s); return null;
  };
  for (const [p, s] of d.starts) { if (!tip.has(p)) return `start of ${p}, who does not tip now`; const r = slotOk(p, s, "start"); if (r) return r; }
  for (const [p, s] of d.locks) { if (!held(p)) return `lock of ${p}, who holds no score`; const r = slotOk(p, s, "lock"); if (r) return r; }
  for (const [p, s] of d.holds) { if (!held(p)) return `hold of ${p}, who holds no score`; if (tip.has(p)) return `${p} holds through his own tip-off`; const r = slotOk(p, s, "hold"); if (r) return r; }
  if (checkReach) {
    const kept = [...d.holds.keys()], lockers = [...d.locks.keys()].filter((p) => st.lastSlot[p] >= 0);
    const players = [...kept, ...lockers]; const cur = players.map((p) => st.lastSlot[p]);
    if (players.length && cur.every((s) => (free >> s) & 1)) {
      const tgt = players.map((p, i) => (i < kept.length ? d.holds.get(p)! : d.locks.get(p)!));
      const r = reach(tw.slots, tw.pmask, free, players, cur, (a) => a.every((s, i) => s === tgt[i]));
      if (!r || r === "capped") return "rearrangement not reachable by legal moves";
    }
  }
  return null;
}

// ---------------- dominance repair ----------------
// (1) held scores let go although an eligible slot stays free: keep holding (he can still be let go later; nothing is
//     lost), best scores first; (2) tipping players sat while an eligible slot stays idle for his whole game (no later
//     tip-off could use it): start him (P8's idle fill).
export function repair(tw: E.TeamWeek, st: E.State, ctx: IndexContext, d: IndexDecision): IndexDecision {
  const out: IndexDecision = { starts: new Map(d.starts), locks: new Map(d.locks), holds: new Map(d.holds) };
  const letGo = ctx.cands.filter((c) => c.held && !c.tipping && !out.holds.has(c.p) && !out.locks.has(c.p)).sort((a, b) => st.pendingX[b.p] - st.pendingX[a.p]);
  if (letGo.length) {
    let open = 0; for (const s of ctx.free) open |= 1 << s;
    for (const s of [...out.starts.values(), ...out.locks.values()]) open &= ~(1 << s);
    const keep = [...out.holds.keys()]; const pref = new Int32Array(tw.pmask.length).fill(-1);
    for (const [p, s] of out.holds) pref[p] = s; for (const c of letGo) pref[c.p] = st.lastSlot[c.p];
    let m = placeAll(tw.slots, tw.pmask, open, keep, pref);
    for (const c of letGo) { const m2 = placeAll(tw.slots, tw.pmask, open, [...keep, c.p], pref); if (m2) { keep.push(c.p); m = m2; } }
    if (m && keep.length > out.holds.size) { out.holds = new Map(keep.map((p) => [p, m!.get(p)!] as [number, number])); }
  }
  fillIdle(tw, st, ctx.t, ctx.cands, out, ctx.free, "idle");
  return out;
}

// ---------------- candidates ----------------
export interface P10Cand { d: IndexDecision; score: number; why: string }
export function candidates(tw: E.TeamWeek, st: E.State, e: E.Ev, ctx: IndexContext, o: P10Opts = {}): P10Cand[] {
  const O = { ...DEF, ...o };
  const best = ctx.best; const raw: P10Cand[] = [];
  const seatedIn = (p: number) => best.starts.get(p) ?? best.locks.get(p) ?? best.holds.get(p) ?? -1;
  // re-solve with candidate i's weights replaced (w) and/or seat constraints
  const solveWith = (force: Map<number, number>, wOf: Map<number, { w: Float64Array; act: number }>, why: string) => {
    const cs: Cand[] = ctx.cands.map((c, i) => { const x = wOf.get(i); return x ? { ...c, w: x.w, act: new Uint8Array(c.act.length).fill(x.act) } : c; });
    const r = assign(cs, ctx.free, force); if (!r) return;
    if (r.score < ctx.bestScore - O.margin) return;
    const d = toDecision(cs, r.pick); fillIdle(tw, st, ctx.t, cs, d, ctx.free, "idle", force);
    raw.push({ d, score: r.score, why });
  };
  const only = (w: Float64Array, mask = -1) => w.map((x, s) => ((mask >> s) & 1 ? x : NEG));
  ctx.cands.forEach((c, i) => {
    const s0 = seatedIn(c.p); const nm = `p${c.p}`;
    // seat / unseat (unseating a held score = let him go; seating a let-go one = keep holding, sitting someone else)
    solveWith(new Map([[i, s0 >= 0 ? -1 : 1]]), new Map(), s0 >= 0 ? `out ${nm}` : `in ${nm}`);
    if (!c.held) return;
    // every other action of a held score: deadline lock <-> play; hold <-> lock
    const cur = best.locks.has(c.p) ? 1 : best.starts.has(c.p) ? 0 : best.holds.has(c.p) ? 2 : -1;
    for (const a of c.tipping ? [0, 1] : [1, 2]) if (a !== cur) solveWith(new Map([[i, 1]]), new Map([[i, { w: c.wa[a], act: a }]]), `${["play", "lock", "hold"][a]} ${nm}`);
    // lock into another slot type
    const lockS = best.locks.get(c.p);
    const types = new Set<number>(); for (const s of ctx.free) if (c.wa[1][s] > NEG && (lockS === undefined || tw.slots[s] !== tw.slots[lockS])) types.add(tw.slots[s]);
    if (lockS !== undefined || cur !== 1) for (const ty of types) {
      let mask = 0; for (const s of ctx.free) if (tw.slots[s] === ty) mask |= 1 << s;
      solveWith(new Map([[i, 1]]), new Map([[i, { w: only(c.wa[1], mask), act: 1 }]]), `lock ${nm} in ${tw.slotNames[ctx.free.find((s) => (mask >> s) & 1)!]}`);
    }
  });
  if (O.pairs) ctx.cands.forEach((a, i) => {
    const s = seatedIn(a.p); if (s < 0) return;
    ctx.cands.forEach((b, j) => {
      if (seatedIn(b.p) >= 0 || !(b.w[s] > NEG || b.wa.some((w) => w[s] > NEG))) return;
      solveWith(new Map([[i, -1], [j, 1]]), new Map(), `p${b.p} for p${a.p}`);
    });
  });
  // repair, make reachable, check, de-duplicate; P8's decision first
  const b0 = reachable(tw, st, ctx, best); // (what P8 itself applies)
  const out: P10Cand[] = [{ d: b0, score: ctx.bestScore, why: "P8" }]; const seen = new Set([decisionKey(b0)]);
  for (const c of raw.sort((a, b) => b.score - a.score)) {
    const d = reachable(tw, st, ctx, repair(tw, st, ctx, c.d));
    const k = decisionKey(d); if (seen.has(k)) continue; seen.add(k);
    if (decisionProblem(tw, st, e, d)) continue;
    out.push({ d, score: c.score, why: c.why });
    if (out.length >= O.nCand) break;
  }
  return out;
}

// ---------------- racing ----------------
// per[i]: candidate i's paired gain over the incumbent on the scenarios both have (n, mean, se; per[0] = 0)
export interface RaceResult { pick: number; k: number; sims: number; alive: number; means: number[]; gain: number; se: number; per: { n: number; m: number; se: number }[] }
// Generic racing with common random numbers. run(alive, k0, n) returns, per alive candidate, its scores on scenarios
// k0..k0+n-1 (the same scenarios for every candidate). Candidate 0 is the incumbent and is never dropped.
export function race(nCand: number, run: (alive: number[], k0: number, n: number) => number[][], o: P10Opts = {}): RaceResult {
  const O = { ...DEF, ...o };
  const sc: number[][] = Array.from({ length: nCand }, () => []);
  let alive = Array.from({ length: nCand }, (_, i) => i); let k = 0, sims = 0;
  // paired stats of a - b over the scenarios both have
  const diff = (a: number, b: number) => {
    const n = Math.min(sc[a].length, sc[b].length); let m = 0; for (let i = 0; i < n; i++) m += sc[a][i] - sc[b][i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (sc[a][i] - sc[b][i] - m) ** 2;
    return { m, se: n > 1 ? Math.sqrt(v / (n - 1) / n) : Infinity };
  };
  const mean = (i: number) => sc[i].reduce((s, x) => s + x, 0) / Math.max(1, sc[i].length);
  const accept = (i: number) => { const r = diff(i, 0); return r.m > O.minGain && r.m > O.zAcc * r.se; };
  while (k < O.kMax && alive.length > 1) {
    const n = Math.min(O.batch, O.kMax - k); const r = run(alive, k, n);
    alive.forEach((c, j) => sc[c].push(...r[j])); sims += n * alive.length; k += n;
    if (k < O.kMin) continue;
    const L = alive.reduce((a, b) => (mean(b) > mean(a) ? b : a));
    alive = alive.filter((i) => i === 0 || i === L || (() => { const r = diff(i, L); return r.m + O.zDrop * r.se >= 0; })());
    const ch = alive.filter((i) => i !== 0);
    if (!ch.length) break;
    if (ch.every((i) => { const r = diff(i, 0); return r.m + O.zDrop * r.se < O.minGain; })) { alive = [0]; break; } // nobody can still beat P8's decision
    if (ch.length === 1 && accept(ch[0])) break;
  }
  const ch = alive.filter((i) => i !== 0); const means = sc.map((_, i) => mean(i));
  const L = ch.length ? ch.reduce((a, b) => (means[b] > means[a] ? b : a)) : 0;
  const r = L ? diff(L, 0) : { m: 0, se: 0 };
  const per = sc.map((x, i) => (i ? { n: x.length, ...diff(i, 0) } : { n: x.length, m: 0, se: 0 }));
  return { pick: L && accept(L) ? L : 0, k, sims, alive: alive.length, means, gain: r.m, se: r.se, per };
}

// Confirmation (P10c): which challenger to confirm after a race, or -1. The race's accepted switch (if confAll), else
// its best challenger by race gain if that gain is > confGate and its kind is allowed. Fresh paired gains d (challenger -
// P8's decision) then decide: switch iff mean(d) > confMin and mean(d) > confZ * se(d).
export function confirmTarget(res: RaceResult, cs: { why: string }[], o: P10Opts = {}): number {
  const O = { ...DEF, ...o };
  if (!O.confirm) return -1;
  if (res.pick) return O.confAll ? res.pick : -1;
  let L = -1; for (let i = 1; i < res.per.length; i++) if (res.per[i].n > 1 && (L < 0 || res.per[i].m > res.per[L].m)) L = i;
  if (L < 0 || !(res.per[L].m > O.confGate)) return -1;
  const kinds = O.confKinds.split("+").filter(Boolean);
  return !kinds.length || kinds.includes(cs[L].why.split(" ")[0]) ? L : -1;
}
export function confirmPasses(d: number[], o: P10Opts = {}): { pass: boolean; m: number; se: number } {
  const O = { ...DEF, ...o }; const n = d.length;
  const m = d.reduce((s, x) => s + x, 0) / n; const se = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n) : Infinity;
  return { pass: m > O.confMin && m > O.confZ * se, m, se };
}

// ---------------- continuations ----------------
// One continuation: candidate decision d applied at events[evIdx] from state st, the rest of the week played by base on
// scenario scen, from the real decision's prices (slot "top" seeded into the base's own slot). A pure function of
// (team-week, base, st, evIdx, d, scen, the "top" prices): the same in any thread and in any order (price slots are
// seeded per continuation; the stopValue / re-solve memos are pure).
export interface Scen { actual: Float64Array; played: Uint8Array }
export function continuation(tw: E.TeamWeek, base: E.Policy, events: E.Ev[], st: E.State, evIdx: number, d: IndexDecision, scen: Scen, scratch: (st: E.State) => E.State): number {
  const s2 = scratch(st); applyIndexDecision(tw, s2, events[evIdx], d); seedPrices(tw, base.index?.slot ?? "roll");
  return E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total;
}
// Where a race's continuations are played. Default: this thread. A pool (worker threads: lib/live/racepool.ts) gets one
// RaceCtx per raced decision (the same object for all its rounds) and returns, per alive candidate, the raw totals on
// the round's scenarios (scenario order), i.e. exactly what this thread would compute; or null when it can't (no
// workers, a failure): then this thread plays the round. Scenarios are always drawn here, from the race's own stream,
// and a round's elimination / stopping happens only after all its results are in, so the decision and the stats do not
// depend on how the work is split.
export interface RaceCtx { tw: E.TeamWeek; base: E.Policy; events: E.Ev[]; st: E.State; evIdx: number; cands: IndexDecision[]; prices: PriceSnap | null }
export interface RacePool { round(ctx: RaceCtx, alive: number[], scens: Scen[]): number[][] | null }

// ---------------- the policy's hook ----------------
// per raced decision (log): [candidates, scenarios used, continuations, candidates alive at the end, gain of the best challenger, its se, switched]
// with confirmation on, 4 more: [confirmed candidate (-1 none), its race gain, confirmation mean gain, its se,
//   outcome: 0 none, 1 switched by the confirmation, 2 race switch vetoed, 3 race switch confirmed, 4 not confirmed]
// conf: confirmations run; confSwitch / confVeto: decisions the confirmation changed vs P10b's rule; confSims: their continuations
export interface P10Stats { decisions: number; raced: number; cands: number; switched: number; scen: number; sims: number; ms: number; why: Record<string, number>; log: number[][];
  conf: number; confSwitch: number; confVeto: number; confSims: number }
export const newStats = (): P10Stats => ({ decisions: 0, raced: 0, cands: 0, switched: 0, scen: 0, sims: 0, ms: 0, why: {}, log: [], conf: 0, confSwitch: 0, confVeto: 0, confSims: 0 });
// what a research probe sees after every raced decision (the final choice `pick`, after any confirmation)
export interface RaceInfo { st: E.State; t: number; evIdx: number; cands: P10Cand[]; res: RaceResult; pick: number; base: E.Policy; score?: (total: number) => number }
// Extension (ENGINE_V2 Phase 5, lib/engine/p11.ts): called at every tip-off decision with the candidates; may change how
// a continuation's final total is scored, which policy plays the continuations, and add candidate decisions (inserted
// after P8's, de-duplicated, legality-checked). Returning undefined leaves the decision exactly as P10's.
// pool: play the continuations on worker threads (identical results, see RacePool).
export interface P10Ext {
  r?: () => number; // the race's random stream (default rng(seed ^ 0x3c6ef372))
  prep?: (st: E.State, t: number, evIdx: number, ctx: IndexContext, cs: P10Cand[]) =>
    { score?: (total: number) => number; base?: E.Policy; extra?: { d: IndexDecision; why: string }[] } | undefined;
  pool?: RacePool | null;
  rc?: () => number; // the confirmation's random stream (default rng(seed ^ 0x2545f491)), separate from the race's
  onRace?: (x: RaceInfo) => void; // research probe (observe only)
}
// base: the policy that plays the continuations (P8f or P8; its index.slot must be its own price state, e.g. "roll")
export function p10Hooks(tw: E.TeamWeek, base: E.Policy, events: E.Ev[], seed: number,
  realised: { actual: Float64Array; played: Uint8Array }, o: P10Opts = {}, stats: P10Stats = newStats(), ext?: P10Ext): E.Hooks & { stats: P10Stats } {
  const r = ext?.r ?? E.rng(seed ^ 0x3c6ef372); const scratch = E.scratchState(); const pool = ext?.pool;
  const rc = ext?.rc ?? E.rng(seed ^ 0x2545f491); const nConf = o.confirm ?? 0;
  return {
    stats,
    decideIndex: (st, t, evIdx, ctx) => {
      const t0 = performance.now(); stats.decisions++;
      const e = events[evIdx]; const cs = candidates(tw, st, e, ctx, o);
      const px = ext?.prep?.(st, t, evIdx, ctx, cs);
      if (px?.extra) {
        const seen = new Set(cs.map((c) => decisionKey(c.d)));
        for (const x of px.extra) {
          const d = reachable(tw, st, ctx, x.d); const k = decisionKey(d);
          if (seen.has(k) || decisionProblem(tw, st, e, d)) continue;
          seen.add(k); cs.splice(1, 0, { d, score: NaN, why: x.why });
        }
      }
      if (cs.length < 2) { stats.ms += performance.now() - t0; return undefined; }
      stats.raced++; stats.cands += cs.length;
      const B = px?.base ?? base; const score = px?.score;
      let ctx0: RaceCtx | null = null;
      const play = (alive: number[], scens: Scen[]) => {
        let tot: number[][] | null = null;
        if (pool) { ctx0 ??= { tw, base: B, events, st, evIdx, cands: cs.map((c) => c.d), prices: exportPrices(tw) }; tot = pool.round(ctx0, alive, scens); }
        tot ??= alive.map((c) => scens.map((sc) => continuation(tw, B, events, st, evIdx, cs[c].d, sc, scratch)));
        return score ? tot.map((row) => row.map(score)) : tot;
      };
      const res = race(cs.length, (alive, _k0, n) => {
        const scens: Scen[] = []; for (let k = 0; k < n; k++) scens.push(E.sampleScenario(tw, st, t, r, realised));
        return play(alive, scens);
      }, o);
      stats.scen += res.k; stats.sims += res.sims;
      const row = [cs.length, res.k, res.sims, res.alive, Math.round(res.gain * 100) / 100, Math.round(res.se * 100) / 100, res.pick ? 1 : 0];
      // confirmation (P10c): the challenger re-scored vs P8's decision on fresh scenarios from its own stream
      let pick = res.pick;
      if (nConf > 0) {
        const L = confirmTarget(res, cs, o); let cm = 0, cse = 0, out = 0;
        if (L > 0) {
          const scens: Scen[] = []; for (let k = 0; k < nConf; k++) scens.push(E.sampleScenario(tw, st, t, rc, realised));
          const [a, b] = play([0, L], scens); const c = confirmPasses(b.map((x, k) => x - a[k]), o);
          stats.conf++; stats.confSims += 2 * nConf; cm = c.m; cse = c.se;
          if (res.pick) { out = c.pass ? 3 : 2; if (!c.pass) { pick = 0; stats.confVeto++; } }
          else { out = c.pass ? 1 : 4; if (c.pass) { pick = L; stats.confSwitch++; } }
        }
        row.push(L, L > 0 ? Math.round(res.per[L].m * 100) / 100 : 0, Math.round(cm * 100) / 100, Math.round(cse * 100) / 100, out);
      }
      row[6] = pick ? 1 : 0; stats.log.push(row); stats.ms += performance.now() - t0;
      ext?.onRace?.({ st, t, evIdx, cands: cs, res, pick, base: B, score });
      if (!pick) return undefined;
      stats.switched++; const w = cs[pick].why.split(" ")[0]; stats.why[w] = (stats.why[w] || 0) + 1;
      return cs[pick].d;
    },
  };
}
