// Policy comparison on one team-week under the model (common random numbers) and on its real outcome.
// usage: node research/dist/p8exp.cjs <week> <rid> <out.json>   env POLS=a,b,... NSC (scenarios, default 40)
// Output: per policy the total on each scenario and on the real outcome, and the time per simulated week.
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { priceStats } from "../lib/engine/p8";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const pols = (process.env.POLS || "P2LAH_LheldTie,P8").split(";"); const NSC = Number(process.env.NSC || 40);
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const sc = PL.scenarios(tw, NSC, seed * 17 + 3);
const row: any = { week, rid, pols: {} };
for (const pn of pols) {
  const t0 = performance.now();
  const ru = PL.runner(pn, tw, seed, real);
  const realTotal = E.simulate(tw, ru.pol, ru.events, real.actual, real.played, E.initState(tw), 0, ru.hooks).total;
  const t1 = performance.now();
  const tot = sc.map((s, k) => { const r2 = PL.runner(pn, tw, seed + 7919 * (k + 1), s); return E.simulate(tw, r2.pol, r2.events, s.actual, s.played, E.initState(tw), 0, r2.hooks).total; });
  row.pols[pn] = { real: realTotal, sc: tot.map((x) => Math.round(x * 100) / 100), msWeek: (performance.now() - t1) / NSC, msFirst: t1 - t0, prices: priceStats(tw) };
}
fs.writeFileSync(out, JSON.stringify(row));
