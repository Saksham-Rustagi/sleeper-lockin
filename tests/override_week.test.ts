// Override plumbing end to end on a stubbed Sleeper + ESPN backend: the minutes override replaces a flagged player's
// projection in buildWeek (live) only with "minutesOverride" on, labels it, and changes the fingerprints.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "ovw-cfg-"));
process.env.LOCKIN_CONFIG_DIR = CFG; delete process.env.LOCKIN_CACHE_DIR; delete process.env.LOCKIN_MINUTES_OVERRIDE;
import { buildWeek } from "../lib/live/week";
import { teamFingerprint } from "../lib/live/teamsim";
import { fingerprint } from "../lib/live/cache";
import { resetOptionCache } from "../lib/live/override";
import { resetOverrideMemo, opportunityScan } from "../lib/live/oppscan";

const L = "L1", ASOF = Date.parse("2026-10-25T16:00:00Z");
const SCORING = { pts: 1, reb: 1, ast: 1 };
const players: Record<string, any> = {
  "101": { player_id: "101", full_name: "Star Guard", team: "AAA", fantasy_positions: ["PG"], injury_status: "Out" },
  "102": { player_id: "102", full_name: "Backup Guard", team: "AAA", fantasy_positions: ["PG"], injury_status: null },
  "103": { player_id: "103", full_name: "Wing Player", team: "AAA", fantasy_positions: ["SF"], injury_status: null },
  "201": { player_id: "201", full_name: "Other Center", team: "BBB", fantasy_positions: ["C"], injury_status: null },
  "202": { player_id: "202", full_name: "Bench Big", team: "BBB", fantasy_positions: ["C"], injury_status: null },
  "204": { player_id: "204", full_name: "Stale Big", team: "BBB", fantasy_positions: ["C"], injury_status: null },
  "205": { player_id: "205", full_name: "Free Big", team: "BBB", fantasy_positions: ["C"], injury_status: null },
  "203": { player_id: "203", full_name: "Late Rookie", team: "BBB", fantasy_positions: ["SF"], injury_status: null },
};
// AAA played every other day Oct 2 - Oct 24 (12 games); the star missed Oct 8 and Oct 10 (the backup played 26 then)
const past = Array.from({ length: 12 }, (_, i) => `2026-10-${String(2 + 2 * i).padStart(2, "0")}`);
const future = ["2026-10-26", "2026-10-28"];
const keys = ["minutes", "points"];
const box = (d: string) => {
  const out = d === "2026-10-08" || d === "2026-10-10";
  const a = (name: string, min: number, pts: number) => ({ athlete: { id: name, displayName: name }, starter: false, didNotPlay: min === 0, stats: min ? [String(min), String(pts)] : [] });
  return { boxscore: { players: [{ team: { abbreviation: "AAA" }, statistics: [{ keys, athletes: [a("Star Guard", out ? 0 : 33, 30), a("Backup Guard", out ? 26 : 9, out ? 22 : 7), a("Wing Player", 30, 15)] }] },
    { team: { abbreviation: "BBB" }, statistics: [{ keys, athletes: [a("Other Center", 30, 20), a("Bench Big", 20, 10), a("Stale Big", 20, 10), a("Free Big", 20, 10), ...(d >= "2026-10-22" ? [a("Late Rookie", 28, 25)] : [])] }] }] } };
};
const sched = [...past.map((d) => ({ d, w: 0 })), ...future.map((d) => ({ d, w: 1 }))].map(({ d, w }) => ({ game_id: `s${d}`, date: d, week: w || 1, status: "", home: { team: "AAA" }, away: { team: "BBB" } }))
  .filter((g) => future.includes(g.date)); // the regular-season schedule: week 1 only (the past games were preseason)
// the backup: 6 pts projected on Oct 26, 60 on Oct 28 (Sleeper already above any override: kept)
const proj = [...future.map((d, i) => ({ player_id: "102", date: d, team: "AAA", opponent: "BBB", game_id: `s${d}`, stats: { pts: i ? 60 : 6, sp: 600 } })),
  ...future.map((d) => ({ player_id: "103", date: d, team: "AAA", opponent: "BBB", game_id: `s${d}`, stats: { pts: 10, sp: 1800 } }))];
