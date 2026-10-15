// P11 (ENGINE_V2 Phase 5): play for the win. P10's raced complete decisions, with every continuation scored by
//   U = T + beta(t) * F_opp(T)
// T = our simulated final total, F_opp = the CDF of the opponent's final total given what we know of him at t (his
// locks, held scores, games in progress, results so far; lib/engine/human.ts simulates his rest of the week as a human,
// many times, once per decision moment - it does not depend on our action). beta is points per unit of win probability
// (U / beta = P(win) + E[points] / beta: points-for is the standings tiebreaker); it is phased in over the week.
// Scoring by F_opp(T) instead of win/loss against one paired opponent sample per continuation (the old P4/P4S) removes
// the opponent's noise from every comparison.
// Risk dial: the continuations' own future decisions (P8 / P8f) are played with every game's mean shifted by
// gamma * sd^2 (certainty equivalent), gamma = 1/2 * E[U''(T)] / E[U'(T)] at our current projected final (pilot
// continuations of P8's decision): > 0 when behind (hold for ceilings, higher cut-offs, volatile starters), < 0 when
// ahead (secure points), ~0 when the result is decided either way (then points decide). The tilted P8 decision joins
// the race as a candidate. P8's own (untilted) decision stays the incumbent: it is replaced only by a candidate that is
// significantly better in U (P10's race rules), so with beta = 0 P11 is exactly P10.
import * as E from "./core";
import { indexContext, seedPrices, applyIndexDecision as applyDecision, type IndexDecision } from "./p8";
import { p10Hooks, newStats, type P10Opts, type P10Stats } from "./p10";
import type { OppDist } from "./human";

export interface P11Opts extends P10Opts {
  beta?: number;                         // points per unit of win probability (0 = P10)
  sched?: "late" | "ramp" | "const";     // phase-in: last `lateDays` game days / linear over the game days / whole week
  lateDays?: number;                     // (default 3)
  dial?: boolean;                        // risk dial for the continuations (default true)
  pilot?: number;                        // continuations of P8's decision for our projected final (default 32)
  tiltMax?: number;                      // |gamma| cap, 1/pts (default 0.05: a 5-pt shift for a game with sd 10)
  tiltMin?: number;                      // |gamma| below this is 0 (default 0.001: < 0.1 pt for sd 10; decided weeks play as P10)
  vr?: number;                           // diagnostic (0 = off): scenarios per decision comparing the smooth score F_opp(T)
                                         // with win/loss against one paired opponent sample (the old P4), own random stream
}
const DEF = { beta: 0, sched: "late" as const, lateDays: 3, dial: true, pilot: 32, tiltMax: 0.05, tiltMin: 0.001 };
// what we know of the opponent at t, as the distribution of his final total (null: no opponent)
export interface OppSource { dist(t: number): OppDist | null }

// game days of our week still to come at t (today included): the phase-in clock
export function daysLeft(tw: E.TeamWeek, t: number) { const s = new Set<number>(); for (const g of tw.games) if (g.tip >= t) s.add(E.dayEnd(g.tip)); return s.size; }
export function betaAt(tw: E.TeamWeek, t: number, o: P11Opts): number {
  const b = o.beta ?? DEF.beta; if (!(b > 0)) return 0;
  const sched = o.sched ?? DEF.sched; if (sched === "const") return b;
  const dl = daysLeft(tw, t); if (dl === 0) return b;
  if (sched === "late") return dl <= (o.lateDays ?? DEF.lateDays) ? b : 0;
  const D = new Set(tw.games.map((g) => E.dayEnd(g.tip))).size; return D > 1 ? b * Math.min(1, Math.max(0, (D - dl) / (D - 1))) : b;
}
// the first time beta > 0 (research: continuations of several policies share everything before it)
export function phaseStart(tw: E.TeamWeek, o: P11Opts): number {
  const tips = [...new Set(tw.games.map((g) => g.tip))].sort((a, b) => a - b);
  for (const t of tips) if (betaAt(tw, t, o) > 0) return t;
  return Infinity;
}
// gamma = 1/2 * E[U''] / E[U'] with U(T) = T + beta * F(T), T ~ N(mu, sd^2), F = the opponent's smoothed CDF (its
// samples with kernel h): E[F'(T)] = mean phi(z) / s, E[F''(T)] = mean -z phi(z) / s^2, z = (mu - O_i) / s,
// s^2 = sd^2 + h^2. Positive when behind, negative when ahead, -> 0 when the week is decided either way.
export function riskTilt(mu: number, sd: number, D: OppDist, beta: number, cap = DEF.tiltMax): number {
  const s = Math.sqrt(sd * sd + D.h * D.h); let p1 = 0, p2 = 0;
  for (const o of D.samples) { const z = (mu - o) / s; const ph = Math.exp(-0.5 * z * z) / 2.5066282746310002; p1 += ph; p2 -= z * ph; }
  p1 /= D.samples.length * s; p2 /= D.samples.length * s * s;
  const g = (0.5 * beta * p2) / (1 + beta * p1);
  return Math.max(-cap, Math.min(cap, g));
}
// the dial the policy uses: riskTilt, capped at tiltMax, and 0 below tiltMin
export function dialTilt(mu: number, sd: number, D: OppDist, beta: number, o: P11Opts = {}): number {
  const g = riskTilt(mu, sd, D, beta, o.tiltMax ?? DEF.tiltMax); return Math.abs(g) < (o.tiltMin ?? DEF.tiltMin) ? 0 : g;
}
// win probability of a final total distribution (samples of T) against the opponent
export const winProbOf = (D: OppDist, totals: ArrayLike<number>) => { let w = 0; for (let i = 0; i < totals.length; i++) w += D.F(totals[i]); return w / totals.length; };

