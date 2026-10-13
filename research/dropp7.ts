// Drop effect of a player when the week is played the way the live app plays it (start/sit by simulation).
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { sleeper } from "../lib/live/sources";
const WHO = process.env.WHO || "Santi Aldama", K0 = Number(process.env.K0 || 0), N = Number(process.env.N || 20), KS = Number(process.env.KS || 100);
(async () => {
  const L = "1344387394811490304", asOf = Date.now();
  const P = await sleeper.players(3600e3); const id = Object.keys(P).find((k) => (P as any)[k].full_name === WHO)!;
  const ctx = async (drop: string[]) => Promise.all([1, 2].map((w) => buildWeek({ leagueId: L, rosterId: 8, week: w, asOf, rosterEdit: { drop }, skipOpp: true }).then((c) => ({ T: c.me, w }))));
  const A = await ctx([]), B = await ctx([id]);
  const play = (cs: any[], k: number, sims: boolean) => cs.reduce((tot: number, { T, w }: any) => { const sc = scenario(T, k, w * 7919, asOf);
    const hooks = sims ? E.startRolloutHooks(T.tw, POLICY, T.events, KS, 77 + k, sc) : undefined;
    return tot + E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, hooks).total; }, 0);
  const out: { rule: number; app: number }[] = [];
  for (let k = K0; k < K0 + N; k++) out.push({ rule: play(B, k, false) - play(A, k, false), app: play(B, k, true) - play(A, k, true) });
  console.log(JSON.stringify(out));
})();
