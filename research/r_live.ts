// Task R live check (read-only, own cache + config dir): the NBA roster check on the real league now. Prints one
// player's week games with the check off / on, every rostered player in the league the check changes, and the
// name-matching sanity numbers (rostered players found on their team's ESPN roster by exact name / last name only).
//   node research/dist/r_live.cjs <leagueId> <rosterId> [pid to show, default 2009 = Kevin Porter Jr.]
// (own dirs: research/scratch/r/cache, research/scratch/r/cfg)
import { buildWeek } from "../lib/live/week";
import { sleeper } from "../lib/live/sources";
import { nbaRosters, rosterCheck, resetRosterMemo } from "../lib/live/nbarosters";
import { normName } from "../lib/live/boxscores";
import { resetOptionCache } from "../lib/live/override";

const [leagueId, rid, show = "2009"] = process.argv.slice(2);
process.env.LOCKIN_CACHE_DIR ??= "research/scratch/r/cache"; // never the live app's cache / config
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/r/cfg";
const fmtG = (gs: { date: string; team: string; opp: string; proj: number; status: string }[]) => gs.map((g) => `${g.date} ${g.team} vs ${g.opp} ${g.status} ${Math.round(g.proj * 10) / 10} fp`).join("; ") || "no games";
(async () => {
  const t0 = Date.now(); const R = await nbaRosters();
  console.log(`ESPN rosters: ${R ? `${R.size} teams, sizes ${[...R.values()].map((r) => r.length).sort((a, b) => a - b).join(",")}` : "unavailable"} (${Date.now() - t0} ms)`);
  const [players, rosters] = await Promise.all([sleeper.players(), sleeper.rosters(leagueId)]);
  const all = rosters.flatMap((r) => [...(r.players || []), ...(r.taxi || []), ...(r.reserve || [])].map((pid) => ({ pid, rid: r.roster_id })));
  const fixes = rosterCheck(players, all.map((x) => x.pid), R);
  console.log(`\nrostered players the check changes (${Object.keys(fixes).length} of ${all.length}):`);
  for (const x of all) { const f = fixes[x.pid]; if (f) console.log(`  roster ${x.rid}${x.rid === Number(rid) ? " (mine)" : ""}: ${players[x.pid]?.full_name} (${x.pid}, Sleeper ${players[x.pid]?.team ?? "-"}): ${f.label}`); }
  // name-matching sanity: rostered players on their Sleeper team's ESPN roster by exact name vs only by last name
  let exact = 0, lastOnly: string[] = [];
  for (const x of all) {
    const p = players[x.pid]; const roster = p?.team ? R?.get(p.team) : undefined; if (!p || !roster) continue;
    const k = normName(p.full_name || ""); if (roster.some((a) => normName(a.name) === k)) { exact++; continue; }
    if (!fixes[x.pid]) lastOnly.push(`${p.full_name} (${p.team}) ~ ${roster.filter((a) => normName(a.name.split(" ").filter((t) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(t)).pop() || "") === normName(p.last_name || "")).map((a) => a.name).join("/")}`);
  }
  console.log(`\nname matching: ${exact} rostered players found by exact name; ${lastOnly.length} only by last name (kept, fail-safe): ${lastOnly.join("; ") || "-"}`);

  const week = async (on: boolean) => {
    process.env.LOCKIN_ROSTER_CHECK = on ? "1" : "0"; resetOptionCache(); resetRosterMemo();
    return buildWeek({ leagueId, rosterId: Number(rid) });
  };
  const off = await week(false), on = await week(true);
  const name = players[show]?.full_name ?? show;
  console.log(`\nweek ${on.week}, ${name} (${show}), roster ${rid}:\n  before (check off): ${fmtG(off.me.games.filter((g) => g.pid === show))}\n  after  (check on):  ${fmtG(on.me.games.filter((g) => g.pid === show))}`);
  const n = (c: typeof on) => c.me.games.length + (c.opp?.games.length ?? 0);
  console.log(`  games in my + opponent's week: ${n(off)} -> ${n(on)}; notes: ${on.notes.filter((x) => !off.notes.includes(x)).join(" | ") || "-"}`);
  for (const ro of rosters) {
    if (ro.roster_id === Number(rid)) continue;
    process.env.LOCKIN_ROSTER_CHECK = "1"; resetOptionCache();
    const c = await buildWeek({ leagueId, rosterId: ro.roster_id, skipOpp: true });
    for (const f of Object.values(c.me.rosterFix || {})) console.log(`  roster ${ro.roster_id}: ${c.me.names[c.me.pids.indexOf(f.pid)]} -> ${fmtG(c.me.games.filter((g) => g.pid === f.pid))}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
