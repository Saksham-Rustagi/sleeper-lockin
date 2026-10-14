// Lock-In engine: event-driven simulator + policies for Sleeper NBA Lock-In.
// Rules modelled (Sleeper support article 6522833 + confirmed community behaviour):
//  - A player's game is lockable only if he was in a STARTING slot at tip-off.
//  - While his game is in progress he is pinned to his slot.
//  - After it ends he may be locked (any open starting slot he is eligible for) any time
//    before his next tip-off, as long as he never touches the bench. Benching = forfeit.
//  - Locked => fixed for the week, slot consumed, no more games for him.
//  - Unlocked starter at week end => his final game counts automatically (0 if DNP).
//  - A slot can host several players in one day if their games don't overlap.

import { indexGroup, resetPrices, type IndexContext, type IndexDecision, type IndexOpts } from "./p8";

export const SLOT_MASK: Record<string, number> = { PG: 1, SG: 2, G: 3, SF: 4, PF: 8, F: 12, C: 16, UTIL: 31 };
const POS_BIT: Record<string, number> = { PG: 1, SG: 2, SF: 4, PF: 8, C: 16, G: 3, F: 12 };
export function posMask(pos: string[]): number {
  let m = 0;
  for (const p of pos) m |= POS_BIT[p] ?? 0;
  return m || 31;
}

export interface Game {
  p: number;          // player index
  tip: number;        // ms
  end: number;        // ms (slot released / lock decision possible)
  mu: number;         // calibrated mean if he plays
  sd: number;
  projRaw: number;    // raw projection shown to user (for app-baseline policy)
  actual: number;     // realised fantasy points (0 if DNP)
  played: boolean;
}
export interface DnpModel { p1: number; p0: number } // P(play | played last), P(play | missed last)
export interface TeamWeek {
  slots: number[];           // slot eligibility masks in Sleeper order
  slotNames: string[];
  pmask: number[];           // per-player position mask
  names: string[];
  games: Game[];             // sorted by tip
  byPlayer: number[][];      // game indices per player sorted by tip
  lastPlayed0: number[];     // DNP-chain state entering the week (1 played last game, 0 missed)
  dnp: DnpModel;
  // optional: play-probability override for each player's next not-yet-started game (injury report)
  nextGameIdx?: number[];      // game index (into games) of that next game, -1 if none
  pNext?: (number | null)[];   // override probability, null = use chain
  // optional: empirical shape of standardized score residuals (sorted quantiles of (actual-mu)/sd).
  // Real fantasy scores are right-skewed; when set, valuation and sampling use this instead of a Normal.
  resid?: ResidualShape;
  // optional roster windows (in-week streaming): player usable only for avail[p] <= t < gone[p]
  avail?: Float64Array; gone?: Float64Array;
}
export function usable(tw: TeamWeek, p: number, t: number) { return !tw.avail || (tw.avail[p] <= t && t < tw.gone![p]); }
export interface ResidualShape { q: Float64Array; g: Float64Array; t0: number; dt: number } // g(t) = E[max(Z,t)] on a grid
export function makeResidualShape(z: number[], nq = 400): ResidualShape {
  const s = [...z].sort((a, b) => a - b);
  const q = new Float64Array(nq);
  for (let i = 0; i < nq; i++) q[i] = s[Math.min(s.length - 1, Math.floor(((i + 0.5) / nq) * s.length))];
  const t0 = -6, dt = 0.02, n = 701; const g = new Float64Array(n);
  for (let k = 0; k < n; k++) { const t = t0 + k * dt; let acc = 0; for (let i = 0; i < nq; i++) acc += q[i] > t ? q[i] : t; g[k] = acc / nq; }
  return { q, g, t0, dt };
}
export function emaxShape(sh: ResidualShape, mu: number, sd: number, v: number) {
  const t = (v - mu) / sd; const x = (t - sh.t0) / sh.dt;
  if (x <= 0) return mu + sd * sh.g[0]; // v far below: E[max] = E[X]
  if (x >= sh.g.length - 1) return v;
  const k = Math.floor(x); const f = x - k;
  return mu + sd * (sh.g[k] * (1 - f) + sh.g[k + 1] * f);
}

