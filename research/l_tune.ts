// Task L tuning data (model scenarios only, no real outcomes): P10b played on NW model worlds of one team-week; at every
// raced decision the challenger a confirmation would look at (race switch, else best challenger with race gain > GATE)
// is re-scored against P8's decision on FRESH scenarios (per-scenario paired gains kept; research/lprobe.ts tuneProbe).
// Worlds: research/policies.ts scenarios(tw, NW, seed * 29 + 5) (not the gap / p10run model seeds); the policy's seed
// for world k is seed + 7919 * (k + 1) (as p10run's NSC runs). Rules are replayed offline by research/l_tune.py.
// usage: node research/dist/l_tune.cjs <week> <rid> <out.json>   env NW (2), FRESH (512), GATE (0.25), POLS (P10b)
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { tuneProbe } from "./lprobe";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
for (const kv of process.argv.slice(5)) { const i = kv.indexOf("="); if (i > 0) process.env[kv.slice(0, i)] = kv.slice(i + 1); }
const NW = Number(process.env.NW || 2), FRESH = Number(process.env.FRESH || 512), GATE = Number(process.env.GATE || 0.25);
const pn = process.env.POLS || "P10b";
const { tw } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const worlds = PL.scenarios(tw, NW, seed * 29 + 5);
const row: any = { week, rid, pol: pn, worlds: [] };
for (let k = 0; k < NW; k++) {
  const sd = seed + 7919 * (k + 1); const w = worlds[k]; const log: any[] = []; const t0 = performance.now();
  const ru = PL.runner(pn, tw, sd, w, null, undefined, tuneProbe(tw, E.buildEvents(tw, PL.policy(pn).chain), sd, w, FRESH, GATE, log));
  const total = E.simulate(tw, ru.pol, ru.events, w.actual, w.played, E.initState(tw), 0, ru.hooks).total;
  row.worlds.push({ k, total: Math.round(total * 100) / 100, stats: (ru.hooks as any)?.stats, ms: Math.round(performance.now() - t0), probe: log });
}
fs.writeFileSync(out, JSON.stringify(row));
