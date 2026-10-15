// P8: Lagrangian index policy (ENGINE_V2 Phase 2).
// Slot prices mu (points per slot and time bucket) come from minimising the Lagrangian bound (lib/engine/lagrange.ts)
// for the team-week, at week start and optionally re-solved from the current state. Every decision is read off each
// player's own priced DP, and conflicts at a tip-off are resolved jointly by an exact max-weight assignment:
//  - a player tipping off: start in slot s  (value = his DP value of starting, net of the price of s during his game)
//                          vs bench         (his DP value of skipping tonight)
//  - a held score x whose own game tips now (deadline): lock in s (x minus the price of s for the rest of the week)
//                          or start the new game in s, vs let go and bench
//  - any other held score: keep holding in s (price of s now, then the cheapest eligible slots, then lock at his next
//                          tip-off) or lock in s, vs let go (his DP value from his next game on). A held score keeps a
//                          free slot whenever nobody values it more (holding never loses: he can still be let go later).
// No blanket rule (holdYield / reserve): "keep holding and sit tonight's player" happens when the prices say so; later
// tip-offs are reserved through the prices. Every kept held score is seated by the assignment, so a lock can never
// strand a teammate, and deadline lock-or-let-go and tonight's start are one joint decision.
import * as E from "./core";
import * as L from "./lagrange";
import { reach } from "./moves";

