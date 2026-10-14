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
import { assign, toDecision, fillIdle, reachable, applyIndexDecision, seedPrices, type Cand, type IndexContext, type IndexDecision } from "./p8";

export interface P10Opts {
  nCand?: number;   // candidates raced, P8's decision included (default 8)
  margin?: number;  // only alternatives within this many priced points of P8's decision (default 15)
  batch?: number;   // scenarios per racing round (default 16)
  kMin?: number;    // scenarios before any candidate is dropped or the race stopped (default 32)
  kMax?: number;    // scenarios at most (default 256)
  zDrop?: number;   // drop a challenger when mean(it - leader) + zDrop * se < 0 (default 2)
  zAcc?: number;    // switch from P8's decision only if the gain is > zAcc * se ... (default 2)
  minGain?: number; // ... and > minGain points (default 0.25)
  pairs?: boolean;  // local swaps (default true)
}
const DEF: Required<P10Opts> = { nCand: 8, margin: 15, batch: 16, kMin: 32, kMax: 256, zDrop: 2, zAcc: 2, minGain: 0.25, pairs: true };
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
export interface RaceResult { pick: number; k: number; sims: number; alive: number; means: number[]; gain: number; se: number }
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
  return { pick: L && accept(L) ? L : 0, k, sims, alive: alive.length, means, gain: r.m, se: r.se };
}

// ---------------- the policy's hook ----------------
// per raced decision (log): [candidates, scenarios used, continuations, candidates alive at the end, gain of the best challenger, its se, switched]
export interface P10Stats { decisions: number; raced: number; cands: number; switched: number; scen: number; sims: number; ms: number; why: Record<string, number>; log: number[][] }
export const newStats = (): P10Stats => ({ decisions: 0, raced: 0, cands: 0, switched: 0, scen: 0, sims: 0, ms: 0, why: {}, log: [] });
// base: the policy that plays the continuations (P8f or P8; its index.slot must be its own price state, e.g. "roll")
export function p10Hooks(tw: E.TeamWeek, base: E.Policy, events: E.Ev[], seed: number,
  realised: { actual: Float64Array; played: Uint8Array }, o: P10Opts = {}, stats: P10Stats = newStats()): E.Hooks & { stats: P10Stats } {
  const r = E.rng(seed ^ 0x3c6ef372);
  return {
    stats,
    decideIndex: (st, t, evIdx, ctx) => {
      const t0 = performance.now(); stats.decisions++;
      const e = events[evIdx]; const cs = candidates(tw, st, e, ctx, o);
      if (cs.length < 2) { stats.ms += performance.now() - t0; return undefined; }
      stats.raced++; stats.cands += cs.length;
      const res = race(cs.length, (alive, _k0, n) => {
        const out = alive.map(() => [] as number[]);
        for (let k = 0; k < n; k++) {
          const scen = E.sampleScenario(tw, st, t, r, realised);
          alive.forEach((c, j) => {
            const s2 = E.cloneState(st); applyIndexDecision(tw, s2, e, cs[c].d); seedPrices(tw, base.index?.slot ?? "roll");
            out[j].push(E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total);
          });
        }
        return out;
      }, o);
      stats.scen += res.k; stats.sims += res.sims; stats.ms += performance.now() - t0;
      stats.log.push([cs.length, res.k, res.sims, res.alive, Math.round(res.gain * 100) / 100, Math.round(res.se * 100) / 100, res.pick ? 1 : 0]);
      if (!res.pick) return undefined;
      stats.switched++; const w = cs[res.pick].why.split(" ")[0]; stats.why[w] = (stats.why[w] || 0) + 1;
      return cs[res.pick].d;
    },
  };
}
