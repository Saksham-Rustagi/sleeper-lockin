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
import { emax, normCdf, type TeamWeek } from "./core";

export type ScoreDist =
  | { kind: "normal"; mu: number; sd: number; floor: number } // X = max(floor, N(mu, sd^2)): the backtest's scenario model
  | { kind: "discrete"; x: number[]; w: number[] };          // P(X = x[i]) = w[i]

export interface LGame { p: number; tip: number; end: number; dist: ScoreDist; pPlay?: number | null }
export interface LInstance {
  slots: number[]; pmask: number[]; games: LGame[]; lastPlayed0: number[];
  dnp: { p1: number; p0: number };
  T?: number; // week end (default: last game end)
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
export function fromTeamWeek(tw: TeamWeek): LInstance {
  if (tw.avail) throw new Error("lagrange: roster windows (avail/gone) not supported");
  const games: LGame[] = tw.games.map((g, gi) => {
    const dist: ScoreDist = tw.resid
      ? { kind: "discrete", x: Array.from(tw.resid.q, (z) => Math.max(-5, g.mu + g.sd * z)), w: Array.from(tw.resid.q, () => 1 / tw.resid!.q.length) }
      : { kind: "normal", mu: g.mu, sd: g.sd, floor: -5 };
    const ov = tw.pNext?.[g.p]; const pPlay = ov != null && tw.nextGameIdx?.[g.p] === gi ? ov : null;
    return { p: g.p, tip: g.tip, end: g.end, dist, pPlay };
  });
  return { slots: tw.slots, pmask: tw.pmask, games, lastPlayed0: tw.lastPlayed0, dnp: tw.dnp };
}

export interface Prepared {
  inst: LInstance; nS: number; nP: number; B: number; times: number[];
  gl: number[][];                 // per player: game indices sorted by tip
  gA: Int32Array; gE: Int32Array; // per game: bucket index of tip / end
  masks: number[]; maskOf: Int32Array; eligOfMask: number[][];
}
export function prepare(inst: LInstance): Prepared {
  const nS = inst.slots.length, nP = inst.pmask.length;
  const T = inst.T ?? Math.max(...inst.games.map((g) => g.end), 0);
  const tset = new Set<number>([T]);
  for (const g of inst.games) { tset.add(g.tip); tset.add(g.end); }
  const times = [...tset].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const B = times.length - 1;
  const gl: number[][] = Array.from({ length: nP }, () => []);
  inst.games.forEach((g, i) => gl[g.p].push(i));
  for (const l of gl) {
    l.sort((a, b) => inst.games[a].tip - inst.games[b].tip);
    for (let k = 1; k < l.length; k++) if (inst.games[l[k]].tip < inst.games[l[k - 1]].end) throw new Error("lagrange: a player's games overlap");
  }
  for (const g of inst.games) if (!(g.end > g.tip) || g.end > T) throw new Error("lagrange: bad game interval");
  const gA = Int32Array.from(inst.games, (g) => idx.get(g.tip)!), gE = Int32Array.from(inst.games, (g) => idx.get(g.end)!);
  const masks: number[] = []; const maskOf = new Int32Array(nP);
  for (let p = 0; p < nP; p++) { let m = masks.indexOf(inst.pmask[p]); if (m < 0) { m = masks.length; masks.push(inst.pmask[p]); } maskOf[p] = m; }
  const eligOfMask = masks.map((m) => inst.slots.map((_, s) => s).filter((s) => inst.slots[s] & m));
  return { inst, nS, nP, B, times, gl, gA, gE, masks, maskOf, eligOfMask };
}

export interface Evaluation {
  bound: number;       // sum_p V_p + sum mu
  V: Float64Array;     // per-player relaxed values (net of occupancy charges)
  reward: number;      // expected points counted by the relaxed policies (= sum V + charges paid)
  occ: Float64Array;   // expected occupancy of slot s in bucket b (layout s*B+b) under the relaxed policies
}

// Bound and a subgradient (1 - occ) at mu. mu layout: mu[s*B + b] (points for the whole bucket).
export function evaluate(P: Prepared, mu: Float64Array): Evaluation {
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
  const slotDiff = new Float64Array(nS * W); const maskDiff = new Float64Array(nM * W);
  const V = new Float64Array(nP);
  const { p1, p0 } = inst.dnp;
  for (let p = 0; p < nP; p++) {
    const l = gl[p]; const n = l.length; if (!n) continue;
    const m = maskOf[p]; if (!eligOfMask[m].length) continue;
    // backward DP: C[k*2+lp] = value just before tip-off k with nothing held, lp = played last game
    const C = new Float64Array((n + 1) * 2);
    const start = new Uint8Array(n * 2), gSlot = new Int32Array(n), lSlot = new Int32Array(n);
    const kap = new Float64Array(n), thr = new Float64Array(n);
    for (let k = n - 1; k >= 0; k--) {
      const g = inst.games[l[k]];
      const [G, gs] = intervalMin(m, gA[l[k]], gE[l[k]]); gSlot[k] = gs;
      let kappa: number;
      if (k < n - 1) {
        const nx = l[k + 1];
        const H = Pm[m * W + gA[nx]] - Pm[m * W + gE[l[k]]];
        const [L, ls] = intervalMin(m, gA[nx], B); lSlot[k] = ls;
        kappa = H + L;
      } else kappa = Pm[m * W + B] - Pm[m * W + gE[l[k]]];
      kap[k] = kappa;
      const c1 = C[(k + 1) * 2 + 1], c0 = C[(k + 1) * 2];
      thr[k] = c1 + kappa; // after playing: keep (lock / hold to week end) iff x > thr
      const afterPlay = eMaxDist(g.dist, thr[k]) - kappa; // E[max(c1, X - kappa)]
      for (let lp = 0; lp < 2; lp++) {
        const q = g.pPlay ?? (lp ? p1 : p0);
        const bench = q * c1 + (1 - q) * c0;
        const st = -G + q * afterPlay + (1 - q) * c0; // DNP: held 0, letting go is optimal (c0 >= 0 >= -kappa)
        if (st > bench) { C[k * 2 + lp] = st; start[k * 2 + lp] = 1; } else C[k * 2 + lp] = bench;
      }
    }
    V[p] = C[inst.lastPlayed0[p] ? 1 : 0];
    // forward pass: expected occupancy of the optimal relaxed policy
    let r0 = inst.lastPlayed0[p] ? 0 : 1, r1 = inst.lastPlayed0[p] ? 1 : 0; // mass reaching tip-off k free, by lp
    for (let k = 0; k < n; k++) {
      const gi = l[k]; const g = inst.games[gi];
      let n0 = 0, n1 = 0;
      for (let lp = 0; lp < 2; lp++) {
        const mass = lp ? r1 : r0; if (mass <= 0) continue;
        const q = g.pPlay ?? (lp ? p1 : p0);
        if (!start[k * 2 + lp]) { n1 += mass * q; n0 += mass * (1 - q); continue; }
        slotDiff[gSlot[k] * W + gA[gi]] += mass; slotDiff[gSlot[k] * W + gE[gi]] -= mass;
        const keep = mass * q * pAbove(g.dist, thr[k]);
        if (keep > 0) {
          if (k < n - 1) {
            const nx = l[k + 1];
            maskDiff[m * W + gE[gi]] += keep; maskDiff[m * W + gA[nx]] -= keep;
            slotDiff[lSlot[k] * W + gA[nx]] += keep; slotDiff[lSlot[k] * W + B] -= keep;
          } else { maskDiff[m * W + gE[gi]] += keep; maskDiff[m * W + B] -= keep; }
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
  return { bound: sumV + sumMu, V, reward: sumV + paid, occ };
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