export interface Policy {
  name: string;
  matching: "exact" | "appGreedy";
  value: "stop" | "rawMax";
  defer: boolean;     // hold lockable players until deadline instead of deciding at final buzzer
  reserve: boolean;   // at tip-off, reserve slots for overlapping later games
  chain: boolean;     // allow re-using a slot later the same day after a game ends
  rollout?: { objective: "points" | "win" | "softwin"; K: number; margin: number };
  lockAware?: boolean; // place starters in the slot they'd be locked into after a good game (fewer moves, no blocked slots)
  eps?: number;
  // learned lock rule (approximate policy iteration): lock iff score >= coef · lockFeatures(...)
  cutoff?: number[];
  // a held score never keeps a slot that tonight's (or a reserved) game wants; he must be locked or let go
  holdYield?: boolean;
  // re-enable bugs fixed in engine-v2 phase 1 (to measure each fix): true = all of them
  legacyBugs?: boolean | LegacyBug[];
  // P8: Lagrangian index policy (lib/engine/p8.ts) instead of the rule; ignores lockAware/holdYield/reserve
  index?: IndexOpts;
}
// strand:  a lock could take the slot a held teammate needs right now (hidden forfeit, sometimes still counted)
// negEnd:  a negative held final-game score counted at week end (and valued as mu) instead of benched to 0
// reseat:  a lineup changed by start/sit simulations left held scores forfeited although a slot had become free
// stop:    stopValue used unconditional play probabilities for later games instead of the DNP-chain DP
// heldTie: with holdYield every held score had the same tiny slot weight, so which held scores kept a slot on a
//          crowded night was arbitrary (a held 0 could stay while a held 14 was let go)
export type LegacyBug = "strand" | "negEnd" | "reseat" | "stop" | "heldTie";
export function legacy(pol: Policy | undefined, b: LegacyBug): boolean {
  const l = pol?.legacyBugs; return l === true || (Array.isArray(l) && l.includes(b));
}
// Features of a lock decision for the learned cut-off. [1, heuristic cut-off, own future value, open slots,
// eligible future games per open slot, fraction of week left, own games left, and three interactions with time]
export function lockFeatures(tw: TeamWeek, pol: Policy, st: State, p: number, t: number, ev: LockEval): number[] {
  const X = st.pendingX[p]; const h = ev.cont - (ev.lockBest - X);
  const sv = futureValue(tw, pol, st, p, t);
  const open = openMaskOf(st); let nOpen = 0, elig = 0;
  for (let s = 0; s < tw.slots.length; s++) if ((open >> s) & 1) { nOpen++; elig |= tw.slots[s]; }
  let gl = 0; for (const g of tw.games) if (g.tip > t && g.p !== p && !st.isLocked[g.p] && (tw.pmask[g.p] & elig)) gl++;
  const gps = gl / Math.max(1, nOpen);
  const t0 = tw.games.length ? tw.games[0].tip : t, t1 = tw.games.length ? tw.games[tw.games.length - 1].tip : t;
  const frac = Math.min(1, Math.max(0, (t1 - t) / Math.max(1, t1 - t0)));
  const pg = tw.byPlayer[p].length - nextIdx(tw, p, t);
  return [1, h, sv, nOpen, gps, frac, pg, h * frac, gps * frac, sv * frac];
}
// The base policy's lock-or-not at a deadline (before any rollout hook overrides it).
export function baseLockChoice(tw: TeamWeek, pol: Policy, st: State, p: number, t: number, ev: LockEval): number | null {
  if (!Number.isFinite(ev.lockBest) || ev.lockSlot < 0) return null;
  if (pol.cutoff) { const f = lockFeatures(tw, pol, st, p, t, ev); let c = 0; for (let i = 0; i < f.length; i++) c += pol.cutoff[i] * f[i]; return st.pendingX[p] >= c ? ev.lockSlot : null; }
  return ev.lockBest >= ev.cont + (pol.eps ?? 0) ? ev.lockSlot : null;
}

// ---------------- RNG ----------------
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(r: () => number) {
  let u = 0; while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ---------------- math ----------------
function normPdf(z: number) { return Math.exp(-0.5 * z * z) / 2.5066282746310002; }
export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
// E[max(X, v)] for X ~ N(mu, sd)
export function emax(mu: number, sd: number, v: number) {
  const z = (mu - v) / sd;
  return v + (mu - v) * normCdf(z) + sd * normPdf(z);
}

// ---------------- state ----------------
export interface State {
  lockedBy: Int32Array;   // slot -> player or -1
  lockedPts: Float64Array;
  pinned: Int32Array;     // slot -> in-game player or -1
  pinnedUntil: Float64Array;
  isLocked: Uint8Array;   // player
  pendingX: Float64Array; // player -> lockable score or NaN
  inGame: Int32Array;     // player -> game idx or -1
  lastPlayed: Uint8Array; // player
  started: Uint8Array;    // game -> started?
  lastSlot: Int32Array;   // player -> slot he occupied during his most recent started game (-1 none)
  locks: number; lockMoves: number; // stats: locks made, and locks that required moving him to another slot first
}
export function initState(tw: TeamWeek): State {
  const nS = tw.slots.length, nP = tw.pmask.length;
  const s: State = {
    lockedBy: new Int32Array(nS).fill(-1), lockedPts: new Float64Array(nS), pinned: new Int32Array(nS).fill(-1),
    pinnedUntil: new Float64Array(nS), isLocked: new Uint8Array(nP), pendingX: new Float64Array(nP).fill(NaN),
    inGame: new Int32Array(nP).fill(-1), lastPlayed: Uint8Array.from(tw.lastPlayed0), started: new Uint8Array(tw.games.length),
    lastSlot: new Int32Array(nP).fill(-1), locks: 0, lockMoves: 0,
  };
  return s;
}
export function cloneState(s: State): State {
  return {
    lockedBy: s.lockedBy.slice(), lockedPts: s.lockedPts.slice(), pinned: s.pinned.slice(), pinnedUntil: s.pinnedUntil.slice(),
    isLocked: s.isLocked.slice(), pendingX: s.pendingX.slice(), inGame: s.inGame.slice(), lastPlayed: s.lastPlayed.slice(),
    started: s.started.slice(), lastSlot: s.lastSlot.slice(), locks: s.locks, lockMoves: s.lockMoves,
  };
}

// ---------------- events ----------------
// kind: 0 = END(game), 1 = DEADLINE(game: decide pending of that player before this tip), 2 = TIP group start
export interface Ev { t: number; kind: 0 | 1 | 2; g: number; group?: number[] }
export function buildEvents(tw: TeamWeek, chain: boolean): Ev[] {
  const ev: Ev[] = [];
  const groups = new Map<number, number[]>();
  tw.games.forEach((g, i) => {
    ev.push({ t: chain ? g.end : dayEnd(g.tip), kind: 0, g: i });
    ev.push({ t: g.tip, kind: 1, g: i });
    if (!groups.has(g.tip)) groups.set(g.tip, []);
    groups.get(g.tip)!.push(i);
  });
  for (const [t, gs] of groups) ev.push({ t, kind: 2, g: gs[0], group: gs });
  ev.sort((a, b) => a.t - b.t || a.kind - b.kind);
  return ev;
}
export function dayEnd(tip: number) {
  // next 11:00 UTC (= 6-7am ET) after tip
  const d = new Date(tip); const e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11);
  return e > tip ? e : e + 86400000;
}

