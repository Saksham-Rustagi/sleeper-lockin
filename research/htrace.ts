// Task H (analysis): lineup timeline + Lagrangian gap decomposition, one team-week per process (research/runtasks.mjs).
// usage: node research/dist/htrace.cjs <week> <rid> <out.json> [real|model]
//  real : every policy in env POLS (';'-separated, default "P10b;P7H_LheldTie;P8") on the real outcomes through the
//         invariant checker (same runner and seeds as research/p10run.ts, so totals equal the season runs), with the
//         physical lineup traced after every event. P10/P10b races are run by a logging copy of p10Hooks (identical
//         decisions: same candidates, same random stream, same race arithmetic) that records every candidate's paired
//         gain vs P8's decision.
//  model: the same policies on NSC model scenarios (gap.ts seeds), decomposition only (verifies the identity below).
// Per policy and outcome path:
//  - slots: for each of the 9 starting slots its counted score, the game it came from and when it was secured (lock
//    time, or the end of the player's final game if his held final game counted at week end);
//  - decomposition of (Lagrangian bound - week total) with the week-start optimal prices mu (lib/engine/lagrange.ts):
//      bound - W = sum_p [V_p - W_p + C_p] + sum_{s,b} mu_sb (1 - o_sb)              (exact on every path)
//      V_p - W_p + C_p = sum of p's decision losses vs his priced DP + his extra charges + zero-mean noise
//    decision losses: at a tip-off (start vs sit) and after a started game (keep = lock/count vs let go), each
//    = DP optimum - DP value of the action taken; extra charges: slot placement above the cheapest eligible slot, early
//    locks (a lock slot's price before his next tip-off minus the cheapest), and holding charges of scores later let go.
import fs from "fs";
import * as E from "./engine";
import * as L from "../lib/engine/lagrange";
import { S, fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { runChecked, type TraceView } from "./invariants";
import { candidates, decisionKey, decisionProblem, type P10Opts } from "../lib/engine/p10";
import { reachable, applyIndexDecision, seedPrices } from "../lib/engine/p8";

const [week, rid, out, mode = "real"] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5] || "real"];
for (const kv of process.argv.slice(6)) { const i = kv.indexOf("="); if (i > 0) process.env[kv.slice(0, i)] = kv.slice(i + 1); }
const pols = (process.env.POLS || "P10b;P7H_LheldTie;P8").split(";").filter(Boolean);
const ITERS = Number(process.env.ITERS || 200000);
const FRESH = Number(process.env.FRESH || 0), FRESHMIN = Number(process.env.FRESHMIN || 0.25); // re-evaluation of the race's runner-up
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const nS = tw.slots.length, nP = tw.pmask.length;
const t0 = Date.now();

// ---------------- prices ----------------
const inst = L.fromTeamWeek(tw);
const br = L.tightBound(inst, ITERS); const P = br.P; const mu = br.mu; const Tb = L.tables(P, mu);
const { B, times, gl, gA, gE, maskOf } = P; const W = B + 1;
const bucketAt = (t: number) => { let lo = 0, hi = B; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; } return Math.min(lo, B); };
const mP = (p: number, b: number) => Tb.Pm[maskOf[p] * W + b + 1] - Tb.Pm[maskOf[p] * W + b]; // cheapest eligible price
const muSB = (s: number, b: number) => mu[s * B + b];
const elig = (p: number, s: number) => (tw.slots[s] & tw.pmask[p]) !== 0;

