// Task O live check (read-only, own cache dir): runs the live opportunity scan on the real league now, and checks the
// ESPN box-score parser against Sleeper's own stat rows for the same games (minutes and league fantasy points).
//   LOCKIN_CACHE_DIR=research/scratch/o/cache node research/dist/o_live.cjs <leagueId> [rosterId] [out.json]
import fs from "fs";
import { opportunityScan } from "../lib/live/oppscan";
import { collectBoxScores, pidMatcher, boxRows } from "../lib/live/boxscores";
import { histFrom, surge } from "../lib/live/opportunity";
import { sleeper } from "../lib/live/sources";
import { fantasyPoints } from "../lib/engine/model";

const [leagueId, rid, outFile] = process.argv.slice(2);
process.env.LOCKIN_CACHE_DIR ??= "research/scratch/o/cache"; // never the live app's cache
(async () => {
  const t0 = Date.now();
  let r = await opportunityScan({ leagueId, rosterId: rid ? Number(rid) : undefined, maxSummaries: 200 });
  console.log(`scan ${((Date.now() - t0) / 1000).toFixed(1)} s: box ${JSON.stringify(r.box)}; ${r.absences.length} absences, ${r.surges.length} surges, ${Object.keys(r.overrides).length} overrides, ${r.alerts.length} alerts`);
  const t1 = Date.now(); r = await opportunityScan({ leagueId, rosterId: rid ? Number(rid) : undefined }); console.log(`warm scan ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  for (const a of r.absences.slice(0, 12)) console.log(`OUT ${a.name} (${a.team}, ${a.mpg} mpg): ${a.candidates.slice(0, 3).map((c) => `${c.name} [${c.status}] +${c.gain} -> ${c.expMin} min ~${c.est} fp (Sleeper ${c.sleeperProj ?? "-"})`).join(" | ")}`);
  for (const s of r.surges) console.log(`SURGE ${s.name} [${s.status}]: ${s.why}`);
  for (const a of r.alerts) console.log(`ALERT ${a.title}\n      ${a.body}`);
  console.log("notes:", r.notes);
  // parser check: ESPN-derived vs Sleeper preseason stat rows (same player, same date)
  const league = await sleeper.league(leagueId); const S = league.scoring_settings;
  const { store } = await collectBoxScores({ season: league.season, from: `${league.season}-10-01`, to: new Date().toISOString().slice(0, 10), maxSummaries: 0 });
  const players = await sleeper.players(); const match = pidMatcher(players);
  const sl = new Map<string, Record<string, number>>();
  for (let w = 1; w <= 4; w++) for (const x of await sleeper.preseasonStats(league.season, w).catch(() => [])) if (x.stats?.sp) sl.set(`${x.player_id}|${x.date}`, x.stats);
  let n = 0, dMin = 0, dFp = 0, exact = 0, miss = 0; const worst: string[] = [];
  for (const g of Object.values(store.games)) for (const [team, ps] of Object.entries(g.box)) for (const p of ps) {
    if (p.dnp) continue; const pid = match(p.name, team); if (!pid) continue;
    const s = sl.get(`${pid}|${g.date}`); if (!s) { miss++; continue; }
    n++; const a = fantasyPoints(p.stats, S), b = fantasyPoints(s, S); dMin += Math.abs(p.min - s.sp / 60); dFp += Math.abs(a - b); if (Math.abs(a - b) < 0.01) exact++; else if (worst.length < 8) worst.push(`${p.name} ${g.date}: espn ${a} sleeper ${b}`);
  }
  console.log(`parser check: ${n} player-games matched to Sleeper rows (${miss} without a Sleeper row); mean |minutes diff| ${(dMin / n).toFixed(2)}, mean |fp diff| ${(dFp / n).toFixed(3)}, exact fp ${(100 * exact / n).toFixed(1)}%`);
  for (const w of worst) console.log("  differs:", w);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(r, null, 1));
  // 4th arg: player names to explain (surge inputs)
  for (const nm of (process.argv[5] || "").split(",").filter(Boolean)) {
    const pid = Object.keys(players).find((k) => players[k].full_name === nm); if (!pid) { console.log(nm, "not found"); continue; }
    const { rows } = boxRows(store, players, S); const h = histFrom(rows);
    const gs = (h.byPid.get(pid) || []).map((g) => `${g.date} ${g.min.toFixed(1)}m ${g.fp}fp${g.pre ? " (pre)" : ""}`);
    const wk = await sleeper.weekProjections(league.season, 1).catch(() => []); const pr = wk.filter((x) => x.player_id === pid).sort((a, b) => a.date.localeCompare(b.date))[0];
    const s = surge(h, pid, Date.now(), { min: pr?.stats?.sp ? pr.stats.sp / 60 : null, fp: pr ? fantasyPoints(pr.stats, S) : null });
    console.log(`${nm} (${pid}, ${players[pid].team}, ${r.absences.length ? "" : ""}injury ${players[pid].injury_status ?? "-"}): games ${gs.join(", ")}\n  Sleeper next: ${pr ? `${pr.date} ${fantasyPoints(pr.stats, S)} fp, ${(pr.stats.sp || 0) / 60} min` : "no projection row"}\n  surge: ${JSON.stringify(s)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
