// Wall-clock cost of the live app's views with the selected engine (env LOCKIN_ENGINE), on the current league data.
// usage: node research/dist/livecost.cjs <view: sims|advise|waivers|league|ir> <out.json>
// One view per process (fresh memory caches, fresh price solves); worker threads as in the app (scripts/dist/simworker.cjs).
import fs from "fs";
import { buildWeek } from "../lib/live/week";
import { advise } from "../lib/live/advise";
import { teamSims, summarize } from "../lib/live/teamsim";
import { waiverAdvice } from "../lib/live/waivers";
import { leagueWeek } from "../lib/live/league";
import { irAdvice } from "../lib/live/ir";
import { engineName } from "../lib/live/engine";

const LEAGUE = "1344387394811490304", ROSTER = 8;
const [view, out] = [process.argv[2], process.argv[3]];
(async () => {
  const t0 = Date.now(); const row: any = { engine: engineName(), view, at: new Date().toISOString() };
  const ctx = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, mode: "live" });
  row.week = ctx.week; row.buildMs = Date.now() - t0;
  row.games = ctx.me.games.length; row.gamesLeft = ctx.me.games.filter((g) => g.status === "pre").length;
  const t1 = Date.now();
  if (view === "sims") { const v = await teamSims(ctx.me, ctx.week, ctx.asOf); row.result = summarize(v); row.sims = v.length; }
  else if (view === "advise") { const a = await advise({ leagueId: LEAGUE, rosterId: ROSTER, force: true }); row.result = { outlook: a.outlook, decisions: a.decisions.length, plan: a.plan.length, actions: a.actions.slice(0, 4) }; }
  else if (view === "waivers") { const w: any = await waiverAdvice({ leagueId: LEAGUE, rosterId: ROSTER, force: true }); row.result = { keys: Object.keys(w), n: (w.players ?? w.candidates ?? []).length }; }
  else if (view === "league") { const l: any = await leagueWeek({ leagueId: LEAGUE, rosterId: ROSTER }); row.result = { teams: (l.teams ?? []).length }; }
  else if (view === "ir") { const r: any = await irAdvice({ leagueId: LEAGUE, rosterId: ROSTER }); row.result = { keys: Object.keys(r) }; }
  row.ms = Date.now() - t1;
  fs.writeFileSync(out, JSON.stringify(row, null, 1));
  console.log(JSON.stringify({ engine: row.engine, view, ms: row.ms, week: row.week, gamesLeft: row.gamesLeft }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
