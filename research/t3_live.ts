// Task T3 live check (read-only; own cache + config dirs, never the live app's): the in-game estimates of my players in
// a game, the mid-game forfeit evaluation (lib/engine/midgame.ts) and the "Do now" card / reminders.
//   node research/dist/t3_live.cjs <leagueId> <rosterId> [out.json]            live, now
//   REPLAY=<rec_*.json.gz> node research/dist/t3_live.cjs - - [out.json]       a moment recorded by research/t3_record.ts:
//     every HTTP response served from the recording, the clock fixed at its time (deterministic)
// env as usual: LOCKIN_MIDGAME_FORFEIT=0 (option off), LOCKIN_RACE_WORKERS, LOCKIN_SIMWORKER (worker bundle of this tree)
import fs from "fs";
import path from "path";
import zlib from "zlib";

const REPLAY = process.env.REPLAY;
let asOf: number | undefined;
let [leagueId, rid, outFile] = process.argv.slice(2);
if (REPLAY) {
  const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(REPLAY)).toString());
  asOf = r.asOf; leagueId = r.leagueId; rid = String(r.rosterId);
  const rec: Record<string, { status: number; body: string }> = r.rec;
  globalThis.fetch = (async (url: any) => {
    const x = rec[String(url)]; if (!x) throw new Error(`not recorded: ${url}`);
    return new Response(x.body, { status: x.status });
  }) as typeof fetch;
  const t0 = Date.now(); const real = Date.now.bind(Date);
  Date.now = () => asOf! + (real() - t0); // (the recorded moment; time still passes for timings)
}
process.env.LOCKIN_CACHE_DIR ??= `research/scratch/t3/cache${REPLAY ? `_replay_${process.pid}` : ""}`;
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/t3/cfg";
process.env.LOCKIN_RACE_WORKERS ??= "6"; // memory is tight on this Mac
process.env.LOCKIN_SIMWORKER ??= path.resolve("research/dist/simworker_t3.cjs");

(async () => {
  const { advise } = await import("../lib/live/advise");
  const { doNowText } = await import("../lib/live/donow");
  const { messages } = await import("../scripts/notify");
  const t0 = Date.now();
  const a = await advise({ leagueId, rosterId: Number(rid), ...(asOf ? { asOf } : {}), force: true });
  const et = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" });
  console.log(`week ${a.week}, as of ${et(a.asOf)} ET (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  console.log("my players in a game now:");
  for (const p of a.me.players) for (const g of p.games) if (g.status === "in") {
    const s = a.me.slots.find((x) => x.pid === p.pid);
    const ig = (g as any).inGame;
    console.log(`  ${p.name.padEnd(24)} ${s ? s.slot.padEnd(5) : "bench"} ${ig ? `${ig.pts.toFixed(1)} pts in ${ig.min} min, game ${ig.elapsed}/${ig.total} min -> final ~${ig.mu} (sd ${ig.sd}; +${ig.remMin} min x ${ig.rate}/min)${ig.out ? ` OUT: ${ig.out}` : ""}` : g.dnp ? "dnp (Out, no stats)" : "no in-game info"} (proj ${g.proj})`);
  }
  const mg = a.plan[0]?.midgame ?? [];
  console.log(`\nmid-game forfeit check at the ${a.plan[0]?.when ?? "-"} tip-off: ${mg.length ? "" : "no candidates"}`);
  for (const m of mg) console.log(`  [${m.recommended}] ${m.text}  (keep ${m.keep.toFixed(1)}, forfeit ${m.forfeit.toFixed(1)}, gain ${m.gain.toFixed(2)} ± ${m.se.toFixed(2)} se, n ${m.n})`);
  console.log("\n" + doNowText(a.doNow!));
  const at = a.plan[0] ? Math.max(a.asOf, a.plan[0].tip - 30 * 60e3) : a.asOf;
  console.log(`\nreminders (as if at ${et(at)}):`);
  for (const m of messages(a, at)) console.log(`  [${m.title.length}/${m.body.length}] ${m.title}\n      ${m.body}`);
  if (outFile && outFile !== "-") fs.writeFileSync(outFile, JSON.stringify(a, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
