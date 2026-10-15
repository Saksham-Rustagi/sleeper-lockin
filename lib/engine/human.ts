// Human-like opponent model (ENGINE_V2 Phase 5: playing for the win).
// Our opponent is a human, not our engine. This is a deliberately simple "physical lineup" model of how the managers
// of the 2025-26 league actually played (fitted in research/humanfit.ts; REPORT "Engine v2 - Phase 5"):
//  - The lineup is a set of slot occupants that persists until the manager changes it. Whoever sits in a starting
//    slot when his game tips off is started (rule 1); after the game he holds that score (rules 3-5); benching him
//    forfeits it; at week end every unlocked occupant's held score counts (rule 6).
//  - Engagement: each team-week draws e ~ Beta(engA, engB); on every game day the manager is active with probability
//    e, and an active day is managed at every tip-off (same-day slot reuse) with probability pt, else once. Inactive days change nothing (injured or idle players stay in the lineup, held scores get replaced by the
//    next game of a player left in his slot).
//  - A managed moment (before the day's first tip-off, or before every tip-off): (1) every held, unlocked starter with games left is locked with
//    probability sigmoid(c0 + u + c1 * z + c2 * d), z = (score - value of waiting: his remaining games' optimal-stopping
//    value) / sd of his next game, d = share of the week's game days already past, u ~ N(0, su^2) per team-week;
//    (2) the open slots are filled by exact assignment: today's players weighted by the value of starting tonight
//    rather than skipping, held scores without a game today by (1 - tf) * the value of keeping rather than letting go;
//    held scores left without a slot are benched (forfeited). A DNP is known in advance (not started) w.p. kd.
//  - Week start: with probability sl a standing lineup (best assignment by weekly mean projection), else empty slots.
// Used to (i) simulate the opponent's rest of the week from what we can see of him (his locks, held scores, lineup,
// finished games) and so get the distribution of his final total, and (ii) play the opponent in simulated weeks.
import * as E from "./core";

export interface HumanParams {
  engA: number; engB: number;   // engagement e ~ Beta(engA, engB) per team-week = P(active) on each game day
  c0: number; c1: number; c2: number; // lock logit c0 + u + c1 * z + c2 * d
  su: number;                   // sd of the per-team-week lock-threshold offset u ~ N(0, su^2) (some weeks he holds out, others he locks early)
  tf: number;                   // 0..1: how much held scores (no game today) give way to today's players (1: they only keep spare slots)
  pt: number;                   // P(an active day is managed tip-off by tip-off, with same-day slot reuse) vs once before the day's first tip
  kd: number;                   // P(a player's DNP is known before the lineup decision: injury news, inactive lists)
  sl: number;                   // P(the week starts with a standing lineup); otherwise the slots start empty
}
// fitted on the 2025-26 human team-weeks (research/humanfit.ts); see REPORT "Engine v2 - Phase 5"
export const HUMAN: HumanParams = { engA: 1.612, engB: 0.339, c0: -3.096, c1: 5.070, c2: 2.170, su: 0.502, tf: 0.880, pt: 0.993, kd: 0.004, sl: 0.088 };

export interface HState {
  occ: Int32Array;      // slot -> occupant (-1 empty)
  locked: Uint8Array;   // slot locked
  pts: Float64Array;    // slot -> locked points
  lockGame: Int32Array; // slot -> game whose score was locked (-1 unknown)
  held: Float64Array;   // player -> held score (NaN: none); only occupants hold
  heldGame: Int32Array; // player -> game of the held score
  inGame: Int32Array;   // player -> game in progress, started in his slot (-1 none)
  isLocked: Uint8Array; // player
  lastPlayed: Uint8Array;
  e: number;            // engagement (P(active) per game day)
  u: number;            // lock-threshold offset of this team-week
  mode: number;         // today: 0 inactive, 1 managed once before the first tip-off, 2 managed at every tip-off
}
// kind: 0 = game end, 1 = decision moment (just before a tip-off time; g = index into moments), 2 = tip-off
export interface HEv { t: number; kind: 0 | 1 | 2; g: number }
export interface Moment { t: number; d: number; first: boolean; games: number[] }
export interface HWeek { ev: HEv[]; dayOf: Int32Array; dayGames: number[][]; nDays: number; moments: Moment[] }
const HW = new WeakMap<E.TeamWeek, HWeek>();
export function humanWeek(tw: E.TeamWeek): HWeek {
  let h = HW.get(tw); if (h) return h;
  const keys = [...new Set(tw.games.map((g) => E.dayEnd(g.tip)))].sort((a, b) => a - b);
  const dayOf = Int32Array.from(tw.games, (g) => keys.indexOf(E.dayEnd(g.tip)));
  const dayGames: number[][] = keys.map(() => []); tw.games.forEach((_, gi) => dayGames[dayOf[gi]].push(gi));
  const tips = [...new Set(tw.games.map((g) => g.tip))].sort((a, b) => a - b);
  const moments: Moment[] = tips.map((T) => { const games = tw.games.map((_, gi) => gi).filter((gi) => tw.games[gi].tip === T); const d = dayOf[games[0]]; return { t: T - 1, d, first: false, games }; });
  moments.forEach((m, i) => { m.first = i === 0 || moments[i - 1].d !== m.d; });
  const ev: HEv[] = [];
  tw.games.forEach((g, gi) => { ev.push({ t: g.end, kind: 0, g: gi }); ev.push({ t: g.tip, kind: 2, g: gi }); });
  moments.forEach((m, i) => ev.push({ t: m.t, kind: 1, g: i }));
  ev.sort((a, b) => a.t - b.t || a.kind - b.kind || a.g - b.g);
  h = { ev, dayOf, dayGames, nDays: keys.length, moments }; HW.set(tw, h);
  return h;
}

