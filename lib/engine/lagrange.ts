// Lagrangian upper bound on the optimal expected Lock-In week under the score model (ENGINE_V2 Phase 1.2).
// Weakly-coupled-MDP relaxation (Hawkins 2003; Adelman & Mersereau 2008). The coupling constraint "a slot holds at
// most one player at a time" is priced with deterministic multipliers mu[s][b] >= 0 = points charged for occupying
// slot s during time bucket b (buckets = elementary intervals between consecutive tip / end times, so every
// occupancy interval is a union of whole buckets and no time discretisation error arises). Each player then solves
// his own exact DP:
//   at each tip-off: start (pinned to one eligible slot for the game: cost min_s sum_{b in game} mu[s][b]) or bench;
//   after a started game with score x: let go (free), or hold until his next tip-off (cost sum_b min_s mu[s][b], he
//   may move between eligible slots) and lock just before it (cost min_s sum_{b >= tip} mu[s][b]); after his final
//   game: hold to week end (cost sum_b min_s mu[s][b]) and score x, or let go.
//   DNP chain: P(play) = p1 / p0 after played / missed (per-game override pPlay), observed for benched games too.
//   bound(mu) = sum_p V_p(mu) + sum_{s,b} mu[s][b]  >=  optimal expected weekly score, for every mu >= 0.
// The derivation (why every real behaviour is dominated by one of these per-player actions) is in research/REPORT.md.
import { emax, normCdf, type State, type TeamWeek } from "./core";

export type ScoreDist =
  | { kind: "normal"; mu: number; sd: number; floor: number } // X = max(floor, N(mu, sd^2)): the backtest's scenario model
  | { kind: "discrete"; x: number[]; w: number[] };          // P(X = x[i]) = w[i]

export interface LGame { p: number; tip: number; end: number; dist: ScoreDist; pPlay?: number | null }
// A player's situation when the relaxed week starts at t0 (default: free, before all of his games).
export type PlayerInit =
  | { kind: "free"; lp: number }
  | { kind: "held"; lp: number; x: number }   // holds score x from his last game; his next game (if any) is in games
  | { kind: "inGame"; lp: number; end: number; slot: number; dist: ScoreDist; pPlay?: number | null } // pinned to slot until end
  | { kind: "out" };                          // locked: nothing more counts for him
export interface LInstance {
  slots: number[]; pmask: number[]; games: LGame[]; lastPlayed0: number[];
  dnp: { p1: number; p0: number };
  T?: number;          // week end (default: last game end)
  t0?: number;         // start of the relaxed week (re-solving from a state); games must tip at or after it
  init?: PlayerInit[]; // per-player state at t0 (default free with lastPlayed0)
  constant?: number;   // points already locked (added to the bound)
}

// E[max(v, X)]
export function eMaxDist(d: ScoreDist, v: number): number {
  if (d.kind === "normal") return emax(d.mu, d.sd, Math.max(v, d.floor));
  let s = 0; for (let i = 0; i < d.x.length; i++) s += d.w[i] * Math.max(v, d.x[i]);
  return s;
}
// P(X > v)
export function pAbove(d: ScoreDist, v: number): number {
  if (d.kind === "normal") return v < d.floor ? 1 : 1 - normCdf((v - d.mu) / d.sd);
  let s = 0; for (let i = 0; i < d.x.length; i++) if (d.x[i] > v) s += d.w[i];
  return s;
}

// Model instance of a backtest team-week: exactly the distribution sampleScenario() draws from
// (Normal clamped at -5, or the empirical residual quantiles when tw.resid is set; DNP chain + pNext override).
export function gameDist(tw: TeamWeek, gi: number): ScoreDist {
  const g = tw.games[gi];
  return tw.resid
    ? { kind: "discrete", x: Array.from(tw.resid.q, (z) => Math.max(-5, g.mu + g.sd * z)), w: Array.from(tw.resid.q, () => 1 / tw.resid!.q.length) }
    : { kind: "normal", mu: g.mu, sd: g.sd, floor: -5 };
}
const pPlayOf = (tw: TeamWeek, gi: number) => { const p = tw.games[gi].p; const ov = tw.pNext?.[p]; return ov != null && tw.nextGameIdx?.[p] === gi ? ov : null; };
export function fromTeamWeek(tw: TeamWeek): LInstance {
  if (tw.avail) throw new Error("lagrange: roster windows (avail/gone) not supported");
  const games: LGame[] = tw.games.map((g, gi) => ({ p: g.p, tip: g.tip, end: g.end, dist: gameDist(tw, gi), pPlay: pPlayOf(tw, gi) }));
  return { slots: tw.slots, pmask: tw.pmask, games, lastPlayed0: tw.lastPlayed0, dnp: tw.dnp };
}