export interface IndexOpts {
  // re-solve the prices from the current state: never / at each day's first tip-off / at every tip-off / at a tip-off
  // only when some game ended since the last solve (new information)
  resolve: "never" | "day" | "tip" | "info";
  weekIters?: number;               // Adam iterations per stage for the week-start prices (default 100k)
  iters?: number;                   // warm-started iterations per re-solve (default 3000)
  lr?: number;                      // re-solve rate (default 0.03)
  // after the priced assignment, start leftover tipping players in free slots (best unpriced advantage first):
  // "idle" only where no later-tipping player could use the slot during his game, "all" anywhere, "none" never
  fill?: "none" | "idle" | "all";
  slot?: string;                    // price state used ("top": real decisions; rollouts use their own, seeded from top)
  keep?: number;                    // extra weight (pts) for keeping a positive held score (default 0)
  fresh?: boolean;                  // every simulate() call starts from the week-start prices (independent simulations
                                    // started mid-week, e.g. the live app's projections); otherwise only at event 0
  tilt?: number;                    // risk dial (Phase 5, lib/engine/p11.ts): game means shifted by tilt * sd^2 in the priced
                                    // DPs (lagrange gameDist); a re-solve is forced when the current view has another tilt
}
// ---------------- prices ----------------
interface View { Tb: L.Tables; si: L.StateInstance; t0: number; bound: number; id: number; tilt: number }
interface Cache { week: View; slots: Map<string, { cur: View; day: number; ends: number }>; solves: number; solveMs: number; endTimes: number[]; memo: Map<string, View>; hits: number }
const CACHE = new WeakMap<E.TeamWeek, Cache>();
let VIEW_ID = 0;
export function priceStats(tw: E.TeamWeek) { const c = CACHE.get(tw); return c ? { solves: c.solves, solveMs: c.solveMs, weekBound: c.week.bound, memoHits: c.hits } : null; }
// A warm re-solve is a pure function of (the prices it starts from, the state fromState reads, t, iterations, rate):
// rollouts that reach the same state from the same prices (e.g. every continuation of one candidate at the later
// tip-offs of the same night, before any game ends) share it. LRU per team-week, at most MEMO_MAX views.
const MEMO_MAX = 1000;
function stateKey(st: E.State, t: number, iters: number, lr: number) {
  const f = (x: number) => (Object.is(x, -0) ? "-0" : String(x));
  let k = `${t}|${iters}|${lr}`;
  for (let s = 0; s < st.lockedBy.length; s++) k += `|${st.lockedBy[s]},${f(st.lockedPts[s])},${st.pinned[s]}`;
  for (let p = 0; p < st.isLocked.length; p++) k += `|${st.isLocked[p]},${st.inGame[p]},${st.lastPlayed[p]},${f(st.pendingX[p])}`;
  return k;
}
const slotOf = (c: Cache, name: string) => { let x = c.slots.get(name); if (!x) { x = { cur: c.week, day: -1, ends: 0 }; c.slots.set(name, x); } return x; };
const endedBy = (c: Cache, t: number) => { let lo = 0, hi = c.endTimes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c.endTimes[m] <= t) lo = m + 1; else hi = m; } return lo; };
function solveView(tw: E.TeamWeek, st: E.State, t: number, iters: number, lr: number, from?: View, tilt = 0): View {
  const si = L.fromState(tw, st, t, tilt);
  let mu0: Float64Array | undefined;
  const P = L.prepare(si.inst);
  if (from) { // warm start: new buckets are unions of old ones, slots a subset
    const oP = from.Tb.P, oB = oP.B, B = P.B; mu0 = new Float64Array(P.nS * B);
    for (let s = 0; s < P.nS; s++) {
      const os = from.si.instSlot[si.slotOf[s]]; if (os < 0) continue;
      for (let b = 0; b < B; b++) {
        const a = oP.bucketOf.get(P.times[b]), e = oP.bucketOf.get(P.times[b + 1]);
        if (a === undefined || e === undefined) continue;
        let v = 0; for (let k = a; k < e; k++) v += from.Tb.mu[os * oB + k]; mu0[s * B + b] = v;
      }
    }
  }
  const r = from ? L.minimizeBound(si.inst, { method: "adam", lr, iters, mu0 }) : L.tightBound(si.inst, iters);
  return { Tb: L.tables(r.P, r.mu), si, t0: t, bound: r.bound, id: ++VIEW_ID, tilt };
}
const sameLocks = (v: View, st: E.State) => { for (let s = 0; s < st.lockedBy.length; s++) if ((v.si.instSlot[s] < 0) !== (st.lockedBy[s] >= 0)) return false; return true; };
// prices for a decision at time t; top-level policies may re-solve, rollout bases (resolve "never") reuse them
function pricesAt(tw: E.TeamWeek, pol: E.Policy, st: E.State, t: number): View {
  const o = pol.index!;
  let c = CACHE.get(tw);
  if (!c) {
    const t0 = Math.min(...tw.games.map((g) => g.tip));
    const t1 = Date.now(); const week = solveView(tw, E.initState(tw), t0, o.weekIters ?? 100000, 0);
    c = { week, slots: new Map(), solves: 1, solveMs: Date.now() - t1, endTimes: tw.games.map((g) => g.end).sort((a, b) => a - b), memo: new Map(), hits: 0 }; CACHE.set(tw, c);
  }
  const ps = slotOf(c, o.slot ?? "top"); const day = E.dayEnd(t); const ends = endedBy(c, t); const tilt = o.tilt ?? 0;
  if (o.resolve === "tip" || (o.resolve === "day" && day !== ps.day) || (o.resolve === "info" && ends !== ps.ends) || (o.resolve !== "never" && ps.cur.tilt !== tilt)) {
    // (a view of this very moment is reused only if it was solved for the same locked slots: a price state seeded from
    // another simulation at the same time would map a free slot to none, and NaN prices would drop held scores)
    if (ps.cur.t0 !== t || !sameLocks(ps.cur, st) || ps.cur.tilt !== tilt) {
      // (re-solving only after new results, "info", the states hardly ever repeat: no memo)
      const it = o.iters ?? 100, lr = o.lr ?? 0.03; const key = o.resolve === "info" ? "" : `${ps.cur.id}#${stateKey(st, t, it, lr)}${tilt ? `#${tilt}` : ""}`;
      const hit = key ? c.memo.get(key) : undefined;
      if (hit) { c.memo.delete(key); c.memo.set(key, hit); ps.cur = hit; c.hits++; }
      else {
        const t1 = Date.now(); const v = solveView(tw, st, t, it, lr, ps.cur, tilt); c.solves++; c.solveMs += Date.now() - t1;
        if (key) { c.memo.set(key, v); if (c.memo.size > MEMO_MAX) c.memo.delete(c.memo.keys().next().value!); }
        ps.cur = v;
      }
    }
    ps.day = day; ps.ends = ends;
  }
  return ps.cur;
}
// a new top-level simulation of this week starts: back to the week-start prices
export function resetPrices(tw: E.TeamWeek, slot = "top") { const c = CACHE.get(tw); if (c) { const ps = slotOf(c, slot); ps.cur = c.week; ps.day = -1; ps.ends = 0; } }
// a rollout starts from the real decision's current prices
export function seedPrices(tw: E.TeamWeek, to: string, from = "top") { const c = CACHE.get(tw); if (c) { const a = slotOf(c, from), b = slotOf(c, to); b.cur = a.cur; b.day = a.day; b.ends = a.ends; } }
// a price state saved and restored (research: continue several policies from one mid-week state, research/p11run.ts)
export function savePrices(tw: E.TeamWeek, slot = "top") { const c = CACHE.get(tw); if (!c) return null; const a = slotOf(c, slot); return { cur: a.cur, day: a.day, ends: a.ends }; }
export function restorePrices(tw: E.TeamWeek, saved: ReturnType<typeof savePrices>, slot = "top") { const c = CACHE.get(tw); if (c && saved) { const a = slotOf(c, slot); a.cur = saved.cur; a.day = saved.day; a.ends = saved.ends; } }