// ---------------- valuation ----------------
const emaxG = (tw: TeamWeek, g: Game, v: number) => (tw.resid ? emaxShape(tw.resid, g.mu, g.sd, v) : emax(g.mu, g.sd, v));
function playProb(tw: TeamWeek, p: number, gi: number, lastPlayed: number) {
  const ov = tw.pNext?.[p]; if (ov != null && tw.nextGameIdx?.[p] === gi) return ov;
  return lastPlayed ? tw.dnp.p1 : tw.dnp.p0;
}
// Optimal-stopping value of a player's games from index fromIdx on (he starts every game until his score is kept),
// given whether he played his last game. Exact DP over the DNP chain: whether he plays game k is seen before game
// k+1, so later play probabilities are conditional on it. His final game counts at week end unless negative (then he
// is benched: rule 4). pol carries legacy flags ("stop": unconditional play marginals; "negEnd": final game = mu).
export function stopValue(tw: TeamWeek, p: number, fromIdx: number, lastPlayed: number, pol?: Policy): number {
  const gl = tw.byPlayer[p];
  if (fromIdx >= gl.length) return 0;
  if (!legacy(pol, "stop")) {
    const negEnd = legacy(pol, "negEnd");
    let v1 = 0, v0 = 0; // value from game k+1 on, after playing / missing game k
    for (let k = gl.length - 1; k >= fromIdx; k--) {
      const g = tw.games[gl[k]];
      const play = k === gl.length - 1 && negEnd ? g.mu : emaxG(tw, g, v1); // E[max(X, value of waiting)]
      const q1 = playProb(tw, p, gl[k], 1), q0 = playProb(tw, p, gl[k], 0);
      const n1 = q1 * play + (1 - q1) * v0, n0 = q0 * play + (1 - q0) * v0;
      v1 = n1; v0 = n0;
    }
    return lastPlayed ? v1 : v0;
  }
  // legacy: forward marginals
  const n = gl.length - fromIdx;
  const q = new Float64Array(n);
  let s = lastPlayed ? 1 : 0;
  for (let k = 0; k < n; k++) {
    let pk = s * tw.dnp.p1 + (1 - s) * tw.dnp.p0;
    const ov = tw.pNext?.[p];
    if (ov != null && tw.nextGameIdx?.[p] === gl[fromIdx + k]) pk = ov;
    q[k] = pk; s = pk;
  }
  // backward stopping recursion; last game counts automatically if he is still in a slot
  const last = tw.games[gl[gl.length - 1]];
  let v = q[n - 1] * (legacy(pol, "negEnd") ? last.mu : emaxG(tw, last, 0));
  for (let k = n - 2; k >= 0; k--) {
    const g = tw.games[gl[fromIdx + k]];
    v = (1 - q[k]) * v + q[k] * emaxG(tw, g, v);
  }
  return v;
}
// Value of NOT starting game k (he still plays or misses it, which moves the DNP chain) and continuing after it.
export function skipValue(tw: TeamWeek, p: number, k: number, lastPlayed: number, pol?: Policy): number {
  if (legacy(pol, "stop")) return stopValue(tw, p, k + 1, lastPlayed ? 1 : 0, pol);
  const q = playProb(tw, p, tw.byPlayer[p][k], lastPlayed);
  return q * stopValue(tw, p, k + 1, 1, pol) + (1 - q) * stopValue(tw, p, k + 1, 0, pol);
}
function rawMaxValue(tw: TeamWeek, p: number, fromIdx: number): number {
  const gl = tw.byPlayer[p]; let m = 0;
  for (let k = fromIdx; k < gl.length; k++) m = Math.max(m, tw.games[gl[k]].projRaw);
  return m;
}
export function nextIdx(tw: TeamWeek, p: number, t: number): number {
  const gl = tw.byPlayer[p]; let k = 0;
  while (k < gl.length && tw.games[gl[k]].tip <= t) k++;
  return k;
}
export function futureValue(tw: TeamWeek, pol: Policy, st: State, p: number, t: number): number {
  const k = nextIdx(tw, p, t);
  return pol.value === "stop" ? stopValue(tw, p, k, st.lastPlayed[p], pol) : rawMaxValue(tw, p, k);
}
// value of keeping player p available (not locked) from time t
export function playerValue(tw: TeamWeek, pol: Policy, st: State, p: number, t: number): number {
  const vf = futureValue(tw, pol, st, p, t);
  const x = st.pendingX[p];
  if (!Number.isNaN(x)) return pol.defer ? Math.max(x, vf) : vf;
  const gi = st.inGame[p];
  if (gi >= 0) {
    const g = tw.games[gi];
    if (pol.value === "stop") {
      const pk = st.lastPlayed[p] ? tw.dnp.p1 : tw.dnp.p0;
      if (legacy(pol, "stop")) return (1 - pk) * vf + pk * emaxG(tw, g, vf);
      // after this game: keep the score or wait, with the chain moved by whether he plays it
      const k = nextIdx(tw, p, t);
      return (1 - pk) * stopValue(tw, p, k, 0, pol) + pk * emaxG(tw, g, stopValue(tw, p, k, 1, pol));
    }
    return Math.max(g.projRaw, vf);
  }
  return vf;
}