// The relaxed rest of the week from an engine state at time t (a tip-off; decisions at t not yet taken): locked slots
// drop out (their points are a constant), in-game players are pinned to their slot until their game ends, held scores
// and the DNP chain carry over, and only games tipping at or after t remain.
export interface StateInstance { inst: LInstance; slotOf: number[]; instSlot: Int32Array; instGame: Int32Array }
export function fromState(tw: TeamWeek, st: State, t: number): StateInstance {
  if (tw.avail) throw new Error("lagrange: roster windows (avail/gone) not supported");
  const slotOf: number[] = []; const instSlot = new Int32Array(tw.slots.length).fill(-1);
  let constant = 0;
  tw.slots.forEach((_, s) => { if (st.lockedBy[s] < 0) { instSlot[s] = slotOf.length; slotOf.push(s); } else constant += st.lockedPts[s]; });
  const instGame = new Int32Array(tw.games.length).fill(-1); const games: LGame[] = [];
  tw.games.forEach((g, gi) => { if (g.tip >= t && !st.isLocked[g.p]) { instGame[gi] = games.length; games.push({ p: g.p, tip: g.tip, end: g.end, dist: gameDist(tw, gi), pPlay: pPlayOf(tw, gi) }); } });
  const init: PlayerInit[] = tw.pmask.map((_, p) => {
    if (st.isLocked[p]) return { kind: "out" };
    const lp = st.lastPlayed[p] ? 1 : 0; const gi = st.inGame[p];
    if (gi >= 0 && tw.games[gi].end > t) {
      const s = st.pinned.indexOf(p);
      return { kind: "inGame", lp, end: tw.games[gi].end, slot: instSlot[s], dist: gameDist(tw, gi), pPlay: pPlayOf(tw, gi) };
    }
    if (!Number.isNaN(st.pendingX[p])) return { kind: "held", lp, x: st.pendingX[p] };
    return { kind: "free", lp };
  });
  const T = Math.max(...tw.games.map((g) => g.end), t);
  return { inst: { slots: slotOf.map((s) => tw.slots[s]), pmask: tw.pmask, games, lastPlayed0: tw.lastPlayed0, dnp: tw.dnp, T, t0: t, init, constant }, slotOf, instSlot, instGame };
}

export interface Prepared {
  inst: LInstance; nS: number; nP: number; B: number; times: number[];
  bucketOf: Map<number, number>;  // time -> index of the bucket starting there
  gl: number[][];                 // per player: game indices sorted by tip
  gA: Int32Array; gE: Int32Array; // per game: bucket index of tip / end
  masks: number[]; maskOf: Int32Array; eligOfMask: number[][];
}
export function prepare(inst: LInstance): Prepared {
  const nS = inst.slots.length, nP = inst.pmask.length;
  const ends = inst.games.map((g) => g.end);
  for (const it of inst.init ?? []) if (it.kind === "inGame") ends.push(it.end);
  const T = inst.T ?? Math.max(...ends, inst.t0 ?? 0, 0);
  const tset = new Set<number>([T]); if (inst.t0 !== undefined) tset.add(inst.t0);
  for (const g of inst.games) { tset.add(g.tip); tset.add(g.end); }
  for (const it of inst.init ?? []) if (it.kind === "inGame") tset.add(it.end);
  const times = [...tset].sort((a, b) => a - b);
  const bucketOf = new Map(times.map((t, i) => [t, i]));
  const B = times.length - 1;
  const gl: number[][] = Array.from({ length: nP }, () => []);
  inst.games.forEach((g, i) => gl[g.p].push(i));
  for (const l of gl) {
    l.sort((a, b) => inst.games[a].tip - inst.games[b].tip);
    for (let k = 1; k < l.length; k++) if (inst.games[l[k]].tip < inst.games[l[k - 1]].end) throw new Error("lagrange: a player's games overlap");
  }
  for (const g of inst.games) if (!(g.end > g.tip) || g.end > T || (inst.t0 !== undefined && g.tip < inst.t0)) throw new Error("lagrange: bad game interval");
  const gA = Int32Array.from(inst.games, (g) => bucketOf.get(g.tip)!), gE = Int32Array.from(inst.games, (g) => bucketOf.get(g.end)!);
  const masks: number[] = []; const maskOf = new Int32Array(nP);
  for (let p = 0; p < nP; p++) { let m = masks.indexOf(inst.pmask[p]); if (m < 0) { m = masks.length; masks.push(inst.pmask[p]); } maskOf[p] = m; }
  const eligOfMask = masks.map((m) => inst.slots.map((_, s) => s).filter((s) => inst.slots[s] & m));
  return { inst, nS, nP, B, times, bucketOf, gl, gA, gE, masks, maskOf, eligOfMask };
}