// ---------------- P10 with candidate logging (decisions identical to lib/engine/p10.ts p10Hooks) ----------------
const DEF: Required<P10Opts> = { nCand: 8, margin: 15, batch: 16, kMin: 32, kMax: 256, zDrop: 2, zAcc: 2, minGain: 0.5, pairs: true, confirm: 0, confGate: 0.5, confKinds: "lock", confMin: 0, confZ: 0, confAll: false };
function raceLog(nCand: number, run: (alive: number[], k0: number, n: number) => number[][], o: P10Opts = {}) {
  const O = { ...DEF, ...o };
  const sc: number[][] = Array.from({ length: nCand }, () => []);
  let alive = Array.from({ length: nCand }, (_, i) => i); let k = 0, sims = 0;
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
    const Ld = alive.reduce((a, b) => (mean(b) > mean(a) ? b : a));
    alive = alive.filter((i) => i === 0 || i === Ld || (() => { const r = diff(i, Ld); return r.m + O.zDrop * r.se >= 0; })());
    const ch = alive.filter((i) => i !== 0);
    if (!ch.length) break;
    if (ch.every((i) => { const r = diff(i, 0); return r.m + O.zDrop * r.se < O.minGain; })) { alive = [0]; break; }
    if (ch.length === 1 && accept(ch[0])) break;
  }
  const ch = alive.filter((i) => i !== 0); const means = sc.map((_, i) => mean(i));
  const Lb = ch.length ? ch.reduce((a, b) => (means[b] > means[a] ? b : a)) : 0;
  return { pick: Lb && accept(Lb) ? Lb : 0, k, sims, per: sc.map((x, i) => (i ? { n: x.length, ...diff(i, 0) } : { n: x.length, m: 0, se: 0 })) };
}
function p10LogHooks(sd: number, base: E.Policy, events: E.Ev[], realised: { actual: Float64Array; played: Uint8Array }, log: any[], o: P10Opts = {}): E.Hooks {
  const r = E.rng(sd ^ 0x3c6ef372); const scratch = E.scratchState();
  return {
    decideIndex: (st, t, evIdx, ctx) => {
      const e = events[evIdx]; const cs = candidates(tw, st, e, ctx, o);
      if (cs.length < 2) return undefined;
      const res = raceLog(cs.length, (alive, _k0, n) => {
        const outv = alive.map(() => [] as number[]);
        for (let k = 0; k < n; k++) {
          const scen = E.sampleScenario(tw, st, t, r, realised);
          alive.forEach((c, j) => {
            const s2 = scratch(st); applyIndexDecision(tw, s2, e, cs[c].d); seedPrices(tw, base.index?.slot ?? "roll");
            outv[j].push(E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total);
          });
        }
        return outv;
      }, o);
      const entry: any = { t, k: res.k, pick: res.pick, c: cs.map((c, i) => [c.why, Math.round(c.score * 100) / 100, res.per[i].n, Math.round(res.per[i].m * 1000) / 1000, Math.round(res.per[i].se * 1000) / 1000]) };
      // unbiased re-evaluation of the best challenger NOT chosen (fresh scenarios on a separate random stream, so the
      // policy's own decisions and stream are untouched): what one more step of search would have gained
      const chosen = res.pick; let bj = -1;
      for (let i = 1; i < cs.length; i++) if (i !== chosen && (bj < 0 || res.per[i].m > res.per[bj].m)) bj = i;
      if (FRESH > 0 && bj > 0 && res.per[bj].m - res.per[chosen].m > FRESHMIN) {
        const rf = E.rng((sd * 7919 + evIdx * 104729) ^ 0x5bd1e995); const diffs: number[] = [];
        for (let k = 0; k < FRESH; k++) {
          const scen = E.sampleScenario(tw, st, t, rf, realised); const tot: number[] = [];
          for (const c of [chosen, bj]) { const s2 = scratch(st); applyIndexDecision(tw, s2, e, cs[c].d); seedPrices(tw, base.index?.slot ?? "roll"); tot.push(E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total); }
          diffs.push(tot[1] - tot[0]);
        }
        const m = diffs.reduce((a, x) => a + x, 0) / diffs.length; const v = diffs.reduce((a, x) => a + (x - m) ** 2, 0) / (diffs.length - 1);
        entry.fresh = [bj, Math.round(m * 1000) / 1000, Math.round(Math.sqrt(v / diffs.length) * 1000) / 1000, diffs.length];
      }
      log.push(entry);
      return res.pick ? cs[res.pick].d : undefined;
    },
  };
}
// (keep the imports used only for type/legality parity with p10Hooks referenced)
void decisionKey; void decisionProblem; void reachable;

