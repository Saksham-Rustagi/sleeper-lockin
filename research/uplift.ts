// Per-team gain of the full algorithm (rollouts at close lock calls) over the base rule, on the same simulated weeks.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
const K0 = Number(process.env.K0 || 0), N = Number(process.env.N || 16), K = Number(process.env.K || 50), RID = Number(process.env.RID || 8);
(async () => {
  const c = await buildWeek({ leagueId: "1344387394811490304", rosterId: RID, mode: "live", skipOpp: true }); const T = c.me;
  const d: number[] = []; const t0 = Date.now();
  for (let k = 0; k < N; k++) {
    const sc = scenario(T, K0 + k, 7919, c.asOf);
    const b = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx).total;
    const hooks = E.rolloutHooks(T.tw, POLICY, T.events, "points", K, 12, 1000 + K0 + k, sc);
    const f = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, hooks).total;
    d.push(f - b);
  }
  const m = d.reduce((a, b) => a + b, 0) / N, sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / N);
  console.log(JSON.stringify({ rid: RID, d })); console.error(`team ${RID}: ${((Date.now() - t0) / N / 1000).toFixed(2)} s per simulated week (K=${K}); gain ${m.toFixed(2)} (sd ${sd.toFixed(1)}, se ${(sd / Math.sqrt(N)).toFixed(2)})`);
})();
