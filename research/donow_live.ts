// Task U live check (read-only; own cache + config dir, never the live app's): the "Do now" card as text for the
// current state - the lineup to set before the next tip-off, the diff against Sleeper, the later changes, the
// reminder the notifier would send.
//   node research/dist/donow_live.cjs <leagueId> <rosterId> [out.json]
// (own dirs: research/scratch/donow/cache, research/scratch/donow/cfg)
import fs from "fs";
import { advise } from "../lib/live/advise";
import { doNowText } from "../lib/live/donow";
import { messages } from "../scripts/notify";

const [leagueId, rid, outFile] = process.argv.slice(2);
process.env.LOCKIN_CACHE_DIR ??= "research/scratch/donow/cache";
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/donow/cfg";
process.env.LOCKIN_RACE_WORKERS ??= "6"; // memory is tight on this Mac
(async () => {
  const t0 = Date.now();
  const a = await advise({ leagueId, rosterId: Number(rid) });
  console.log(`week ${a.week}, as of ${new Date(a.asOf).toLocaleString("en-US", { timeZone: "America/New_York" })} ET (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  console.log(doNowText(a.doNow!));
  // the reminder as if it were 30 min before the next tip-off
  const at = a.plan[0] ? a.plan[0].tip - 30 * 60e3 : Date.now();
  console.log(`\nreminders (as if at ${new Date(at).toLocaleString("en-US", { timeZone: "America/New_York" })}):`);
  for (const m of messages(a, at)) console.log(`  [${m.title.length}/${m.body.length}] ${m.title}\n      ${m.body}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(a, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