// ---------------- values from the priced DPs ----------------
function playProb(tw: E.TeamWeek, p: number, gi: number, lp: number) {
  const ov = tw.pNext?.[p]; if (ov != null && tw.nextGameIdx?.[p] === gi) return ov;
  return lp ? tw.dnp.p1 : tw.dnp.p0;
}
class Values {
  constructor(readonly tw: E.TeamWeek, readonly v: View, readonly bt: number) {}
  private k(gi: number) { const ig = this.v.si.instGame[gi]; return ig < 0 ? -1 : this.v.Tb.P.gl[this.v.Tb.P.inst.games[ig].p].indexOf(ig); }
  // position of the player's next game tipping at or after t in the price instance (n if none)
  nextK(p: number, t: number) { const P = this.v.Tb.P; const l = P.gl[p]; let k = 0; while (k < l.length && P.inst.games[l[k]].tip < t) k++; return k; }
  C(p: number, k: number, lp: number) { const C = this.v.Tb.C[p]; return k * 2 + lp < C.length ? C[k * 2 + lp] : 0; }
  n(p: number) { return this.v.Tb.P.gl[p].length; }
  // tonight's game gi: [start value per tw slot (NaN if not eligible/free), bench value]
  startVals(p: number, gi: number, lp: number, free: number): [Float64Array, number] {
    const { Tb } = this.v; const P = Tb.P; const W = Tb.W;
    const k = this.k(gi); const ig = P.gl[p][k]; const g = P.inst.games[ig];
    const q = playProb(this.tw, p, gi, lp);
    const c1 = this.C(p, k + 1, 1), c0 = this.C(p, k + 1, 0);
    const bench = q * c1 + (1 - q) * c0;
    const after = q * (L.eMaxDist(g.dist, Tb.thr[p][k]) - Tb.kap[p][k]) + (1 - q) * c0;
    const out = new Float64Array(this.tw.slots.length).fill(NaN);
    for (let s = 0; s < out.length; s++) {
      if (!((free >> s) & 1) || !(this.tw.slots[s] & this.tw.pmask[p])) continue;
      const is = this.v.si.instSlot[s]; if (is < 0) continue;
      out[s] = -(Tb.Ps[is * W + P.gE[ig]] - Tb.Ps[is * W + P.gA[ig]]) + after;
    }
    return [out, bench];
  }
  // value of starting tonight's game before the slot's own price (the same for every slot)
  rawStart(p: number, gi: number, lp: number) {
    const { Tb } = this.v; const P = Tb.P; const k = this.k(gi); const g = P.inst.games[P.gl[p][k]];
    const q = playProb(this.tw, p, gi, lp);
    return q * (L.eMaxDist(g.dist, Tb.thr[p][k]) - Tb.kap[p][k]) + (1 - q) * this.C(p, k + 1, 0);
  }
  // lock x into slot s now (bucket bt): x minus the price of s for the rest of the week
  lockVal(x: number, s: number) { const { Tb } = this.v; const is = this.v.si.instSlot[s]; return x - (Tb.Ps[is * Tb.W + Tb.P.B] - Tb.Ps[is * Tb.W + this.bt]); }
  // keep holding x in slot s now, then cheapest slots, then lock at his next tip-off (or count at week end)
  holdVal(p: number, x: number, s: number, kNext: number) {
    const { Tb } = this.v; const P = Tb.P; const W = Tb.W; const m = P.maskOf[p]; const bt = this.bt;
    const is = this.v.si.instSlot[s]; const now = Tb.mu[is * P.B + bt];
    if (kNext >= this.n(p)) return x - now - (Tb.Pm[m * W + P.B] - Tb.Pm[m * W + bt + 1]);
    const nb = P.gA[P.gl[p][kNext]];
    if (nb <= bt) return -Infinity; // (his own game tips now: no holding through it)
    return x - now - (Tb.Pm[m * W + nb] - Tb.Pm[m * W + bt + 1]) - Tb.intervalMin(m, nb, P.B)[0];
  }
}