// Max-weight assignment of players (vertex weights) to slots. Vertex-weighted bipartite matching is a
// transversal matroid => greedy by weight + augmenting paths is exact.
const SLOT_ORDER_CACHE = new Map<string, number[]>();
export function slotOrder(slots: number[]): number[] {
  const key = slots.join(",");
  let o = SLOT_ORDER_CACHE.get(key);
  if (!o) { o = slots.map((_, i) => i).sort((a, b) => popcount(slots[a]) - popcount(slots[b]) || a - b); SLOT_ORDER_CACHE.set(key, o); }
  return o;
}
function popcount(x: number) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
export function assignExact(slots: number[], openMask: number, players: number[], pm: number[], w: Float64Array | number[]):
  { total: number; slotOf: Map<number, number> } {
  const order = players.filter((p) => w[p] > 0).sort((a, b) => w[b] - w[a]);
  const matchSlot = new Int32Array(slots.length).fill(-1);
  const so = slotOrder(slots);
  let total = 0;
  const visited = new Uint8Array(slots.length);
  const tryAug = (p: number): boolean => {
    for (const s of so) {
      if (!((openMask >> s) & 1) || visited[s] || !(slots[s] & pm[p])) continue;
      visited[s] = 1;
      if (matchSlot[s] < 0 || tryAug(matchSlot[s])) { matchSlot[s] = p; return true; }
    }
    return false;
  };
  for (const p of order) { visited.fill(0); if (tryAug(p)) total += w[p]; }
  const slotOf = new Map<number, number>();
  matchSlot.forEach((p, s) => { if (p >= 0) slotOf.set(p, s); });
  return { total, slotOf };
}
// The app's original greedy: edges sorted by weight, first free eligible slot in Sleeper order.
function assignAppGreedy(slots: number[], openMask: number, players: number[], pm: number[], w: Float64Array | number[], pen?: number[]):
  { total: number; slotOf: Map<number, number> } {
  const edges: [number, number, number][] = [];
  for (const p of players) for (let s = 0; s < slots.length; s++)
    if (((openMask >> s) & 1) && (slots[s] & pm[p])) edges.push([w[p] - (pen ? pen[s] : 0), p, s]);
  edges.sort((a, b) => b[0] - a[0]);
  const used = new Uint8Array(slots.length); const slotOf = new Map<number, number>(); let total = 0;
  for (const [, p, s] of edges) if (!slotOf.has(p) && !used[s]) { slotOf.set(p, s); used[s] = 1; total += w[p]; }
  return { total, slotOf };
}
function assign(pol: Policy, tw: TeamWeek, openMask: number, players: number[], w: Float64Array | number[], pen?: number[]) {
  return pol.matching === "exact" ? assignExact(tw.slots, openMask, players, tw.pmask, w) : assignAppGreedy(tw.slots, openMask, players, tw.pmask, w, pen);
}
export function openMaskOf(st: State) { let m = 0; st.lockedBy.forEach((p, s) => { if (p < 0) m |= 1 << s; }); return m; }
export function unpinnedOpen(st: State) { let m = 0; st.lockedBy.forEach((p, s) => { if (p < 0 && st.pinned[s] < 0) m |= 1 << s; }); return m; }

// ---------------- decisions ----------------
export interface LockEval { lockBest: number; lockSlot: number; cont: number }
// Among interchangeable slots (same eligibility, e.g. UTIL 1/UTIL 2) use the one the player already sits in.
export function sameTypeHere(tw: TeamWeek, st: State, p: number, s: number, lockable: number): number {
  const here = st.lastSlot ? st.lastSlot[p] : -1;
  return here >= 0 && here !== s && tw.slots[here] === tw.slots[s] && ((lockable >> here) & 1) ? here : s;
}

// Can every held (unlocked) player other than `except` sit in the open slots `open` at once? (rule 4: a held score
// needs a starting slot at every moment; benching him forfeits it)
export function heldSeatable(tw: TeamWeek, st: State, open: number, except: number): boolean {
  const held: number[] = []; const w = new Float64Array(tw.pmask.length);
  for (let q = 0; q < tw.pmask.length; q++) if (q !== except && !st.isLocked[q] && !Number.isNaN(st.pendingX[q])) { held.push(q); w[q] = 1; }
  return !held.length || assignExact(tw.slots, open, held, tw.pmask, w).total === held.length;
}
// Locking p into s is legal and strands no held teammate.
export function lockFeasible(tw: TeamWeek, st: State, p: number, s: number): boolean {
  const lockable = unpinnedOpen(st);
  return ((lockable >> s) & 1) === 1 && (tw.slots[s] & tw.pmask[p]) !== 0 && heldSeatable(tw, st, lockable & ~(1 << s), p);
}
// A lock decision (base rule or hook) made legal: an infeasible slot falls back to the rule's slot, else no lock.
function legalLock(tw: TeamWeek, pol: Policy, st: State, p: number, s: number | null, ev: LockEval): number | null {
  if (s === null || s < 0 || legacy(pol, "strand") || lockFeasible(tw, st, p, s)) return s;
  return ev.lockSlot >= 0 && lockFeasible(tw, st, p, ev.lockSlot) ? ev.lockSlot : null;
}

export function evalLock(tw: TeamWeek, pol: Policy, st: State, p: number, t: number): LockEval {
  const x = st.pendingX[p];
  const nP = tw.pmask.length; const w = new Float64Array(nP); const others: number[] = [];
  for (let q = 0; q < nP; q++) if (!st.isLocked[q] && q !== p && (usable(tw, q, t) || !Number.isNaN(st.pendingX[q]) || st.inGame[q] >= 0)) { w[q] = playerValue(tw, pol, st, q, t); others.push(q); }
  const open = openMaskOf(st);
  w[p] = futureValue(tw, pol, st, p, t);
  const cont = assign(pol, tw, open, [...others, p], w).total;
  let lockBest = -Infinity, lockSlot = -1;
  const lockable = unpinnedOpen(st);
  const strandOk = legacy(pol, "strand");
  const seen = new Set<number>();
  for (const s of slotOrder(tw.slots)) {
    if (!((lockable >> s) & 1) || !(tw.slots[s] & tw.pmask[p]) || seen.has(tw.slots[s])) continue;
    if (!strandOk && !heldSeatable(tw, st, lockable & ~(1 << s), p)) continue; // would strand a held teammate
    seen.add(tw.slots[s]);
    const si = sameTypeHere(tw, st, p, s, lockable);
    const v = x + assign(pol, tw, open & ~(1 << si), others, w).total;
    if (v > lockBest + 1e-9) { lockBest = v; lockSlot = si; }
  }
  // Prefer locking him where he already sits when that's (practically) as good: no shuffling needed in Sleeper.
  const here = st.lastSlot ? st.lastSlot[p] : -1;
  if (pol.lockAware && here >= 0 && here !== lockSlot && ((lockable >> here) & 1) && (tw.slots[here] & tw.pmask[p]) &&
    (strandOk || heldSeatable(tw, st, lockable & ~(1 << here), p))) {
    const v = x + assign(pol, tw, open & ~(1 << here), others, w).total;
    if (v >= lockBest - 0.25) { lockSlot = here; }
  }
  return { lockBest, lockSlot, cont };
}
export function doLock(st: State, p: number, s: number) {
  st.locks++; if (st.lastSlot && st.lastSlot[p] >= 0 && st.lastSlot[p] !== s) st.lockMoves++;
  st.lockedBy[s] = p; st.lockedPts[s] = st.pendingX[p]; st.isLocked[p] = 1; st.pendingX[p] = NaN;
}