function runnerFor(pn: string, sd: number, realised: { actual: Float64Array; played: Uint8Array }, log: any[]) {
  const ru = PL.runner(pn, tw, sd, realised);
  if (pn === "P10b" || pn === "P10") {
    const base: E.Policy = { ...PL.POL.P8, name: "P10base", index: pn === "P10b" ? { resolve: "tip", iters: 100, slot: "roll" } : { resolve: "info", iters: 30, slot: "roll" } };
    return { ...ru, hooks: p10LogHooks(sd, base, ru.events, realised, log) };
  }
  return ru;
}

// ---------------- one traced run ----------------
interface Snap { t: number; status: number[]; pos: number[]; heldFrom: number[] }
function traced(pn: string, sd: number, actual: Float64Array, played: Uint8Array, label: string) {
  const log: any[] = []; const ru = runnerFor(pn, sd, { actual, played }, log);
  const snaps: Snap[] = []; let last = "";
  let endInfo: { counted: Map<number, number>; heldX: number[]; heldFrom: number[]; lockedX: number[]; started: number[] } | null = null;
  const t1 = Date.now();
  const r = runChecked(tw, ru.pol, ru.events, actual, played, ru.hooks, {
    label,
    onStep: (_i, e, tr: TraceView) => {
      const k = Array.from(tr.status).join(",") + "|" + Array.from(tr.pos).join(",") + "|" + Array.from(tr.heldFrom).join(",");
      if (k === last) return; last = k;
      if (snaps.length && snaps[snaps.length - 1].t === e.t) snaps.pop();
      snaps.push({ t: e.t, status: Array.from(tr.status), pos: Array.from(tr.pos), heldFrom: Array.from(tr.heldFrom) });
    },
    onEnd: (counted, tr: TraceView, st) => { endInfo = { counted: new Map(counted), heldX: Array.from(tr.heldX), heldFrom: Array.from(tr.heldFrom), lockedX: Array.from(tr.lockedX), started: Array.from(st.started) }; },
  });
  return { total: r.total, recount: r.trackerTotal, rep: r.rep, ms: Date.now() - t1, snaps, end: endInfo!, log };
}

