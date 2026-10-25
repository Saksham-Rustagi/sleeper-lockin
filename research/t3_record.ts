// Task T3: record the live inputs of one moment (every HTTP response buildWeek / advise fetch, plus the ESPN summaries
// of the games in progress) so the in-game decisions of a live night can be replayed offline, deterministically
// (research/t3_live.ts REPLAY=<file>). Own cache + config dirs (never the live app's).
//   node research/dist/t3_record.cjs <leagueId> <rosterId> <outDir>      -> <outDir>/rec_<asOf>.json.gz
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { buildWeek } from "../lib/live/week";
import { espnDay } from "../lib/live/sources";
import { etDate } from "../lib/live/week";

const [leagueId, rid, outDir] = process.argv.slice(2);
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/t3/cfg";
const rec: Record<string, { status: number; body: string }> = {};
const f0 = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const r = await f0(url, init); const body = await r.clone().text();
  rec[String(url)] = { status: r.status, body };
  return r;
}) as typeof fetch;
(async () => {
  const asOf = Date.now();
  const ctx = await buildWeek({ leagueId, rosterId: Number(rid), asOf, mode: "live" });
  // summaries of today's games in progress (ejections, on-court flags, the in-game injury list)
  for (const g of await espnDay(etDate(asOf))) if (g.state === "in") {
    const u = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${g.id}`;
    try { await fetch(u); } catch { /* recorded or not */ }
  }
  fs.mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, `rec_${asOf}.json.gz`);
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ asOf, leagueId, rosterId: Number(rid), rec })));
  const live = ctx.me.games.filter((g) => g.status === "in").map((g) => ctx.me.names[ctx.me.pids.indexOf(g.pid)]);
  console.log(`${new Date(asOf).toISOString()} ${Object.keys(rec).length} responses -> ${f}; my players in a game: ${live.join(", ") || "-"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
