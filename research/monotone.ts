// "An extra player can't hurt" check: drop effect of a player under rule variants (same simulated weeks, weeks 1+2).
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { sleeper } from "../lib/live/sources";
const N = Number(process.env.N || 2000); const WHO = (process.env.WHO || "Santi Aldama,Cason Wallace").split(",");
const VARIANTS: Record<string, E.Policy> = {
  current: POLICY, noReserve: { ...POLICY, reserve: false }, noLockAware: { ...POLICY, lockAware: false },
  holdYield: { ...POLICY, holdYield: true }, noChain: { ...POLICY, chain: false },
};
(async () => {
  const L = "1344387394811490304", asOf = Date.now(); const P = await sleeper.players(3600e3);
  const ctx = async (drop: string[]) => Promise.all([1, 2].map((w) => buildWeek({ leagueId: L, rosterId: 8, week: w, asOf, rosterEdit: { drop }, skipOpp: true }).then((c) => ({ T: c.me, w }))));
  const tot = (cs: any[], pol: E.Policy) => { const o = new Float64Array(N); for (const { T, w } of cs) { const ev = pol.chain === POLICY.chain ? T.events : E.buildEvents(T.tw, pol.chain); for (let k = 0; k < N; k++) { const sc = scenario(T, k, w * 7919, asOf); o[k] += E.simulate(T.tw, pol, ev, sc.actual, sc.played, E.cloneState(T.st), ev === T.events ? T.evIdx : ev.findIndex((e: E.Ev) => e.t > asOf)).total; } } return o; };
  const base = await ctx([]);
  for (const [vn, pol] of Object.entries(VARIANTS)) {
    const b = tot(base, pol); const row = [`${vn.padEnd(12)} team ${(b.reduce((s, x) => s + x, 0) / N).toFixed(1)}`];
    for (const who of WHO) { const id = Object.keys(P).find((k) => (P as any)[k].full_name === who)!; const v = tot(await ctx([id]), pol);
      const d = Array.from(v, (x, k) => x - b[k]); const m = d.reduce((s, x) => s + x, 0) / N, sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / N);
      row.push(`drop ${who.split(" ")[1]} ${m >= 0 ? "+" : ""}${m.toFixed(2)}±${(1.96 * sd / Math.sqrt(N)).toFixed(2)}`); }
    console.log(row.join("  |  "));
  }
})();