// ---------------- analysis of a traced run ----------------
function analyse(run: ReturnType<typeof traced>, actual: Float64Array, played: Uint8Array) {
  const { snaps, end } = run;
  // state at bucket b = last snapshot with t <= times[b]
  const at = (b: number): Snap | null => { let res: Snap | null = null; for (const s of snaps) { if (s.t <= times[b]) res = s; else break; } return res; };
  const sb: (Snap | null)[] = Array.from({ length: B }, (_, b) => at(b));
  const stat = (p: number, b: number) => sb[b]?.status[p] ?? 0, posOf = (p: number, b: number) => sb[b]?.pos[p] ?? -1;
  // ---- counted slots and when they were secured ----
  const slots: any[] = Array.from({ length: nS }, () => ({ p: -1, x: 0, g: -1, how: "none", tSec: null, tLock: null }));
  const fate = new Map<number, { g: number; lockT: number | null; s: number }>(); // player -> counted game
  for (let p = 0; p < nP; p++) {
    let prevHeld = -1, lockT: number | null = null;
    for (const s of snaps) { if (s.status[p] === 2) prevHeld = s.heldFrom[p]; if (s.status[p] === 3 && lockT === null) { lockT = s.t; break; } }
    // the locked score is from his last started game that ended by the lock (stale locks are illegal; a lock at the
    // instant his game ends leaves no 'held' snapshot, so prevHeld alone can point at an older game)
    if (lockT !== null) for (const gi of tw.byPlayer[p]) if (end.started[gi] && tw.games[gi].end <= lockT) prevHeld = gi;
    if (lockT !== null) { const s = snaps.find((x) => x.t === lockT)!.pos[p]; fate.set(p, { g: prevHeld, lockT, s }); slots[s] = { p, x: end.lockedX[s], g: prevHeld, how: "lock", tSec: lockT, tLock: lockT }; }
  }
  for (const [p, s] of end.counted) {
    const g = end.heldFrom[p]; if (fate.has(p)) continue;
    fate.set(p, { g, lockT: null, s }); slots[s] = { p, x: end.heldX[p], g, how: "end", tSec: g >= 0 ? tw.games[g].end : null, tLock: null };
  }
  // ---- decomposition ----
  const cat: Record<string, number> = {}, cnt: Record<string, number> = {}, info: Record<string, number> = {};
  const addInfo = (k: string, v: number) => { info[k] = (info[k] || 0) + v; };
  const add = (k: string, v: number) => { if (Math.abs(v) < 1e-12) return; cat[k] = (cat[k] || 0) + v; cnt[k] = (cnt[k] || 0) + 1; };
  let Wt = 0; const emptyBySlot = new Array(nS).fill(0); const emptyByDay: Record<string, number> = {};
  const occ = (s: number, b: number) => { const sn = sb[b]; if (!sn) return -1; for (let p = 0; p < nP; p++) if (sn.pos[p] === s && sn.status[p] >= 1 && sn.status[p] <= 3) return p; return -1; };
  const occM: number[][] = Array.from({ length: nS }, (_, s) => Array.from({ length: B }, (_, b) => occ(s, b)));
  const dayKey = (t: number) => new Date(t - 5 * 3600e3).toISOString().slice(0, 10);
  for (let s = 0; s < nS; s++) for (let b = 0; b < B; b++) if (occM[s][b] < 0 && muSB(s, b) > 0) { const v = muSB(s, b); emptyBySlot[s] += v; const d = dayKey(times[b]); emptyByDay[d] = (emptyByDay[d] || 0) + v; }
  const empty = emptyBySlot.reduce((a, x) => a + x, 0);
  const anyFreeElig = (p: number, b: number) => { for (let s = 0; s < nS; s++) if (elig(p, s) && occM[s][b] < 0) return true; return false; };
  let sumV = 0, sumC = 0;
  const { p1, p0 } = P.inst.dnp;
  for (let p = 0; p < nP; p++) {
    const l = gl[p]; const n = l.length; if (!n || !P.eligOfMask[maskOf[p]].length) continue;
    const C = Tb.C[p]; let lp = tw.lastPlayed0[p] ? 1 : 0; sumV += C[lp];
    let charge = 0; for (let b = 0; b < B; b++) { const st = stat(p, b); if (st >= 1 && st <= 3) charge += muSB(posOf(p, b), b); }
    sumC += charge;
    const f = fate.get(p); const Wp = f ? (f.lockT !== null ? end.lockedX[f.s] : end.heldX[p]) : 0; Wt += Wp;
    for (let k = 0; k < n; k++) {
      const gi = l[k]; const a = gA[gi], e = gE[gi]; const g = P.inst.games[gi];
      const q = g.pPlay ?? (lp ? p1 : p0);
      const c1 = C[(k + 1) * 2 + 1], c0 = C[(k + 1) * 2];
      const gs = Tb.gSlot[p][k]; const G = Tb.Ps[gs * W + e] - Tb.Ps[gs * W + a];
      const afterPlay = L.eMaxDist(g.dist, Tb.thr[p][k]) - Tb.kap[p][k];
      const Qs = -G + q * afterPlay + (1 - q) * c0, Qb = q * c1 + (1 - q) * c0; const Copt = Math.max(Qs, Qb);
      const started = !!end.started[gi];
      const dnp = !played[gi];
      if (started) { if (Qb > Qs) add(dnp ? "start_should_sit_dnp" : "start_should_sit", Copt - Qs); }
      else if (Qs > Qb) {
        const free = anyFreeElig(p, a); add(free ? "sit_should_start_free" : "sit_should_start_forced", Copt - Qb);
        if (!free) {
          // what fills his eligible slots at tip-off (information only; not part of the sum)
          let held = 0, lock = 0; for (let s = 0; s < nS; s++) if (elig(p, s)) { const q = occM[s][a]; const stq = q >= 0 ? stat(q, a) : 0; if (stq === 2) held++; else if (stq === 3) lock++; }
          addInfo(held ? "forced_blocked_by_held" : lock ? "forced_blocked_by_locks" : "forced_blocked_by_games_starters", Copt - Qb);
        }
      }
      if (started) {
        const s0 = posOf(p, a); const chG = s0 >= 0 ? Tb.Ps[s0 * W + e] - Tb.Ps[s0 * W + a] : 0; add("place_game", chG - G);
        const x = played[gi] ? actual[gi] : 0; const lpn = played[gi] ? 1 : 0; const cgo = lpn ? c1 : c0; const kap = Tb.kap[p][k]; const keepV = x - kap;
        const nextA = k < n - 1 ? gA[l[k + 1]] : B;
        if (f && f.g === gi) {
          if (cgo > keepV) add(k === n - 1 ? "kept_should_go_final" : "kept_should_go", cgo - keepV);
          // charges from e to B vs kap; split the early-lock part
          let paid = 0, early = 0; const ub = f.lockT !== null ? bucketAt(f.lockT) : B;
          for (let b = e; b < B; b++) { const st = stat(p, b); if (st >= 2 && st <= 3) { const s = posOf(p, b); paid += muSB(s, b); if (st === 3 && b < nextA) early += muSB(s, b) - mP(p, b); } }
          if (process.env.DBG && paid - kap - early < -1e-6) console.error(JSON.stringify({ p: tw.names[p], k, n, e, nextA, B, ub, paid, kap, early, x, st: Array.from({ length: B - e }, (_, j) => `${stat(p, e + j)}@${posOf(p, e + j)}:${muSB(Math.max(0, posOf(p, e + j)), e + j).toFixed(2)}/${mP(p, e + j).toFixed(2)}`) }));
          void ub; add("lock_early", early); add("place_keep", paid - kap - early);
          lp = lpn; break; // he's done for the week
        } else {
          if (keepV > cgo) {
            // let go: find the bucket he stopped holding
            let v = e; while (v < B && stat(p, v) === 2 && (sb[v]?.heldFrom[p] ?? -1) === gi) v++;
            add((v < B && anyFreeElig(p, v) && v < nextA ? "went_should_keep_free" : "went_should_keep") + (k === n - 1 ? "_final" : ""), keepV - cgo);
          }
          let wasted = 0; for (let b = e; b < B; b++) { if (stat(p, b) === 2 && (sb[b]?.heldFrom[p] ?? -1) === gi) wasted += muSB(posOf(p, b), b); else if (b > e) break; }
          add("held_then_let_go", wasted);
        }
        lp = lpn;
      } else lp = played[gi] ? 1 : 0;
    }
  }
  const sumMu = mu.reduce((a, x) => a + x, 0);
  const terms = Object.values(cat).reduce((a, x) => a + x, 0) + empty;
  // exact path identity: bound - W = (sumV - W + sumC) + empty; noise = (bound - W) - (losses + extras + empty)
  const identity = (sumV + sumMu) - Wt - ((sumV - Wt + sumC) + empty);
  return { W: Wt, slots, dec: { cat: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), cnt, info, empty: Math.round(empty * 1000) / 1000, emptyBySlot: emptyBySlot.map((x) => Math.round(x * 1000) / 1000), emptyByDay, noise: Math.round(((br.bound - Wt) - terms) * 1000) / 1000, identityErr: identity } };
}

