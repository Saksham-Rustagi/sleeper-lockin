// Task T3: the mid-game forfeit option at scale (monotonicity / how often / how much), on real 2025-26 team-weeks.
// The week is played by P8 on the real outcomes. At every tip-off where a starter is in a game in progress (at most CAP
// per team-week) his in-game state is synthesised from the real final X of that game: elapsed fraction f of the game
// (from the clock), points so far = X * f * u (u ~ U(0.6, 1.4)), seconds played = f * projected minutes * U(0.8, 1.2); with
// probability POUT he is out for the rest of the game (points so far = X * f * U(0, 1)). lib/live/ingame.ts turns that
// into his final-score model (exactly as live), the option (lib/engine/midgame.ts, P8 engine, default settings) decides,
// and the decision is scored on M FRESH model scenarios (own stream, independent of the decision's): week total with
// the decision vs keeping everyone (both then played by P8), paired. The option must never lower expected points.
//   node research/dist/t3_mono.cjs <week> <rid> <out.json>      (research/runtasks.mjs)
// env M (default 300), CAP (default 6), POUT (default 0.15)
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { midgameHooks, type MidgameResult } from "../lib/engine/midgame";
import { inGameEstimate } from "../lib/live/ingame";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const M = Number(process.env.M || 300), CAP = Number(process.env.CAP || 6), POUT = Number(process.env.POUT || 0.15);
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const P8 = PL.POL.P8; const BASE = PL.p11Base(true);
const ev = E.buildEvents(tw, true);
const r = E.rng(seed ^ 0x51ed27); const t0 = performance.now();
const rows: any[] = [];
const st = E.initState(tw);
for (let i = 0; i < ev.length && rows.length < CAP; i++) {
  const e = ev[i];
  if (e.kind === 2 && e.group!.some((g) => !st.isLocked[tw.games[g].p])) {
    const inG: number[] = []; for (let p = 0; p < tw.pmask.length; p++) { const gi = st.inGame[p]; if (gi >= 0 && tw.games[gi].tip < e.t && tw.games[gi].end > e.t) inG.push(p); }
    if (inG.length) {
      // the in-game states (a copy of the team-week: games carry them)
      const tw2: E.TeamWeek = { ...tw, games: tw.games.map((g) => ({ ...g })) };
      const syn: any[] = [];
      for (const p of inG) {
        const gi = st.inGame[p]; const g = tw2.games[gi]; const X = real.played[gi] ? real.actual[gi] : 0;
        const f = Math.min(0.95, Math.max(0.05, (e.t - g.tip) / (g.end - g.tip)));
        const outG = r() < POUT; const pts = Math.round(X * f * (outG ? r() : 0.6 + 0.8 * r()) * 2) / 2;
        const el = 48 * f; const period = Math.min(4, Math.floor(el / 12) + 1); const clock = Math.max(0, period * 12 - el) * 60;
        const projMin = Math.min(40, Math.max(10, g.mu / 0.9));
        const est = inGameEstimate({ pts, sec: f * projMin * 60 * (0.8 + 0.4 * r()), period, clock, preMu: g.mu, preSd: g.sd, projSec: null, out: outG ? "synthetic" : null });
        g.mu = est.mu; g.sd = est.sd; g.pPlay = 1; g.live = { pts };
        syn.push({ p, gi, f: Math.round(f * 100) / 100, X, pts, out: outG, mu: est.mu, sd: est.sd });
      }
      let res: MidgameResult | null = null;
      const h = midgameHooks(tw2, ev, undefined, { pol: P8, base: BASE, makeInner: () => undefined, realised: real, seed: seed + i, onResult: (x) => { res = x; } });
      const s = E.cloneState(st); const tA = performance.now();
      E.simulate(tw2, P8, ev, real.actual, real.played, s, i, h, e.t);
      const ms = performance.now() - tA;
      const R = res as MidgameResult | null;
      let fresh: { m: number; se: number } | null = null;
      if (R && R.pick >= 0) {
        const fwd = E.cloneState(st); E.forfeitGame(fwd, R.pick);
        const rr = E.rng(seed ^ (i * 7919) ^ 0x2f6b); let a = 0, a2 = 0;
        for (let k = 0; k < M; k++) {
          const sc = E.sampleScenario(tw2, st, e.t, rr, real);
          const x = E.simulate(tw2, P8, ev, sc.actual, sc.played, E.cloneState(fwd), i).total - E.simulate(tw2, P8, ev, sc.actual, sc.played, E.cloneState(st), i).total;
          a += x; a2 += x * x;
        }
        const m = a / M; fresh = { m, se: Math.sqrt(Math.max(0, a2 / M - m * m) / (M - 1)) };
      }
      rows.push({ i, t: e.t, nIn: inG.length, syn, cands: R ? R.evals.length : 0, pick: R ? R.pick : -1, evals: R ? R.evals.map((x) => ({ p: x.p, gain: x.gain, se: x.se, n: x.n, pass: x.pass, deferred: x.deferred, starts: x.starts.length })) : [], fresh, ms });
    }
  }
  E.simulate(tw, P8, ev.slice(0, i + 1), real.actual, real.played, st, i); // the real week goes on, one event (P8, keep)
}
fs.writeFileSync(out, JSON.stringify({ week, rid, rows, ms: performance.now() - t0 }));