// Everything the priced single-player DPs need, for one price vector mu.
export interface Tables {
  P: Prepared; mu: Float64Array; W: number;
  Ps: Float64Array;   // Ps[s*W + b] = sum_{b' < b} mu[s][b']
  Pm: Float64Array;   // same for the pointwise minimum over each eligibility mask
  argm: Int32Array;   // argmin slot per mask and bucket
  // per player (index k = position in P.gl[p]):
  C: Float64Array[];     // C[p][k*2+lp] = value just before tip-off k with nothing held (k = n: 0)
  start: Uint8Array[];   // start game k given lp?
  gSlot: Int32Array[]; lSlot: Int32Array[]; kap: Float64Array[]; thr: Float64Array[];
  intervalMin: (m: number, a: number, e: number) => [number, number];
}
export function tables(P: Prepared, mu: Float64Array): Tables {
  const { inst, nS, nP, B, gl, gA, gE, masks, maskOf, eligOfMask } = P;
  const W = B + 1;
  // prefix sums per slot, and of the pointwise minimum over each eligibility mask (with its argmin slot)
  const Ps = new Float64Array(nS * W);
  for (let s = 0; s < nS; s++) for (let b = 0; b < B; b++) Ps[s * W + b + 1] = Ps[s * W + b] + mu[s * B + b];
  const nM = masks.length;
  const Pm = new Float64Array(nM * W); const argm = new Int32Array(nM * B);
  for (let m = 0; m < nM; m++) {
    const el = eligOfMask[m];
    for (let b = 0; b < B; b++) {
      let best = Infinity, bs = -1;
      for (const s of el) if (mu[s * B + b] < best) { best = mu[s * B + b]; bs = s; }
      if (bs < 0) best = Infinity; // no eligible slot at all
      Pm[m * W + b + 1] = Pm[m * W + b] + best; argm[m * B + b] = bs;
    }
  }
  const intervalMin = (m: number, a: number, e: number): [number, number] => { // min over eligible slots of sum_{a<=b<e} mu
    let best = Infinity, bs = -1;
    for (const s of eligOfMask[m]) { const c = Ps[s * W + e] - Ps[s * W + a]; if (c < best) { best = c; bs = s; } }
    return [best, bs];
  };
  const { p1, p0 } = inst.dnp;
  const C: Float64Array[] = [], start: Uint8Array[] = [], gSlot: Int32Array[] = [], lSlot: Int32Array[] = [], kap: Float64Array[] = [], thr: Float64Array[] = [];
  for (let p = 0; p < nP; p++) {
    const l = gl[p]; const n = l.length; const m = maskOf[p];
    const Cp = new Float64Array((n + 1) * 2), st = new Uint8Array(n * 2), gs = new Int32Array(n), ls = new Int32Array(n).fill(-1);
    const kp = new Float64Array(n), th = new Float64Array(n);
    C.push(Cp); start.push(st); gSlot.push(gs); lSlot.push(ls); kap.push(kp); thr.push(th);
    if (!n || !eligOfMask[m].length) continue;
    // backward DP: C[k*2+lp] = value just before tip-off k with nothing held, lp = played last game
    for (let k = n - 1; k >= 0; k--) {
      const g = inst.games[l[k]];
      const [G, gsl] = intervalMin(m, gA[l[k]], gE[l[k]]); gs[k] = gsl;
      let kappa: number;
      if (k < n - 1) {
        const nx = l[k + 1];
        const H = Pm[m * W + gA[nx]] - Pm[m * W + gE[l[k]]];
        const [L, lsl] = intervalMin(m, gA[nx], B); ls[k] = lsl;
        kappa = H + L;
      } else kappa = Pm[m * W + B] - Pm[m * W + gE[l[k]]];
      kp[k] = kappa;
      const c1 = Cp[(k + 1) * 2 + 1], c0 = Cp[(k + 1) * 2];
      th[k] = c1 + kappa; // after playing: keep (lock / hold to week end) iff x > thr
      const afterPlay = eMaxDist(g.dist, th[k]) - kappa; // E[max(c1, X - kappa)]
      for (let lp = 0; lp < 2; lp++) {
        const q = g.pPlay ?? (lp ? p1 : p0);
        const bench = q * c1 + (1 - q) * c0;
        const v = -G + q * afterPlay + (1 - q) * c0; // DNP: held 0, letting go is optimal (c0 >= 0 >= -kappa)
        if (v > bench) { Cp[k * 2 + lp] = v; st[k * 2 + lp] = 1; } else Cp[k * 2 + lp] = bench;
      }
    }
  }
  return { P, mu, W, Ps, Pm, argm, C, start, gSlot, lSlot, kap, thr, intervalMin };
}