// ---------------- simulation ----------------
export interface Hooks {
  decideLock?: (st: State, p: number, t: number, evIdx: number, ev: LockEval) => number | null;
  // P8 (index policy): may return a different complete decision for this tip-off (see lib/engine/p8.ts)
  decideIndex?: (st: State, t: number, evIdx: number, ctx: IndexContext) => IndexDecision | undefined;
  // start/sit at a tip-off: may return a different player->slot map for the players tipping now
  decideStarts?: (st: State, t: number, evIdx: number, tipping: number[], pending: number[], gameOf: Map<number, number>, slotOf: Map<number, number>, free: number) => Map<number, number> | undefined;
}
// actuals: per game realised points, played flags (scenario). Returns final total.
export function simulate(tw: TeamWeek, pol: Policy, events: Ev[], actual: Float64Array, played: Uint8Array,
  st: State = initState(tw), fromEv = 0, hooks?: Hooks, toTime = Infinity): { total: number; st: State; evIdx: number } {
  const nP = tw.pmask.length; const eps = pol.eps ?? 0;
  if (pol.index && fromEv === 0) resetPrices(tw, pol.index.slot); // a new week: start from the week-start prices
  let i = fromEv;
  for (; i < events.length; i++) {
    const e = events[i];
    if (e.t > toTime) break;
    if (e.kind === 0) {
      const g = tw.games[e.g]; const p = g.p;
      st.lastPlayed[p] = played[e.g];
      if (st.inGame[p] === e.g) {
        st.inGame[p] = -1;
        for (let s = 0; s < tw.slots.length; s++) if (st.pinned[s] === p) st.pinned[s] = -1;
        st.pendingX[p] = played[e.g] ? actual[e.g] : 0;
        if (!pol.defer) {
          // decide immediately at the buzzer: lock or release
          const ev = evalLock(tw, pol, st, p, e.t);
          let s: number | null = baseLockChoice(tw, pol, st, p, e.t, ev);
          if (hooks?.decideLock) { const h = hooks.decideLock(st, p, e.t, i, ev); if (h !== undefined) s = h; }
          s = legalLock(tw, pol, st, p, s, ev);
          if (s !== null && s >= 0) doLock(st, p, s);
          else if (nextIdx(tw, p, e.t) < tw.byPlayer[p].length) st.pendingX[p] = NaN; // released (keeps auto-count only if final game)
        }
      }
    } else if (e.kind === 1) {
      const p = tw.games[e.g].p;
      if (pol.index) continue; // P8: lock-or-let-go at a deadline is part of the tip-off decision
      if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
        const ev = evalLock(tw, pol, st, p, e.t - 1);
        let s: number | null = baseLockChoice(tw, pol, st, p, e.t - 1, ev);
        if (hooks?.decideLock) { const h = hooks.decideLock(st, p, e.t - 1, i, ev); if (h !== undefined) s = h; }
        s = legalLock(tw, pol, st, p, s, ev);
        if (s !== null && s >= 0) doLock(st, p, s); else st.pendingX[p] = NaN;
      }
    } else if (pol.index) {
      indexGroup(tw, pol, st, e, i, hooks);
    } else {
      startGroup(tw, pol, st, e, events, i, hooks);
    }
  }
  let total = 0;
  for (let s = 0; s < tw.slots.length; s++) if (st.lockedBy[s] >= 0) total += st.lockedPts[s];
  if (i >= events.length) {
    // week end: unlocked starters with a pending final game count automatically (a negative one is benched first)
    const open: number[] = []; const w = new Float64Array(nP); const negEnd = legacy(pol, "negEnd");
    for (let p = 0; p < nP; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p] && (negEnd || st.pendingX[p] > 0)) { open.push(p); w[p] = st.pendingX[p] + 1000; }
    const a = assignExact(tw.slots, openMaskOf(st), open, tw.pmask, w);
    for (const p of a.slotOf.keys()) total += st.pendingX[p];
  }
  return { total, st, evIdx: i };
}