export interface P11Stats extends P10Stats { win: { decisions: number; tilt: number; absTilt: number; pwin: number; tiltCands: number; log: number[][]; vr: number[][] } }
// top: the policy making the real decisions (P8; its prices are slot "top"); base: the continuations' (P8f or P8, slot "roll")
export function p11Hooks(tw: E.TeamWeek, top: E.Policy, base: E.Policy, events: E.Ev[], seed: number,
  realised: { actual: Float64Array; played: Uint8Array }, opp: OppSource | null, o: P11Opts = {}, r?: () => number): E.Hooks & { stats: P11Stats } {
  const stats: P11Stats = { ...newStats(), win: { decisions: 0, tilt: 0, absTilt: 0, pwin: 0, tiltCands: 0, log: [], vr: [] } };
  const rp = E.rng(seed ^ 0x1b873593); const rv = E.rng(seed ^ 0x2f2d1a5b); const scratch = E.scratchState();
  const dial = o.dial ?? DEF.dial; const pilotK = o.pilot ?? DEF.pilot;
  return p10Hooks(tw, base, events, seed, realised, o, stats, {
    r,
    prep: (st, t, evIdx, _ctx, cs) => {
      const beta = betaAt(tw, t, o); if (!(beta > 0) || !opp) return undefined;
      const D = opp.dist(t); if (!D) return undefined;
      const e = events[evIdx];
      // our projected final under P8's decision (pilot continuations, own random stream; untilted)
      const pilot = new Float64Array(pilotK);
      for (let k = 0; k < pilotK; k++) {
        const scen = E.sampleScenario(tw, st, t, rp, realised); const s2 = scratch(st);
        applyDecision(tw, s2, e, cs[0].d); seedPrices(tw, base.index?.slot ?? "roll");
        pilot[k] = E.simulate(tw, base, events, scen.actual, scen.played, s2, evIdx + 1).total;
      }
      let mu = 0; for (const x of pilot) mu += x; mu /= pilotK; let v = 0; for (const x of pilot) v += (x - mu) ** 2; const sd = Math.sqrt(v / Math.max(1, pilotK - 1));
      const gamma = dial ? dialTilt(mu, sd, D, beta, o) : 0;
      const pw = winProbOf(D, pilot);
      stats.win.decisions++; stats.win.tilt += gamma; stats.win.absTilt += Math.abs(gamma); stats.win.pwin += pw;
      stats.win.log.push([t, Math.round(beta), Math.round(mu * 10) / 10, Math.round(sd * 10) / 10, Math.round(D.mean * 10) / 10, Math.round(D.sd * 10) / 10, Math.round(pw * 1000) / 1000, Math.round(gamma * 1e4) / 1e4]);
      const extra: { d: IndexDecision; why: string }[] = [];
      let B = base;
      if (gamma !== 0) {
        B = { ...base, index: { ...base.index!, tilt: gamma } };
        // P8's decision under the tilted values (its own price state "tilt", warm-started from the real decision's)
        seedPrices(tw, "tilt", top.index?.slot ?? "top");
        const ct = indexContext(tw, { ...top, index: { ...top.index!, slot: "tilt", tilt: gamma } }, st, e);
        if (ct) { extra.push({ d: ct.best, why: "tilt" }); stats.win.tiltCands++; }
      }
      if ((o.vr ?? 0) > 0 && cs.length >= 2) { // paired differences between P8's decision and the first challenger
        const K = o.vr!; const ds = new Float64Array(K), db = new Float64Array(K);
        for (let k = 0; k < K; k++) {
          const scen = E.sampleScenario(tw, st, t, rv, realised); const O = D.samples[Math.floor(rv() * D.samples.length)];
          const T2 = [0, 1].map((c) => { const s2 = scratch(st); applyDecision(tw, s2, e, cs[c].d); seedPrices(tw, B.index?.slot ?? "roll"); return E.simulate(tw, B, events, scen.actual, scen.played, s2, evIdx + 1).total; });
          ds[k] = D.F(T2[0]) - D.F(T2[1]); db[k] = (T2[0] > O ? 1 : T2[0] === O ? 0.5 : 0) - (T2[1] > O ? 1 : T2[1] === O ? 0.5 : 0);
        }
        const mv = (a: Float64Array) => { let m = 0; for (const x of a) m += x; m /= a.length; let v = 0; for (const x of a) v += (x - m) ** 2; return [m, v / (a.length - 1)]; };
        const [ms, vs] = mv(ds), [mb, vb] = mv(db); stats.win.vr.push([K, ms, vs, mb, vb]);
      }
      return { score: (T: number) => T + beta * D.F(T), base: B, extra };
    },
  }) as E.Hooks & { stats: P11Stats };
}