export interface Evaluation {
  bound: number;       // sum_p V_p + sum mu (+ constant)
  V: Float64Array;     // per-player relaxed values (net of occupancy charges)
  reward: number;      // expected points counted by the relaxed policies (= sum V + charges paid)
  occ: Float64Array;   // expected occupancy of slot s in bucket b (layout s*B+b) under the relaxed policies
}

// Bound and a subgradient (1 - occ) at mu. mu layout: mu[s*B + b] (points for the whole bucket).
export function evaluate(P: Prepared, mu: Float64Array): Evaluation {
  const { inst, nS, nP, B, gl, gA, gE, masks, maskOf, eligOfMask } = P;
  const Tb = tables(P, mu); const { W, Ps, Pm, argm, intervalMin } = Tb;
  const nM = masks.length;
  const slotDiff = new Float64Array(nS * W); const maskDiff = new Float64Array(nM * W);
  const V = new Float64Array(nP);
  const { p1, p0 } = inst.dnp;
  const addSlot = (s: number, a: number, e: number, w: number) => { slotDiff[s * W + a] += w; slotDiff[s * W + e] -= w; };
  const addMask = (m: number, a: number, e: number, w: number) => { maskDiff[m * W + a] += w; maskDiff[m * W + e] -= w; };
  for (let p = 0; p < nP; p++) {
    const init: PlayerInit = inst.init?.[p] ?? { kind: "free", lp: inst.lastPlayed0[p] ? 1 : 0 };
    if (init.kind === "out") continue;
    const l = gl[p]; const n = l.length; const m = maskOf[p]; if (!eligOfMask[m].length) continue;
    const C = Tb.C[p], start = Tb.start[p], gSlot = Tb.gSlot[p], lSlot = Tb.lSlot[p], thr = Tb.thr[p];
    // keep a score from time-bucket a: hold to his next tip-off and lock (or hold to week end); returns charge
    const keepCharge = (a: number): [number, number] => {
      if (!n) return [Pm[m * W + B] - Pm[m * W + a], -1];
      const [L, ls] = intervalMin(m, gA[l[0]], B);
      return [Pm[m * W + gA[l[0]]] - Pm[m * W + a] + L, ls];
    };
    const addKeep = (a: number, ls: number, w: number) => {
      if (!n) { addMask(m, a, B, w); return; }
      addMask(m, a, gA[l[0]], w); addSlot(ls, gA[l[0]], B, w);
    };
    let r0 = 0, r1 = 0; // mass free before his first future game, by lp
    if (init.kind === "free") { V[p] = C[init.lp ? 1 : 0]; if (init.lp) r1 = 1; else r0 = 1; }
    else if (init.kind === "held") {
      const [kc, ls] = keepCharge(0); const keep = init.x - kc; const go = C[init.lp ? 1 : 0];
      if (keep > go) { V[p] = keep; addKeep(0, ls, 1); } else { V[p] = go; if (init.lp) r1 = 1; else r0 = 1; }
    } else {
      // in a game, pinned to init.slot until init.end; then keep the score or let it go
      const e = P.bucketOf.get(init.end)!;
      const charge = Ps[init.slot * W + e] - Ps[init.slot * W];
      const [kc, ls] = keepCharge(e);
      const c1 = n ? C[1] : 0, c0 = n ? C[0] : 0; const th = c1 + kc;
      const q = init.pPlay ?? (init.lp ? p1 : p0);
      V[p] = -charge + q * (eMaxDist(init.dist, th) - kc) + (1 - q) * c0;
      addSlot(init.slot, 0, e, 1);
      const keep = q * pAbove(init.dist, th);
      if (keep > 0) addKeep(e, ls, keep);
      r1 = q - keep; r0 = 1 - q;
    }
    // forward pass over his future games: expected occupancy of the optimal relaxed policy
    for (let k = 0; k < n; k++) {
      const gi = l[k]; const g = inst.games[gi];
      let n0 = 0, n1 = 0;
      for (let lp = 0; lp < 2; lp++) {
        const mass = lp ? r1 : r0; if (mass <= 0) continue;
        const q = g.pPlay ?? (lp ? p1 : p0);
        if (!start[k * 2 + lp]) { n1 += mass * q; n0 += mass * (1 - q); continue; }
        addSlot(gSlot[k], gA[gi], gE[gi], mass);
        const keep = mass * q * pAbove(g.dist, thr[k]);
        if (keep > 0) {
          if (k < n - 1) { const nx = l[k + 1]; addMask(m, gE[gi], gA[nx], keep); addSlot(lSlot[k], gA[nx], B, keep); }
          else addMask(m, gE[gi], B, keep);
        }
        n1 += mass * q - keep; n0 += mass * (1 - q);
      }
      r0 = n0; r1 = n1;
    }
  }
  const occ = new Float64Array(nS * B);
  for (let s = 0; s < nS; s++) { let a = 0; for (let b = 0; b < B; b++) { a += slotDiff[s * W + b]; occ[s * B + b] = a; } }
  for (let m = 0; m < nM; m++) { let a = 0; for (let b = 0; b < B; b++) { a += maskDiff[m * W + b]; if (a > 1e-15) occ[argm[m * B + b] * B + b] += a; } }
  let sumMu = 0, paid = 0;
  for (let i = 0; i < mu.length; i++) { sumMu += mu[i]; paid += mu[i] * occ[i]; }
  let sumV = 0; for (let p = 0; p < nP; p++) sumV += V[p];
  const c = inst.constant ?? 0;
  return { bound: sumV + sumMu + c, V, reward: sumV + paid + c, occ };
}