// ---------------- decisions ----------------
export interface IndexDecision { starts: Map<number, number>; locks: Map<number, number>; holds: Map<number, number> }
export type Act = 0 | 1 | 2; // 0 start, 1 lock, 2 hold
// w/act: the index policy's slot weights and the action each stands for; wa[a]: the raw priced advantage (value minus
// the let-go/bench baseline) of action a in each slot, before P8's filters (NaN-free, -Infinity = not possible)
export interface Cand { p: number; tipping: boolean; held: boolean; gi: number; w: Float64Array; act: Uint8Array; base: number; raw: number; wa: Float64Array[] }
export interface IndexContext {
  t: number; cands: Cand[]; free: number[]; best: IndexDecision; bestScore: number;
  solve: (force?: Map<number, number>, actForce?: Map<number, Act>) => { d: IndexDecision; score: number } | null;
}
const NEG = -Infinity;
// exact max-weight assignment of candidates to free slots (bitmask DP over at most 9 free slots); force: candidate ->
// +1 must be seated / -1 must not
export function assign(cands: Cand[], free: number[], force?: Map<number, number>): { pick: Int32Array; score: number } | null {
  const f = free.length, M = 1 << f, nc = cands.length;
  let dp = new Float64Array(M).fill(NEG); dp[0] = 0;
  const choice = new Int8Array(nc * M);
  for (let c = 0; c < nc; c++) {
    const nd = new Float64Array(M).fill(NEG); const fc = force?.get(c) ?? 0; const w = cands[c].w;
    for (let mask = 0; mask < M; mask++) {
      const v = dp[mask]; if (v === NEG) continue;
      if (fc <= 0 && v > nd[mask]) { nd[mask] = v; choice[c * M + mask] = 0; }
      if (fc < 0) continue;
      for (let j = 0; j < f; j++) {
        if ((mask >> j) & 1) continue; const wj = w[free[j]]; if (!(wj > NEG)) continue;
        const nm = mask | (1 << j), nv = v + wj;
        if (nv > nd[nm]) { nd[nm] = nv; choice[c * M + nm] = j + 1; }
      }
    }
    dp = nd;
  }
  let bm = -1, bv = NEG; for (let mask = 0; mask < M; mask++) if (dp[mask] > bv) { bv = dp[mask]; bm = mask; }
  if (bm < 0) return null;
  const pick = new Int32Array(nc).fill(-1); let mask = bm;
  for (let c = nc - 1; c >= 0; c--) { const j = choice[c * M + mask]; if (j > 0) { pick[c] = free[j - 1]; mask &= ~(1 << (j - 1)); } }
  return { pick, score: bv };
}
export function toDecision(cands: Cand[], pick: Int32Array, actForce?: Map<number, Act>): IndexDecision {
  const d: IndexDecision = { starts: new Map(), locks: new Map(), holds: new Map() };
  cands.forEach((c, i) => {
    const s = pick[i]; if (s < 0) return;
    const a = actForce?.get(i) ?? c.act[s];
    (a === 0 ? d.starts : a === 1 ? d.locks : d.holds).set(c.p, s);
  });
  return d;
}