// ---------------- hindsight lineup (every player at most his best game, distinct eligible slots) ----------------
function hindsightSlots(actual: Float64Array, played: Uint8Array) {
  const w = new Float64Array(nP); const best = new Int32Array(nP).fill(-1); const ps: number[] = [];
  for (let p = 0; p < nP; p++) { let m = 0; for (const gi of tw.byPlayer[p]) if (played[gi] && actual[gi] > m) { m = actual[gi]; best[p] = gi; } if (m > 0) { w[p] = m; ps.push(p); } }
  const r = E.assignExact(tw.slots, (1 << nS) - 1, ps, tw.pmask, w);
  const slots: any[] = Array.from({ length: nS }, () => ({ p: -1, x: 0, g: -1, how: "none", tSec: null }));
  for (const [p, s] of r.slotOf) slots[s] = { p, x: w[p], g: best[p], how: "hs", tSec: tw.games[best[p]].end };
  return { total: r.total, slots };
}

const row: any = { week, rid, mode, bound: br.bound, free: br.free, B, seed };
// price summary: total price mass per slot and per ET day (where capacity binds)
row.priceBySlot = Array.from({ length: nS }, (_, s) => { let a = 0; for (let b = 0; b < B; b++) a += muSB(s, b); return Math.round(a * 100) / 100; });
row.priceByDay = {} as Record<string, number[]>;
for (let b = 0; b < B; b++) { const d = new Date(times[b] - 5 * 3600e3).toISOString().slice(0, 10); const v = (row.priceByDay[d] ??= new Array(nS).fill(0)); for (let s = 0; s < nS; s++) v[s] += muSB(s, b); }
for (const d in row.priceByDay) row.priceByDay[d] = row.priceByDay[d].map((x: number) => Math.round(x * 100) / 100);
row.relaxedOccByDay = {} as Record<string, number[]>; // expected relaxed occupancy-hours per slot and day
for (let b = 0; b < B; b++) { const d = new Date(times[b] - 5 * 3600e3).toISOString().slice(0, 10); const v = (row.relaxedOccByDay[d] ??= new Array(nS).fill(0)); const h = (times[b + 1] - times[b]) / 3600e3; for (let s = 0; s < nS; s++) v[s] += br.at.occ[s * B + b] * h; }
row.games = tw.games.map((g, i) => [g.p, g.tip, g.end, real.played[i], real.actual[i], Math.round(g.mu * 10) / 10, Math.round(g.sd * 10) / 10]);
row.names = tw.names; row.pmask = tw.pmask; row.slots = tw.slots;
const round = (o: any) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v)));

