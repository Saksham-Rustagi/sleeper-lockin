// Task O2 live check (read-only, own cache + config dir): the no-projection override on the real league now. Lists every
// player the scan gives a noProjection override and, per team, the games buildWeek actually overrides (onlyRaise).
//   node research/dist/o2_live.cjs <leagueId> <rosterId> [pid to show, default 2621 = Leonard Miller]
// (own dirs: research/scratch/o2/cache, research/scratch/o2/cfg; the override switch on via env)
import { opportunityScan } from "../lib/live/oppscan";
import { buildWeek } from "../lib/live/week";
import { sleeper } from "../lib/live/sources";

const [leagueId, rid, show = "2621"] = process.argv.slice(2);
process.env.LOCKIN_CACHE_DIR ??= "research/scratch/o2/cache"; // never the live app's cache / config
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/o2/cfg";
process.env.LOCKIN_MINUTES_OVERRIDE = "1";
(async () => {
  const r = await opportunityScan({ leagueId, rosterId: Number(rid), maxSummaries: 200 });
  console.log(`scan: box ${JSON.stringify(r.box)}; overrides ${Object.values(r.overrides).map((o) => o.source).join(",") || "-"}`);
  console.log(`noProjection candidates (${r.noProjection.length}; rostered or free agent, team plays in the next 7 days, no Sleeper projection row):`);
  for (const s of r.noProjection) console.log(`  ${s.name} (${s.pid}, ${s.team}, ${s.status}): played ${s.playedN}/${s.window}, last3 ${s.last3} last10 ${s.last10} -> ${s.expMin} min x ${s.rate} fp/min = ${s.est} fp/g${r.overrides[s.pid]?.source === "noProjection" ? "" : " (flagged override wins)"}`);
  const rosters = await sleeper.rosters(leagueId);
  const applied: string[] = [];
  for (const ro of rosters) {
    const c = await buildWeek({ leagueId, rosterId: ro.roster_id, skipOpp: true });
    for (const pid of Object.keys(c.me.overrides || {})) {
      const o = c.me.overrides![pid]; if (o.source !== "noProjection") continue;
      const gs = c.me.games.filter((g) => g.pid === pid);
      applied.push(`  roster ${ro.roster_id}${ro.roster_id === Number(rid) ? " (mine)" : ""}: ${c.me.names[c.me.pids.indexOf(pid)]} (${pid}) ${gs.filter((g) => g.projOverride).length}/${gs.length} games -> ${o.perGame} fp/g`);
    }
    if (ro.roster_id === Number(rid)) {
      const gs = c.me.games.filter((g) => g.pid === show);
      console.log(`week ${c.week}, player ${show} on my roster: ${gs.map((g) => `${g.date} vs ${g.opp}: ${Math.round(g.proj * 10) / 10}${g.projOverride ? ` [${g.projOverride}]` : ""}`).join("\n    ") || "no games"}`);
    }
  }
  console.log(`noProjection overrides buildWeek applies (raise the fallback):\n${applied.join("\n") || "  none"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