export function indexContext(tw: E.TeamWeek, pol: E.Policy, st: E.State, e: E.Ev): IndexContext | null {
  const t = e.t; const nS = tw.slots.length;
  const tipGame = new Map<number, number>(); for (const g of e.group!) if (!st.isLocked[tw.games[g].p] && E.usable(tw, tw.games[g].p, t)) tipGame.set(tw.games[g].p, g);
  if (!tipGame.size) return null; // only locked players tip: nothing to decide (held scores stay)
  const v = pricesAt(tw, pol, st, t);
  const bt = v.Tb.P.bucketOf.get(t); if (bt === undefined) throw new Error("p8: decision time is not a bucket boundary");
  const V = new Values(tw, v, bt);
  const freeMask = E.unpinnedOpen(st); const free: number[] = []; for (let s = 0; s < nS; s++) if ((freeMask >> s) & 1) free.push(s);
  const cands: Cand[] = [];
  for (let p = 0; p < tw.pmask.length; p++) {
    if (st.isLocked[p] || st.inGame[p] >= 0) continue;
    const held = !Number.isNaN(st.pendingX[p]); const gi = tipGame.get(p);
    if (gi === undefined && !held) continue;
    const w = new Float64Array(nS).fill(NEG); const act = new Uint8Array(nS); const lp = st.lastPlayed[p] ? 1 : 0;
    const wa = [0, 1, 2].map(() => new Float64Array(nS).fill(NEG));
    let base: number, raw = 0;
    if (gi !== undefined) {
      const [sv, bench] = V.startVals(p, gi, lp, freeMask); base = bench; raw = V.rawStart(p, gi, lp) - bench;
      for (const s of free) {
        if (Number.isNaN(sv[s])) continue;
        let val = sv[s], a: Act = 0; wa[0][s] = val - bench;
        if (held) { const lv = V.lockVal(st.pendingX[p], s); wa[1][s] = lv - bench; if (lv > val) { val = lv; a = 1; } } // deadline: lock or play
        if (val - base > 1e-9) { w[s] = val - base; act[s] = a; }
      }
    } else {
      const x = st.pendingX[p]; const kn = V.nextK(p, t); base = V.C(p, kn, lp); // let go: his DP value from his next game on
      // Holding is slot-independent (his best hold value: held players can be rearranged freely, so price noise between
      // interchangeable slots must not decide who keeps a slot); a lock is slot-specific and needs a real advantage.
      // A score kept only as an option gets a tiny weight (keeps a free slot when nobody values it more), staying put
      // breaks ties (no needless moves). Option keep (default 0) adds pts for keeping a positive score.
      let hvMax = -Infinity; for (const s of free) if (tw.slots[s] & tw.pmask[p]) hvMax = Math.max(hvMax, V.holdVal(p, x, s, kn));
      const holdW = Math.max(hvMax - base, 0) + 1e-6 * (1 + Math.max(0, x) / 100) + (x > 0 ? (pol.index!.keep ?? 0) : 0);
      for (const s of free) {
        if (!(tw.slots[s] & tw.pmask[p])) continue;
        const lv = V.lockVal(x, s); wa[1][s] = lv - base; wa[2][s] = hvMax - base;
        if (lv > hvMax && lv - base > 0 && x > 0 && lv - base > holdW) { w[s] = lv - base; act[s] = 1; }
        else { w[s] = holdW + (st.lastSlot[p] === s ? 1e-7 : 0); act[s] = 2; }
      }
    }
    cands.push({ p, tipping: gi !== undefined, held, gi: gi ?? -1, w, act, base, raw, wa });
  }
  if (!cands.length) return null;
  const solve = (force?: Map<number, number>, actForce?: Map<number, Act>) => {
    let cs = cands;
    if (actForce?.size) cs = cands.map((c, i) => { const a = actForce.get(i); if (a === undefined) return c; const w = c.w.map((x, s) => (c.act[s] === a ? x : NEG)); return { ...c, w }; });
    const r = assign(cs, free, force); if (!r) return null;
    const d = toDecision(cs, r.pick, actForce);
    const fill = pol.index!.fill ?? "idle"; if (fill !== "none") fillIdle(tw, st, t, cs, d, free, fill, force);
    return { d, score: r.score };
  };
  const b = solve()!;
  return { t, cands, free, best: b.d, bestScore: b.score, solve };
}

