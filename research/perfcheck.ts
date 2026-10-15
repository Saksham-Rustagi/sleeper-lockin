// Bit-identity + speed check for engine optimisations (task C). One team-week per process (research/runtasks.mjs):
// every policy in env POLS (';'-separated) is run on the real outcomes exactly as research/p8exp.ts / p10run.ts run it
// (same runner, same seeds), and optionally on NSC model scenarios (p8exp's seeds). Totals are written at full
// precision so a bundle built before and after an optimisation can be compared bit for bit (research/perfcmp.py).
// usage: node research/dist/perfcheck.cjs <week> <rid> <out.json>
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const pols = (process.env.POLS || "P8;P7H_LheldTie").split(";"); const NSC = Number(process.env.NSC || 0);
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const row: any = { week, rid, pols: {} };
for (const pn of pols) {
  const t0 = performance.now(); const ru = PL.runner(pn, tw, seed, real);
  const r = E.simulate(tw, ru.pol, ru.events, real.actual, real.played, E.initState(tw), 0, ru.hooks);
  const ms = performance.now() - t0;
  const o: any = { real: r.total, locks: r.st.locks, ms };
  if (NSC) {
    const sc = PL.scenarios(tw, NSC, seed * 17 + 3); const t1 = performance.now();
    o.sc = sc.map((s, k) => { const r2 = PL.runner(pn, tw, seed + 7919 * (k + 1), s); return E.simulate(tw, r2.pol, r2.events, s.actual, s.played, E.initState(tw), 0, r2.hooks).total; });
    o.msWeek = (performance.now() - t1) / NSC;
  }
  row.pols[pn] = o;
}
fs.writeFileSync(out, JSON.stringify(row));