if (mode === "real") {
  row.hs = hindsightSlots(real.actual, real.played);
  const team = S.weeks.find((x: any) => x.week === week).teams[rid];
  if (team.human_slot_points && team.starters) {
    const pidx = new Map<string, number>(team.players.map((p: string, i: number) => [p, i]));
    row.human = { total: team.human_points, slots: team.starters.map((pid: string, s: number) => {
      const x = team.human_slot_points[s]; const p = pidx.get(pid);
      if (p === undefined) return { p: -1, x, g: -1, how: pid ? "offroster" : "none", tSec: null };
      const glp = tw.byPlayer[p]; const k = glp.findIndex((gi) => real.played[gi] && Math.abs(real.actual[gi] - x) < 1e-6);
      if (k < 0 || x === 0) return { p, x, g: -1, how: "unmatched", tSec: null };
      const gi = glp[k]; return { p, x, g: gi, how: k === glp.length - 1 ? "end" : "lock", tSec: tw.games[gi].end, tDeadline: k + 1 < glp.length ? tw.games[glp[k + 1]].tip : null };
    }) };
  }
  row.pols = {};
  for (const pn of pols) {
    const run = traced(pn, seed, real.actual, real.played, `w${week} r${rid} ${pn} real`);
    const an = analyse(run, real.actual, real.played);
    row.pols[pn] = round({ total: run.total, recount: run.recount, ms: run.ms, L: Object.entries(run.rep.counts).filter(([k]) => k.startsWith("L_")), W: an.W, slots: an.slots, dec: an.dec, race: run.log });
  }
} else {
  const NSC = Number(process.env.NSC || 5); const sc = PL.scenarios(tw, NSC, seed * 13 + 7); row.pols = {};
  for (const pn of pols) {
    row.pols[pn] = [];
    sc.forEach((s, k) => {
      const run = traced(pn, seed + 7919 * (k + 1), s.actual, s.played, `w${week} r${rid} ${pn} sim${k}`);
      const an = analyse(run, s.actual, s.played);
      row.pols[pn].push(round({ total: run.total, W: an.W, dec: an.dec, ms: run.ms, L: Object.entries(run.rep.counts).filter(([kk]) => kk.startsWith("L_")), nRace: run.log.length, raceGain: run.log.map((x: any) => x.c.slice(1).reduce((m: number, c: any) => Math.max(m, c[3]), -99)) }));
    });
  }
  row.HS = sc.map((s) => L.hindsightValue(tw.slots, tw.pmask, tw.byPlayer, s.actual, s.played, E.assignExact));
}
row.ms = Date.now() - t0;
fs.writeFileSync(out, JSON.stringify(row));