// diagnostics: the pieces of a tipping player's start value (bench value, value after the game, slot charges)
export function debugStart(tw: E.TeamWeek, pol: E.Policy, st: E.State, e: E.Ev, p: number) {
  const v = pricesAt(tw, pol, st, e.t); const bt = v.Tb.P.bucketOf.get(e.t)!; const V = new Values(tw, v, bt);
  const gi = e.group!.find((g) => tw.games[g].p === p)!; const lp = st.lastPlayed[p] ? 1 : 0;
  const [sv, bench] = V.startVals(p, gi, lp, (1 << tw.slots.length) - 1);
  const ig = v.si.instGame[gi]; const P = v.Tb.P; const W = v.Tb.W;
  const charges = Array.from(sv, (x, s) => { const is = v.si.instSlot[s]; return Number.isNaN(x) || is < 0 ? NaN : v.Tb.Ps[is * W + P.gE[ig]] - v.Tb.Ps[is * W + P.gA[ig]]; });
  const after = Array.from(sv).find((x, s) => !Number.isNaN(x))! + charges.find((x) => !Number.isNaN(x))!;
  return { bench, after, charges };
}
// Start leftover tipping players in free slots the decision leaves empty (starting is a free option when nobody else
// needs the slot during his game; "all" ignores later demand). Narrowest eligible slot first.
export function fillIdle(tw: E.TeamWeek, st: E.State, t: number, cands: Cand[], d: IndexDecision, free: number[], mode: "idle" | "all", force?: Map<number, number>) {
  const used = new Set<number>([...d.starts.values(), ...d.locks.values(), ...d.holds.values()]);
  const left = free.filter((s) => !used.has(s)).sort((a, b) => popc(tw.slots[a]) - popc(tw.slots[b]));
  const order = cands.map((c, i) => [c, i] as [Cand, number]).filter(([c, i]) => c.tipping && !d.starts.has(c.p) && !d.locks.has(c.p) && (force?.get(i) ?? 0) >= 0).sort((a, b) => b[0].raw - a[0].raw);
  for (const [c] of order) {
    const end = tw.games[c.gi].end;
    const s = left.find((s) => (tw.slots[s] & tw.pmask[c.p]) && (mode === "all" || !tw.games.some((q) => q.tip > t && q.tip < end && q.p !== c.p && !st.isLocked[q.p] && (tw.slots[s] & tw.pmask[q.p]))));
    if (s === undefined) continue;
    d.starts.set(c.p, s); left.splice(left.indexOf(s), 1);
  }
}
const popc = (x: number) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
// apply a complete decision at a tip-off: locks, starts; held scores not kept (or tipping) are let go
export function applyIndexDecision(tw: E.TeamWeek, st: E.State, e: E.Ev, d: IndexDecision) {
  for (const [p, s] of d.locks) E.doLock(st, p, s);
  const tip = new Map<number, number>(); for (const g of e.group!) tip.set(tw.games[g].p, g);
  for (const [p, s] of d.starts) { const gi = tip.get(p)!; st.inGame[p] = gi; st.started[gi] = 1; st.pinned[s] = p; st.pinnedUntil[s] = tw.games[gi].end; st.lastSlot[p] = s; st.pendingX[p] = NaN; }
  for (let p = 0; p < tw.pmask.length; p++) if (!st.isLocked[p] && !Number.isNaN(st.pendingX[p]) && !d.holds.has(p)) st.pendingX[p] = NaN;
  for (const [p, s] of d.holds) st.lastSlot[p] = s;
}

export function indexGroup(tw: E.TeamWeek, pol: E.Policy, st: E.State, e: E.Ev, evIdx: number, hooks?: E.Hooks) {
  const ctx = indexContext(tw, pol, st, e); if (!ctx) return;
  const alt = hooks?.decideIndex?.(st, e.t, evIdx, ctx);
  applyIndexDecision(tw, st, e, reachable(tw, st, ctx, alt ?? ctx.best));
}
// Rule 9: the rearrangement must be reachable by legal moves without benching a kept held score. Held players sit where
// they were last placed (lastSlot). Keep the decision if reachable; else seat held players in an equivalent reachable
// arrangement; else re-decide with every held player staying where he is (always reachable: starters enter empty slots).
export function reachable(tw: E.TeamWeek, st: E.State, ctx: IndexContext, d: IndexDecision): IndexDecision {
  const kept = [...d.holds.keys()], lockers = [...d.locks.keys()].filter((p) => !Number.isNaN(st.pendingX[p]) && st.lastSlot[p] >= 0);
  const players = [...kept, ...lockers]; if (!players.length) return d;
  const cur = players.map((p) => st.lastSlot[p]);
  const movable = E.unpinnedOpen(st);
  if (cur.some((s) => s < 0 || !((movable >> s) & 1))) return d; // (unknown position: nothing to check)
  const tgt = players.map((p, i) => (i < kept.length ? d.holds.get(p)! : d.locks.get(p)!));
  const exact = reach(tw.slots, tw.pmask, movable, players, cur, (a) => a.every((s, i) => s === tgt[i]));
  if (exact && exact !== "capped") return d;
  const blocked = new Set<number>([...d.starts.values(), ...d.locks.values()]);
  const eq = reach(tw.slots, tw.pmask, movable, players, cur, (a) => a.every((s, i) => (i >= kept.length ? s === tgt[i] : !blocked.has(s))));
  if (eq && eq !== "capped") { const holds = new Map(kept.map((p, i) => [p, eq.pos[i]] as [number, number])); return { ...d, holds }; }
  // fall back: held scores may only keep (or lock in) the slot they sit in (a held player whose game tips now may still
  // play anywhere: his held score is being replaced)
  const pinnedCands = ctx.cands.map((c) => {
    if (!c.held) return c; const here = st.lastSlot[c.p];
    const w = c.w.map((x, s) => (s === here || (c.tipping && c.act[s] === 0) ? x : -Infinity)); return { ...c, w };
  });
  const r = assign(pinnedCands, ctx.free);
  return r ? toDecision(pinnedCands, r.pick) : d;
}