// no Sleeper projection rows for BBB's players (task O2); season projections: Bench Big 5 fp/g, Stale Big 40 fp/g (above his estimate)
function stub(url: string): unknown {
  const u = new URL(url);
  if (u.host.includes("espn")) {
    if (u.pathname.endsWith("/scoreboard")) {
      const d8 = u.searchParams.get("dates")!; const d = `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6)}`;
      if (!past.includes(d) && !future.includes(d)) return { events: [] };
      const post = past.includes(d);
      return { events: [{ id: `e${d8}`, date: `${d}T23:30Z`, season: { type: post ? 1 : 2 }, status: { type: { state: post ? "post" : "pre", shortDetail: "" } }, competitions: [{ competitors: [{ score: "0", team: { abbreviation: "AAA" } }, { score: "0", team: { abbreviation: "BBB" } }] }] }] };
    }
    if (u.pathname.endsWith("/summary")) { const id = u.searchParams.get("event")!.slice(1); return box(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6)}`); }
  }
  const p = u.pathname;
  if (p === `/v1/league/${L}`) return { league_id: L, name: "t", season: "2026", status: "in_season", roster_positions: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL", "BN", "BN"], scoring_settings: SCORING, settings: {}, total_rosters: 2 };
  if (p === `/v1/league/${L}/users`) return [{ user_id: "u1", display_name: "me" }];
  if (p === `/v1/league/${L}/rosters`) return [{ roster_id: 1, owner_id: "u1", players: ["102", "103"], starters: [], reserve: [], taxi: [] }, { roster_id: 2, owner_id: "u2", players: ["201", "202", "203", "204"], starters: [], reserve: [], taxi: [] }];
  if (p.startsWith(`/v1/league/${L}/matchups/`)) return [];
  if (p.startsWith(`/v1/league/${L}/transactions/`)) return [];
  if (p === "/v1/players/nba") return players;
  if (p === "/schedule/nba/regular/2026") return sched;
  if (p.startsWith("/projections/nba/2026/")) return p.endsWith("/1") ? proj : [];
  if (p.startsWith("/stats/nba/")) return [];
  if (p.startsWith("/v1/projections/nba/regular/")) return { "202": { gp: 1, pts: 5 }, "204": { gp: 1, pts: 40 } };
  if (p === "/v1/state/nba") return { week: 1, season: "2026" };
  throw new Error("unstubbed " + url);
}
globalThis.fetch = (async (url: string) => ({ ok: true, status: 200, json: async () => stub(String(url)) })) as any;

test("minutes override: off = Sleeper's projection; on = override with label, new fingerprints", async () => {
  const off = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  const g0 = off.me.games.filter((g) => g.pid === "102");
  assert.equal(g0.length, 2); assert.deepEqual(g0.map((g) => g.proj), [6, 60]); assert.ok(g0.every((g) => !g.projOverride)); assert.equal(off.me.overrides, undefined);
  const fpOff = fingerprint({ me: teamFingerprint(off.me) });

  const scan = await opportunityScan({ leagueId: L, rosterId: 1, asOf: ASOF });
  const ab = scan.absences.find((a) => a.pid === "101"); assert.ok(ab, "the star is a rotation player tagged Out");
  assert.equal(ab!.candidates[0].pid, "102"); assert.equal(ab!.candidates[0].status, "mine");
  assert.ok(scan.overrides["102"], "the backup is flagged"); assert.ok(scan.notes.some((n) => /preseason/.test(n)));

  fs.writeFileSync(path.join(CFG, "config.json"), JSON.stringify({ minutesOverride: true })); resetOptionCache(); resetOverrideMemo();
  const on = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  const g1 = on.me.games.filter((g) => g.pid === "102");
  const ov = scan.overrides["102"];
  assert.ok(g1[0].proj === ov.perGame && g1[0].projOverride?.startsWith("projection override: based on last"), JSON.stringify(g1.map((g) => [g.proj, g.projOverride])));
  assert.ok(g1[1].proj === 60 && !g1[1].projOverride, "the override never lowers a game's projection");
  assert.ok(ov.perGame > 6, "the override raises the backup's projection");
  assert.ok(on.me.overrides?.["102"]); assert.equal(on.me.games.find((g) => g.pid === "103")!.projOverride, undefined, "unflagged players keep Sleeper's projection");
  assert.notEqual(fingerprint({ me: teamFingerprint(on.me) }), fpOff);
  // replay never uses overrides (they are built from today's data)
  const rp = await buildWeek({ leagueId: L, rosterId: 1, week: 1, mode: "replay", skipOpp: true });
  assert.ok(rp.me.games.filter((g) => g.pid === "102").every((g) => !g.projOverride));
});

test("no-projection override (task O2): only players without a Sleeper projection, >= 3 recent games, only if it raises", async () => {
  fs.writeFileSync(path.join(CFG, "config.json"), JSON.stringify({ minutesOverride: true })); resetOptionCache(); resetOverrideMemo();
  const scan = await opportunityScan({ leagueId: L, rosterId: 1, asOf: ASOF });
  const ov = scan.overrides["202"];
  assert.ok(ov && ov.source === "noProjection" && ov.label.startsWith("projection override: Sleeper has no game projection; based on last"), JSON.stringify(ov));
  assert.ok(ov.perGame > 5, `estimate ${ov.perGame} above the 5 fp/g fallback`);
  assert.ok(scan.overrides["204"]?.source === "noProjection" && scan.overrides["204"].perGame < 40);
  assert.equal(scan.overrides["103"], undefined, "has a Sleeper projection: no override");
  assert.equal(scan.overrides["203"], undefined, "played 2 of the team's last 5 games: no override");
  assert.ok(!scan.overrides["205"] && !scan.noProjection.some((x) => x.pid === "205"), "a free agent the scan doesn't surface: no override");
  assert.equal(scan.overrides["102"].source, "replacement", "flagged overrides are unchanged");
  assert.equal(scan.overrides["201"].source, "surge");
  const on = await buildWeek({ leagueId: L, rosterId: 2, week: 1, asOf: ASOF, skipOpp: true });
  const gs = (pid: string) => on.me.games.filter((g) => g.pid === pid);
  assert.equal(gs("202").length, 2); assert.ok(gs("202").every((g) => g.proj === ov.perGame && g.projOverride === ov.label));
  assert.ok(gs("204").every((g) => g.proj === 40 && !g.projOverride), "the override never lowers the fallback projection");
  assert.ok(gs("203").every((g) => g.proj === 12 && !g.projOverride));
  const mine = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  assert.ok(mine.me.games.filter((g) => g.pid === "103").every((g) => g.proj === 10 && !g.projOverride));
  fs.writeFileSync(path.join(CFG, "config.json"), JSON.stringify({ minutesOverride: false })); resetOptionCache(); resetOverrideMemo();
  const off = await buildWeek({ leagueId: L, rosterId: 2, week: 1, asOf: ASOF, skipOpp: true });
  assert.ok(off.me.games.filter((g) => g.pid === "202").every((g) => g.proj === 5 && !g.projOverride), "switch off: unchanged");
});