export function startGroup(tw: TeamWeek, pol: Policy, st: State, e: Ev, events: Ev[], evIdx: number, hooks?: Hooks) {
  const t = e.t; const nP = tw.pmask.length;
  const tipping = e.group!.map((g) => tw.games[g].p).filter((p) => !st.isLocked[p] && usable(tw, p, t));
  if (!tipping.length) return;
  const gameOf = new Map<number, number>(); e.group!.forEach((g) => gameOf.set(tw.games[g].p, g));
  const free = unpinnedOpen(st);
  const w = new Float64Array(nP); const cands: number[] = [];
  const pendingPlayers: number[] = [];
  for (let p = 0; p < nP; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) pendingPlayers.push(p);
  if (pol.matching === "appGreedy") {
    // original app: recommendStartsAt — projection of this game, scarcity penalty, greedy, only players tipping now
    const pen = tw.slots.map((sm) => {
      let c = 0; for (const g of tw.games) if (g.tip > t && (sm & tw.pmask[g.p])) c++;
      return Math.log(c + 1) * 0.1;
    });
    // app keeps pending players only if a slot is spare (it does not reason about holding)
    for (const p of tipping) { w[p] = tw.games[gameOf.get(p)!].projRaw; cands.push(p); }
    let freeMask = free;
    for (const p of pendingPlayers) { // pending players occupy a slot: give them lowest priority
      w[p] = 0.001; cands.push(p);
    }
    const a = assignAppGreedy(tw.slots, freeMask, cands, tw.pmask, w, pen);
    applyStarts(tw, st, a.slotOf, tipping, pendingPlayers, gameOf);
    return;
  }
  // exact: marginal value of each competing use of a free slot
  for (const p of tipping) {
    const gi = gameOf.get(p)!; const k = tw.byPlayer[p].indexOf(gi);
    const withV = pol.value === "stop" ? stopValue(tw, p, k, st.lastPlayed[p], pol) : rawMaxValue(tw, p, k);
    const without = pol.value === "stop" ? skipValue(tw, p, k, st.lastPlayed[p], pol) : rawMaxValue(tw, p, k + 1);
    w[p] = Math.max(1e-6, withV - without) + 1e-6; cands.push(p);
  }
  for (const p of pendingPlayers) {
    if (gameOf.has(p)) continue; // his own new game is tipping: pending already resolved at deadline
    const vf = futureValue(tw, pol, st, p, t);
    // holdYield: tiny weights (always below tonight's / reserved players') ordered by the held score
    w[p] = pol.holdYield ? (legacy(pol, "heldTie") ? 1e-9 : 1e-12 * (1 + Math.max(0, st.pendingX[p]))) : Math.max(1e-6, st.pendingX[p] - vf) + 1e-6; cands.push(p);
  }
  if (pol.reserve) {
    // later games that will overlap with these (or same day if no chaining) compete for the same slots
    const horizon = pol.chain ? t + 2.5 * 3600e3 : dayEnd(t);
    const seen = new Set(cands);
    for (const g of tw.games) {
      if (g.tip <= t || g.tip >= horizon || st.isLocked[g.p] || seen.has(g.p) || !usable(tw, g.p, g.tip)) continue;
      const k = tw.byPlayer[g.p].indexOf(tw.games.indexOf(g));
      const withV = stopValue(tw, g.p, k, st.lastPlayed[g.p], pol);
      const without = skipValue(tw, g.p, k, st.lastPlayed[g.p], pol);
      w[g.p] = Math.max(1e-6, withV - without); cands.push(g.p); seen.add(g.p);
    }
  }
  // A held player who would lose his slot reaches his deadline now: lock-or-release with the joint evaluation.
  let freeMask = free; let cs = cands;
  for (let iter = 0; iter < 10; iter++) {
    const a = assignExact(tw.slots, freeMask, cs, tw.pmask, w);
    const losing = pendingPlayers.filter((p) => !gameOf.has(p) && cs.includes(p) && !a.slotOf.has(p));
    let changed = false;
    for (const p of losing) {
      const ev = evalLock(tw, pol, st, p, t - 1);
      let s: number | null = baseLockChoice(tw, pol, st, p, t - 1, ev);
      if (hooks?.decideLock) { const h = hooks.decideLock(st, p, t - 1, evIdx - 1, ev); if (h !== undefined) s = h; }
      s = legalLock(tw, pol, st, p, s, ev);
      if (s !== null && s >= 0 && ((freeMask >> s) & 1)) { doLock(st, p, s); freeMask &= ~(1 << s); cs = cs.filter((q) => q !== p); changed = true; break; }
    }
    if (!changed) {
      if (pol.lockAware) lockAwarePlacement(tw, pol, st, a.slotOf, tipping, gameOf);
      const alt = hooks?.decideStarts?.(st, t, evIdx, tipping, pendingPlayers, gameOf, a.slotOf, freeMask);
      applyStarts(tw, st, finalLineup(tw, pol, st, alt ?? a.slotOf, tipping, pendingPlayers, gameOf, freeMask), tipping, pendingPlayers, gameOf); return;
    }
  }
  const a = assignExact(tw.slots, freeMask, cs, tw.pmask, w);
  if (pol.lockAware) lockAwarePlacement(tw, pol, st, a.slotOf, tipping, gameOf);
  const pend2 = pendingPlayers.filter((p) => !st.isLocked[p]);
  const alt = hooks?.decideStarts?.(st, t, evIdx, tipping, pend2, gameOf, a.slotOf, freeMask);
  applyStarts(tw, st, finalLineup(tw, pol, st, alt ?? a.slotOf, tipping, pend2, gameOf, freeMask), tipping, pend2, gameOf);
}
// The lineup actually applied: held scores that a (simulation-changed) lineup leaves without a slot are re-seated in
// any slot it leaves free; slots of tonight's starters and reserved later-tonight players stay theirs. Holding on
// is never worse than letting go now: he can still be let go later.
function finalLineup(tw: TeamWeek, pol: Policy, st: State, slotOf: Map<number, number>, tipping: number[], pending: number[], gameOf: Map<number, number>, free: number) {
  return legacy(pol, "reseat") ? slotOf : reseatHeld(tw, st, slotOf, tipping, pending, gameOf, free);
}
export function reseatHeld(tw: TeamWeek, st: State, slotOf: Map<number, number>, tipping: number[], pending: number[], gameOf: Map<number, number>, free: number): Map<number, number> {
  const held = pending.filter((p) => !gameOf.has(p) && !st.isLocked[p] && !Number.isNaN(st.pendingX[p]));
  if (held.every((p) => slotOf.has(p))) return slotOf;
  const heldSet = new Set(held); let open = free;
  for (const [p, s] of slotOf) if (!heldSet.has(p)) open &= ~(1 << s); // starters + reserved keep their slots
  // everyone the lineup already seats stays seated (may move); then as many of the others as fit, best scores first
  const w = new Float64Array(tw.pmask.length); for (const p of held) w[p] = (slotOf.has(p) ? 1000 : 1) + Math.max(0, st.pendingX[p]);
  const a = assignExact(tw.slots, open, held, tw.pmask, w);
  const m = new Map<number, number>(); for (const [p, s] of slotOf) if (!heldSet.has(p)) m.set(p, s);
  for (const [p, s] of a.slotOf) m.set(p, s);
  return m;
}