export interface BoundResult {
  bound: number;        // best (lowest) bound found: valid for its mu regardless of convergence
  mu: Float64Array; iters: number; free: number; // free = bound at mu = 0 (no slot limit at all)
  P: Prepared; at: Evaluation;
}
export type Method = "polyak" | "adam" | "sqrt";
// Minimise the (convex, piecewise-smooth) bound over mu >= 0 by projected subgradient steps.
//  polyak: Polyak steps towards a moving target level (Goffin-Kiwiel variable target value), level gap halves on stalls
//  adam:   per-coordinate adaptive steps (Adam) with a decaying rate
//  sqrt:   normalised steps a / sqrt(k)
// Every evaluated mu yields a valid bound; the best one is returned.
export function minimizeBound(inst: LInstance, opts: { iters?: number; mu0?: Float64Array; patience?: number; method?: Method; lr?: number } = {}): BoundResult {
  const P = prepare(inst);
  const n = P.nS * P.B; const iters = opts.iters ?? 4000; const patience = opts.patience ?? 30; const method = opts.method ?? "adam";
  let mu = opts.mu0 ? opts.mu0.slice() : new Float64Array(n);
  const ev0 = evaluate(P, new Float64Array(n));
  let ev = opts.mu0 ? evaluate(P, mu) : ev0;
  let best = ev.bound, bestMu = mu.slice(), bestEv = ev;
  let delta = Math.max(1, 0.1 * best), stall = 0, it = 0;
  const g = new Float64Array(n), m1 = new Float64Array(n), m2 = new Float64Array(n);
  const lr0 = opts.lr ?? (method === "adam" ? 0.3 : method === "sqrt" ? 10 : 1);
  for (; it < iters; it++) {
    let gn = 0;
    for (let i = 0; i < n; i++) { let gi = 1 - ev.occ[i]; if (mu[i] <= 0 && gi > 0) gi = 0; g[i] = gi; gn += gi * gi; }
    if (gn < 1e-18) break; // zero projected subgradient: optimal
    if (method === "polyak") {
      const step = (ev.bound - best + delta) / gn;
      for (let i = 0; i < n; i++) { const v = mu[i] - step * g[i]; mu[i] = v > 0 ? v : 0; }
    } else if (method === "adam") {
      const lr = lr0 / Math.sqrt(1 + it / 100), b1 = 0.9, b2 = 0.999;
      for (let i = 0; i < n; i++) {
        m1[i] = b1 * m1[i] + (1 - b1) * g[i]; m2[i] = b2 * m2[i] + (1 - b2) * g[i] * g[i];
        const v = mu[i] - lr * (m1[i] / (1 - b1 ** (it + 1))) / (Math.sqrt(m2[i] / (1 - b2 ** (it + 1))) + 1e-8); mu[i] = v > 0 ? v : 0;
      }
    } else {
      const step = lr0 / Math.sqrt(it + 1) / Math.sqrt(gn);
      for (let i = 0; i < n; i++) { const v = mu[i] - step * g[i]; mu[i] = v > 0 ? v : 0; }
    }
    ev = evaluate(P, mu);
    if (ev.bound < best - 1e-9) { if (ev.bound < best - 0.1 * delta) stall = 0; else stall++; best = ev.bound; bestMu = mu.slice(); bestEv = ev; }
    else stall++;
    if (method === "polyak" && stall >= patience) { delta *= 0.5; stall = 0; mu = bestMu.slice(); ev = bestEv; if (delta < 1e-7 * Math.max(1, best)) { delta = Math.max(1, 0.1 * best) * 0.01; } }
  }
  return { bound: best, mu: bestMu, iters: it, free: ev0.bound, P, at: bestEv };
}
// The schedule used for the season gap study: Adam (rate 0.3) then a refinement from the best point (rate 0.03).
// On real team-weeks (B ~ 35-60 buckets) 2 x 200k iterations land within ~0.01 pts of 1M-iteration runs.
export function tightBound(inst: LInstance, iters = 200000): BoundResult {
  const a = minimizeBound(inst, { method: "adam", lr: 0.3, iters });
  const b = minimizeBound(inst, { method: "adam", lr: 0.03, iters, mu0: a.mu });
  return b.bound <= a.bound ? { ...b, free: a.free, iters: a.iters + b.iters } : a;
}

// Expected perfect-hindsight score of one realised scenario: every player counts at most his best game, locked into
// a distinct eligible slot (always achievable with hindsight: start him only for that game, lock it).
export function hindsightValue(slots: number[], pmask: number[], byPlayer: number[][], actual: ArrayLike<number>, played: ArrayLike<number>,
  assign: (slots: number[], open: number, players: number[], pm: number[], w: Float64Array) => { total: number }): number {
  const w = new Float64Array(pmask.length); const ps: number[] = [];
  for (let p = 0; p < pmask.length; p++) { let m = 0; for (const gi of byPlayer[p]) if (played[gi]) m = Math.max(m, actual[gi]); if (m > 0) { w[p] = m; ps.push(p); } }
  return assign(slots, (1 << slots.length) - 1, ps, pmask, w).total;
}
