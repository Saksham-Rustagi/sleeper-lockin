// Phase 3 season run, one team-week per process (research/runtasks.mjs): every policy in env POLS (';'-separated) is
// run on the real outcomes through the invariant checker (research/invariants.ts), which gives the backtest total
// (identical to research/p8exp.ts: same runner, same seeds) together with the rule / sanity report and, for P10, the
// compute per decision. Optional NSC model scenarios (p8exp's seeds) per policy, unchecked.
// usage: node research/dist/p10run.cjs <week> <rid> <out.json>
// env DECLOG=1: also log every tip-off decision on the real outcomes (row.pols[p].dec = ["evIdx:decisionKey" or "evIdx:-" = P8's])
// Output: row.pols[p] = { real, msFirst, stats, sc } (the format of research/summ_season.py / summ_s24.py / summ_pool.py)
//         row[p] = { total, recount, rep, overrides, tipoffs, ms } (the format of research/summ_inv.py)
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { runChecked } from "./invariants";
import { decisionKey } from "../lib/engine/p10";
import { runnerUpProbe } from "./lprobe";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const pols = (process.env.POLS || "P10").split(";"); const NSC = Number(process.env.NSC || 0);
// env FRESH=N (task L): task H's runner-up re-evaluation on the real outcomes (research/lprobe.ts runnerUpProbe; own
// random stream, decisions untouched; the probe's time is in msFirst, not in stats.ms): row.pols[p].fresh
const FRESH = Number(process.env.FRESH || 0), FRESHMIN = Number(process.env.FRESHMIN || 0.25);
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const row: any = { week, rid, pols: {} };
for (const pn of pols) {
  const fresh: any[] = []; const probe = FRESH > 0 && /^P1[01]/.test(pn) ? runnerUpProbe(tw, E.buildEvents(tw, PL.policy(pn).chain), seed, real, FRESH, FRESHMIN, fresh) : undefined;
  const t0 = performance.now(); const ru = PL.runner(pn, tw, seed, real, null, undefined, probe);
  const dec: string[] = []; const hd = ru.hooks?.decideIndex;
  if (process.env.DECLOG && hd) ru.hooks!.decideIndex = (st, t, i, ctx) => { const d = hd(st, t, i, ctx); dec.push(`${i}:${d ? decisionKey(d) : "-"}`); return d; };
  const r = runChecked(tw, ru.pol, ru.events, real.actual, real.played, ru.hooks, { label: `w${week} r${rid} ${pn} real` });
  const ms = performance.now() - t0;
  row.pols[pn] = { real: r.total, msFirst: ms, stats: (ru.hooks as any)?.stats, ...(process.env.DECLOG ? { dec } : {}), ...(probe ? { fresh } : {}) };
  row[pn] = { total: r.total, recount: r.trackerTotal, rep: r.rep, overrides: r.overrides, tipoffs: r.tipoffs, ms };
  if (NSC) {
    const sc = PL.scenarios(tw, NSC, seed * 17 + 3); const t1 = performance.now();
    row.pols[pn].sc = sc.map((s, k) => { const r2 = PL.runner(pn, tw, seed + 7919 * (k + 1), s); return Math.round(E.simulate(tw, r2.pol, r2.events, s.actual, s.played, E.initState(tw), 0, r2.hooks).total * 100) / 100; });
    row.pols[pn].msWeek = (performance.now() - t1) / NSC;
  }
}
fs.writeFileSync(out, JSON.stringify(row));