// Re-arrange (by valid moves/swaps only) the slots of players starting now so each sits where he'd be locked
// after a good game. The set of starters doesn't change. Pending/reserved candidates in the map are flexible.
export function lockAwarePlacement(tw: TeamWeek, pol: Policy, st: State, slotOf: Map<number, number>, tipping: number[], gameOf: Map<number, number>) {
  const starters = tipping.filter((p) => slotOf.has(p));
  if (!starters.length) return;
  const used = new Set(slotOf.values());
  const pref = new Map<number, number>();
  for (const p of starters) {
    const g = tw.games[gameOf.get(p)!];
    const c = cloneState(st);
    for (const q of starters) c.inGame[q] = -1;
    c.pendingX[p] = g.mu + g.sd; // "if he has a good game, where would we lock him?"
    const ev = evalLock(tw, pol, c, p, g.end);
    if (ev.lockSlot >= 0) pref.set(p, tw.slots[ev.lockSlot]);
  }
  const owner = new Map<number, number>(); for (const [p, s] of slotOf) owner.set(s, p);
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
    for (const p of starters) {
      const want = pref.get(p); const cur = slotOf.get(p)!;
      if (want === undefined || tw.slots[cur] === want) continue;
      for (let s2 = 0; s2 < tw.slots.length; s2++) {
        if (tw.slots[s2] !== want || st.lockedBy[s2] >= 0 || st.pinned[s2] >= 0) continue;
        const q = owner.get(s2);
        if (q === undefined) {
          if (!used.has(s2) || owner.get(s2) === undefined) { slotOf.set(p, s2); owner.delete(cur); owner.set(s2, p); improved = true; break; }
        } else if ((tw.slots[cur] & tw.pmask[q]) && !(starters.includes(q) && pref.get(q) === tw.slots[s2])) {
          slotOf.set(p, s2); slotOf.set(q, cur); owner.set(s2, p); owner.set(cur, q); improved = true; break;
        }
      }
    }
    if (!improved) break;
  }
}
export function applyStarts(tw: TeamWeek, st: State, slotOf: Map<number, number>, tipping: number[], pending: number[], gameOf: Map<number, number>) {
  for (const p of pending) if (!gameOf.has(p) && !slotOf.has(p)) st.pendingX[p] = NaN; // benched to make room => forfeited
  for (const p of tipping) {
    const s = slotOf.get(p);
    if (s === undefined) continue;
    const gi = gameOf.get(p)!; st.inGame[p] = gi; st.started[gi] = 1; st.pinned[s] = p; st.pinnedUntil[s] = tw.games[gi].end; st.lastSlot[p] = s;
    st.pendingX[p] = NaN;
  }
}

// ---------------- scenario sampling ----------------
// Sample a scenario: games with tip < t keep their realised values (they're known or in progress);
// in-progress & future games are drawn from the model.
export function sampleScenario(tw: TeamWeek, st: State | null, t: number, r: () => number, base: { actual: Float64Array; played: Uint8Array }) {
  const actual = base.actual.slice(); const played = base.played.slice();
  const nP = tw.pmask.length;
  for (let p = 0; p < nP; p++) {
    let last = st ? st.lastPlayed[p] : tw.lastPlayed0[p];
    for (const gi of tw.byPlayer[p]) {
      const g = tw.games[gi];
      if (g.end <= t) { last = played[gi]; continue; }
      let pk = last ? tw.dnp.p1 : tw.dnp.p0;
      const ov = tw.pNext?.[p]; if (ov != null && tw.nextGameIdx?.[p] === gi) pk = ov;
      const pl = r() < pk ? 1 : 0;
      const z = tw.resid ? tw.resid.q[Math.floor(r() * tw.resid.q.length)] : randn(r);
      played[gi] = pl; actual[gi] = pl ? Math.max(-5, g.mu + g.sd * z) : 0; last = pl;
    }
  }
  return { actual, played };
}