// Alternatives to the index decision for rollouts: seat / unseat each candidate in turn, and swap lock <-> play/hold
// for held scores; the best-scoring distinct ones within `margin` index points of the best.
export function indexAlternatives(ctx: IndexContext, nAlt: number, margin: number): IndexDecision[] {
  const key = (d: IndexDecision) => [...d.starts].sort().join(";") + "|" + [...d.locks].sort().join(";") + "|" + [...d.holds.keys()].sort().join(";");
  const seen = new Set([key(ctx.best)]); const out: { d: IndexDecision; score: number }[] = [];
  const consider = (r: { d: IndexDecision; score: number } | null) => { if (!r || r.score < ctx.bestScore - margin) return; const k = key(r.d); if (seen.has(k)) return; seen.add(k); out.push(r); };
  const seated = (c: Cand) => ctx.best.starts.has(c.p) || ctx.best.locks.has(c.p) || ctx.best.holds.has(c.p);
  ctx.cands.forEach((c, i) => {
    if (c.held && !c.tipping && !seated(c)) return; // nobody to displace for a let-go held score other than via others
    consider(ctx.solve(new Map([[i, seated(c) ? -1 : 1]])));
    if (c.held) { // lock instead of play/hold, or the other way round
      const now = ctx.best.locks.has(c.p) ? (c.tipping ? 0 : 2) : 1;
      consider(ctx.solve(new Map([[i, 1]]), new Map([[i, now as Act]])));
    }
  });
  return out.sort((a, b) => b.score - a.score).slice(0, nAlt).map((x) => x.d);
}

// P9: P8 + rollouts. At each tip-off the index decision and its closest alternatives are each scored by K
// continuations of the week (common random numbers) with the P8 rule as the base; a change needs a clear gain.
export function indexRolloutHooks(tw: E.TeamWeek, base: E.Policy, events: E.Ev[], K: number, seed: number,
  realised: { actual: Float64Array; played: Uint8Array }, opts: { nAlt?: number; margin?: number; minGain?: number } = {}): E.Hooks {
  const r = E.rng(seed ^ 0x2545f491);
  return {
    decideIndex: (st, t, evIdx, ctx) => {
      const alts = indexAlternatives(ctx, opts.nAlt ?? 4, opts.margin ?? 10);
      if (!alts.length) return undefined;
      const ds = [ctx.best, ...alts]; const sc = new Float64Array(ds.length); const e = events[evIdx];
      for (let k = 0; k < K; k++) {
        const scen = E.sampleScenario(tw, st, t, r, realised);
        ds.forEach((d, i) => { const s2 = E.cloneState(st); applyIndexDecision(tw, s2, e, d); seedPrices(tw, base.index?.slot ?? "roll"); sc[i] += E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total; });
      }
      let bi = 0; for (let i = 1; i < ds.length; i++) if (sc[i] > sc[bi] + 1e-9) bi = i;
      return bi > 0 && sc[bi] > sc[0] + (opts.minGain ?? 0.5) * K ? ds[bi] : undefined;
    },
  };
}