function betaSample(a: number, b: number, r: () => number) { const x = gammaSample(a, r), y = gammaSample(b, r); return x / (x + y); }
function gammaSample(k: number, r: () => number): number { // Marsaglia-Tsang (k < 1 boosted)
  if (k < 1) return gammaSample(k + 1, r) * Math.pow(r() || 1e-12, 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { let u = 0; while (u === 0) u = r(); x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
// the manager's traits for one team-week (engagement, lock-threshold offset); redrawn from the prior in every simulation
export function drawTraits(hs: HState, par: HumanParams, r: () => number) {
  hs.e = betaSample(par.engA, par.engB, r);
  let u = 0; while (u === 0) u = r(); hs.u = par.su * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// the standing lineup: best assignment of the open slots by mean projection of each player's games from time t on
export function standingLineup(tw: E.TeamWeek, hs: HState, t: number) {
  const nP = tw.pmask.length; const w = new Float64Array(nP); const ps: number[] = [];
  const taken = new Set<number>(); let open = 0;
  for (let s = 0; s < tw.slots.length; s++) { if (hs.locked[s] || hs.occ[s] >= 0) { if (hs.occ[s] >= 0) taken.add(hs.occ[s]); } else open |= 1 << s; }
  for (let p = 0; p < nP; p++) {
    if (hs.isLocked[p] || taken.has(p)) continue;
    let m = 0, n = 0; for (const gi of tw.byPlayer[p]) if (tw.games[gi].tip >= t) { m += tw.games[gi].mu; n++; }
    if (n) { w[p] = 1 + Math.max(0, m / n); ps.push(p); }
  }
  const a = E.assignExact(tw.slots, open, ps, tw.pmask, w);
  for (const [p, s] of a.slotOf) hs.occ[s] = p;
}
export function initHuman(tw: E.TeamWeek, par: HumanParams, r: () => number): HState {
  const nS = tw.slots.length, nP = tw.pmask.length;
  const hs: HState = {
    occ: new Int32Array(nS).fill(-1), locked: new Uint8Array(nS), pts: new Float64Array(nS), lockGame: new Int32Array(nS).fill(-1),
    held: new Float64Array(nP).fill(NaN), heldGame: new Int32Array(nP).fill(-1), inGame: new Int32Array(nP).fill(-1),
    isLocked: new Uint8Array(nP), lastPlayed: Uint8Array.from(tw.lastPlayed0), e: 1, u: 0, mode: 0,
  };
  drawTraits(hs, par, r);
  if (r() < par.sl) standingLineup(tw, hs, -Infinity);
  return hs;
}
export function cloneH(h: HState): HState {
  return { occ: h.occ.slice(), locked: h.locked.slice(), pts: h.pts.slice(), lockGame: h.lockGame.slice(), held: h.held.slice(), heldGame: h.heldGame.slice(),
    inGame: h.inGame.slice(), isLocked: h.isLocked.slice(), lastPlayed: h.lastPlayed.slice(), e: h.e, u: h.u, mode: h.mode };
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// a decision moment: locks, then the lineup for the players of `games` (today's, or those tipping now) + held scores
function decide(tw: E.TeamWeek, hw: HWeek, par: HumanParams, hs: HState, d: number, t: number, games: number[], played: ArrayLike<number>, r: () => number, locks: boolean) {
  const nS = tw.slots.length;
  // (1) locks of held starters with games left: against the value of waiting (his remaining games' optimal-stopping value)
  const past = hw.nDays > 1 ? d / (hw.nDays - 1) : 1;
  if (locks) for (let s = 0; s < nS; s++) {
    const p = hs.occ[s]; if (p < 0 || hs.locked[s] || Number.isNaN(hs.held[p]) || hs.inGame[p] >= 0) continue;
    const k = E.nextIdx(tw, p, t); if (k >= tw.byPlayer[p].length) continue; // his final game: counts at week end anyway
    const v = E.stopValue(tw, p, k, hs.lastPlayed[p]); const sd = tw.games[tw.byPlayer[p][k]].sd;
    const z = (hs.held[p] - v) / Math.max(1, sd);
    if (r() < sigmoid(par.c0 + hs.u + par.c1 * z + par.c2 * past)) {
      hs.locked[s] = 1; hs.pts[s] = hs.held[p]; hs.lockGame[s] = hs.heldGame[p]; hs.isLocked[p] = 1; hs.held[p] = NaN;
    }
  }
  // (2) lineup for today (exact assignment): today's players weighted by the value of starting tonight's game rather
  //     than skipping it, held scores (no game today) by the value of keeping them rather than letting them go
  const nP = tw.pmask.length; const w = new Float64Array(nP); const cands: number[] = []; const today = new Map<number, number>();
  for (const gi of games) { const p = tw.games[gi].p; if (tw.games[gi].tip < t || today.has(p)) continue; if (!played[gi] && r() < par.kd) continue; today.set(p, gi); } // (a known DNP is not started)
  let open = 0; const pinned = new Set<number>();
  for (let s = 0; s < nS; s++) { if (hs.locked[s]) continue; const p = hs.occ[s]; if (p >= 0 && hs.inGame[p] >= 0) { pinned.add(p); continue; } open |= 1 << s; }
  for (const [p, gi] of today) if (!hs.isLocked[p] && !pinned.has(p)) {
    const k = tw.byPlayer[p].indexOf(gi); const lp = hs.lastPlayed[p];
    w[p] = 1e-3 + Math.max(0, E.stopValue(tw, p, k, lp) - E.skipValue(tw, p, k, lp)); cands.push(p);
  }
  const heldOcc: number[] = [];
  for (let s = 0; s < nS; s++) {
    const p = hs.occ[s]; if (p < 0 || hs.locked[s] || pinned.has(p) || today.has(p) || Number.isNaN(hs.held[p])) continue;
    heldOcc.push(p); w[p] = 1e-4 + (1 - par.tf) * Math.max(0, hs.held[p] - E.stopValue(tw, p, E.nextIdx(tw, p, t), hs.lastPlayed[p])); cands.push(p);
  }
  const a = E.assignExact(tw.slots, open, cands, tw.pmask, w);
  for (let s = 0; s < nS; s++) if ((open >> s) & 1) hs.occ[s] = -1;
  for (const [p, s] of a.slotOf) hs.occ[s] = p;
  for (const p of heldOcc) if (!a.slotOf.has(p)) hs.held[p] = NaN; // benched: forfeited
}

// Play the human's week from event index fromEv (events of humanWeek) on the given outcomes; returns his final total.
export function simulateHuman(tw: E.TeamWeek, par: HumanParams, hs: HState, actual: ArrayLike<number>, played: ArrayLike<number>, r: () => number,
  fromEv = 0, toTime = Infinity, toEv = Infinity): { total: number; evIdx: number } {
  const hw = humanWeek(tw); let i = fromEv;
  for (; i < hw.ev.length && i < toEv; i++) {
    const e = hw.ev[i]; if (e.t >= toTime) break;
    if (e.kind === 0) {
      const p = tw.games[e.g].p; hs.lastPlayed[p] = played[e.g] ? 1 : 0;
      if (hs.inGame[p] === e.g) { hs.inGame[p] = -1; hs.held[p] = played[e.g] ? actual[e.g] : 0; hs.heldGame[p] = e.g; }
    } else if (e.kind === 1) {
      const m = hw.moments[e.g];
      if (m.first) hs.mode = r() < hs.e ? (r() < par.pt ? 2 : 1) : 0;
      // per tip-off: today's players not started yet, slots freed by finished games reused (locks reviewed once a day)
      if (hs.mode === 2) decide(tw, hw, par, hs, m.d, e.t, hw.dayGames[m.d], played, r, m.first);
      else if (hs.mode === 1 && m.first) decide(tw, hw, par, hs, m.d, e.t, hw.dayGames[m.d], played, r, true);
    } else {
      const p = tw.games[e.g].p; if (hs.isLocked[p]) continue;
      for (let s = 0; s < tw.slots.length; s++) if (hs.occ[s] === p && !hs.locked[s]) { hs.inGame[p] = e.g; hs.held[p] = NaN; break; }
    }
  }
  return { total: humanTotal(hs), evIdx: i };
}
// locked points + held scores of unlocked occupants (the week-end count; mid-week: what is banked or held now)
export function humanTotal(hs: HState) {
  let t = 0;
  for (let s = 0; s < hs.occ.length; s++) { if (hs.locked[s]) t += hs.pts[s]; else { const p = hs.occ[s]; if (p >= 0 && !Number.isNaN(hs.held[p])) t += hs.held[p]; } }
  return t;
}
// per slot at week end: [points, game counted (-1 none)]
export function humanSlots(hs: HState): [number, number][] {
  return Array.from(hs.occ, (p, s) => (hs.locked[s] ? [hs.pts[s], hs.lockGame[s]] : p >= 0 && !Number.isNaN(hs.held[p]) ? [hs.held[p], hs.heldGame[p]] : [0, -1]) as [number, number]);
}
export const firstEvAfter = (tw: E.TeamWeek, t: number) => { const ev = humanWeek(tw).ev; let i = 0; while (i < ev.length && ev[i].t < t) i++; return i; };

// ---------------- the opponent's final-total distribution ----------------
// Smoothed empirical CDF of M simulated finals: F(x) = mean_i Phi((x - O_i) / h), tabulated on a 0.25-pt grid.
export interface OppDist { mean: number; sd: number; h: number; samples: Float64Array; lo: number; step: number; tab: Float64Array; F: (x: number) => number }
export function oppDist(samples: ArrayLike<number>, hMin = 1): OppDist {
  const s = Float64Array.from(samples).sort(); const M = s.length;
  let m = 0; for (const x of s) m += x; m /= M; let v = 0; for (const x of s) v += (x - m) ** 2; const sd = Math.sqrt(v / Math.max(1, M - 1));
  const h = Math.max(hMin, 1.06 * sd * Math.pow(M, -0.2));
  const lo = s[0] - 6 * h, hi = s[M - 1] + 6 * h, step = 0.25; const n = Math.ceil((hi - lo) / step) + 1;
  const tab = new Float64Array(n);
  // F on the grid: samples below x - 6h count 1 each, those within 6h their kernel, the rest 0 (samples are sorted)
  let j0 = 0;
  for (let k = 0; k < n; k++) {
    const x = lo + k * step; while (j0 < M && s[j0] < x - 6 * h) j0++;
    let f = j0; for (let j = j0; j < M && s[j] <= x + 6 * h; j++) f += E.normCdf((x - s[j]) / h);
    tab[k] = f / M;
  }
  const F = (x: number) => { const u = (x - lo) / step; if (u <= 0) return 0; if (u >= n - 1) return 1; const k = Math.floor(u), f = u - k; return tab[k] * (1 - f) + tab[k + 1] * f; };
  return { mean: m, sd, h, samples: s, lo, step, tab, F };
}
// Unmodelled human variation (calibrated in research/humanfit.ts "calib"): every simulated final gets an extra
// N(delta, sigma^2 * rho) while games remain, rho = share of his week's games not tipped off yet (1 at week start), so the opponent's distribution matches the real managers' (mean, spread, PIT calibration through the week).
export interface Resid { delta: number; sigma: number }
export const HUMAN_RESID: Resid = { delta: -5, sigma: 60 };
export function remainingShare(tw: E.TeamWeek, t: number) { let n = 0; for (const g of tw.games) if (g.tip >= t) n++; return tw.games.length ? n / tw.games.length : 0; }
// M simulated finals of the human from a snapshot (state hs before event fromEv, at time t), outcomes of games that
// end by t taken from `known`, the rest drawn from the model; the manager's traits (engagement, threshold offset,
// today's mode) redrawn from the prior every simulation.
// keepTraits (research: the true conditional distribution of a simulated manager whose traits are known) keeps hs's
// engagement, threshold offset and today's mode.
export function oppSamples(tw: E.TeamWeek, par: HumanParams, hs: HState, fromEv: number, t: number, known: { actual: Float64Array; played: Uint8Array }, M: number, r: () => number, resid: Resid = HUMAN_RESID, keepTraits = false): Float64Array {
  const out = new Float64Array(M); const rho = remainingShare(tw, t);
  for (let k = 0; k < M; k++) {
    const sc = E.sampleScenario(tw, null, t, r, known);
    const h = cloneH(hs); if (!keepTraits) { drawTraits(h, par, r); h.mode = r() < h.e ? (r() < par.pt ? 2 : 1) : 0; }
    let x = simulateHuman(tw, par, h, sc.actual, sc.played, r, fromEv).total;
    if (rho > 0 && (resid.sigma > 0 || resid.delta !== 0)) { let u = 0; while (u === 0) u = r(); x += resid.delta + resid.sigma * Math.sqrt(rho) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
    out[k] = x;
  }
  return out;
}