// ---------------- rollout policy ----------------
// Wraps a base deferral policy. At each lock decision whose base margin is within `margin`, evaluates
// each alternative by K Monte-Carlo continuations (common random numbers) and picks the best for the objective.
export function rolloutHooks(tw: TeamWeek, base: Policy, events: Ev[], obj: "points" | "win" | "softwin", K: number, margin: number,
  seed: number, realised: { actual: Float64Array; played: Uint8Array },
  opp?: { tw: TeamWeek; events: Ev[]; pol: Policy; realised: { actual: Float64Array; played: Uint8Array } }): Hooks {
  const r = rng(seed);
  return {
    decideLock: (st, p, t, evIdx, ev) => {
      const gap = ev.lockBest - ev.cont;
      if (!Number.isFinite(ev.lockBest) || Math.abs(gap) > margin) return undefined as any;
      const alts: (number | null)[] = [null];
      const lockable = unpinnedOpen(st); const seen = new Set<number>();
      const ok = (s: number) => legacy(base, "strand") || lockFeasible(tw, st, p, s); // never strand a held teammate
      for (const s of slotOrder(tw.slots)) {
        if (!((lockable >> s) & 1) || !(tw.slots[s] & tw.pmask[p]) || seen.has(tw.slots[s]) || !ok(s)) continue;
        seen.add(tw.slots[s]); alts.push(sameTypeHere(tw, st, p, s, lockable));
      }
      const here = st.lastSlot ? st.lastSlot[p] : -1;
      if (base.lockAware && here >= 0 && ((lockable >> here) & 1) && (tw.slots[here] & tw.pmask[p]) && !alts.includes(here) && ok(here)) alts.push(here);
      const scores = new Float64Array(alts.length);
      for (let k = 0; k < K; k++) {
        const scen = sampleScenario(tw, st, t, r, realised);
        let oppTotal = 0;
        if (obj !== "points" && opp) {
          const os = sampleScenario(opp.tw, null, t, r, opp.realised);
          // keep opponent's realised past: games ending before t are real (sampleScenario keeps them)
          oppTotal = simulate(opp.tw, opp.pol, opp.events, os.actual, os.played).total;
        }
        alts.forEach((s, ai) => {
          const s2 = cloneState(st);
          if (s === null) s2.pendingX[p] = NaN; else doLock(s2, p, s);
          // continue from the next event with the base policy (no hooks)
          const res = simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1);
          scores[ai] += obj === "points" ? res.total : obj === "softwin" ? normCdf((res.total - oppTotal) / 15) : (res.total > oppTotal ? 1 : res.total === oppTotal ? 0.5 : 0);
        });
      }
      let bi = 0; for (let ai = 1; ai < alts.length; ai++) if (scores[ai] > scores[bi] + 1e-9) bi = ai;
      // locking where he already sits wins near-ties (within 0.5 pts for points, 1% for win prob): no shuffling
      if (base.lockAware && alts[bi] !== null && here >= 0 && alts[bi] !== here) {
        const hi = alts.indexOf(here); const tol = obj === "points" ? 0.5 * K : 0.01 * K;
        if (hi >= 0 && scores[hi] >= scores[bi] - tol) bi = hi;
      }
      return alts[bi];
    },
  };
}

// Start/sit by simulation: at a tip-off, compare the rule's lineup with small changes to it (sit one of the two
// weakest starters; start one of the two best benched players in a free slot or in place of the weakest starter he
// can replace), each scored by K continuations of the rest of the week (common random numbers).
export function startRolloutHooks(tw: TeamWeek, base: Policy, events: Ev[], K: number, seed: number,
  realised: { actual: Float64Array; played: Uint8Array }, lockHooks?: Hooks): Hooks {
  const r = rng(seed ^ 0x5bd1e995);
  return {
    decideLock: lockHooks?.decideLock,
    decideStarts: (st, t, evIdx, tipping, pending, gameOf, slotOf, free) => {
      const proj = (p: number) => tw.games[gameOf.get(p)!].mu;
      const starters = tipping.filter((p) => slotOf.has(p)).sort((a, b) => proj(a) - proj(b));
      const benched = tipping.filter((p) => !slotOf.has(p) && !st.isLocked[p]).sort((a, b) => proj(b) - proj(a));
      const used = new Set(slotOf.values());
      const alts: Map<number, number>[] = [slotOf];
      // Sitting a starter is only an option if someone else could use his slot while his game runs (a later tip-off
      // tonight). Sitting a player into an idle slot can't be right: if he scores big you keep it, if not you let it go.
      for (const p of starters.slice(0, 2)) {
        const s = slotOf.get(p)!; const end = tw.games[gameOf.get(p)!].end;
        const needed = tw.games.some((q) => q.tip > t && q.tip < end && q.p !== p && !st.isLocked[q.p] && (tw.slots[s] & tw.pmask[q.p]));
        if (!needed) continue;
        const m = new Map(slotOf); m.delete(p); alts.push(m);
      }
      for (const p of benched.slice(0, 2)) {
        let s = -1; for (let i = 0; i < tw.slots.length; i++) if (((free >> i) & 1) && !used.has(i) && (tw.slots[i] & tw.pmask[p])) { s = i; break; }
        if (s >= 0) { const m = new Map(slotOf); m.set(p, s); alts.push(m); continue; }
        const victim = starters.find((q) => tw.slots[slotOf.get(q)!] & tw.pmask[p]);
        if (victim !== undefined) { const m = new Map(slotOf); const vs = m.get(victim)!; m.delete(victim); m.set(p, vs); alts.push(m); }
      }
      if (alts.length === 1) return undefined;
      const scores = new Float64Array(alts.length);
      for (let k = 0; k < K; k++) {
        const scen = sampleScenario(tw, st, t, r, realised);
        alts.forEach((m, ai) => { const s2 = cloneState(st); applyStarts(tw, s2, finalLineup(tw, base, st, m, tipping, pending, gameOf, free), tipping, pending, gameOf); scores[ai] += simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total; });
      }
      let bi = 0; for (let ai = 1; ai < alts.length; ai++) if (scores[ai] > scores[bi] + 0.5 * K) bi = ai; // change the rule's lineup only for a clear (>0.5 pt) gain
      return bi === 0 ? undefined : alts[bi];
    },
  };
}

// ---------------- hindsight ceiling ----------------
export function hindsight(tw: TeamWeek): number {
  const nP = tw.pmask.length; const w = new Float64Array(nP); const ps: number[] = [];
  for (let p = 0; p < nP; p++) { let m = -Infinity; for (const gi of tw.byPlayer[p]) m = Math.max(m, tw.games[gi].played ? tw.games[gi].actual : 0); if (m > 0) { w[p] = m; ps.push(p); } }
  return assignExact(tw.slots, (1 << tw.slots.length) - 1, ps, tw.pmask, w).total;
}
