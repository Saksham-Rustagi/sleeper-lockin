// Task R: NBA roster check (lib/live/nbarosters.ts). A player whose Sleeper team's current roster (ESPN) doesn't list
// him gets no games for that team; one listed by another team's roster gets that team's games; a failed fetch or an
// incomplete roster changes nothing. Pure check + buildWeek / Waivers plumbing on a stubbed Sleeper + ESPN backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "rc-cfg-"));
process.env.LOCKIN_CONFIG_DIR = CFG; delete process.env.LOCKIN_CACHE_DIR; delete process.env.LOCKIN_ROSTER_CHECK; delete process.env.LOCKIN_MINUTES_OVERRIDE;
import { rosterCheck, resetRosterMemo, MIN_ROSTER, type TeamRosters } from "../lib/live/nbarosters";
import { buildWeek } from "../lib/live/week";
import { teamFingerprint } from "../lib/live/teamsim";
import { resetOptionCache } from "../lib/live/override";

const fill = (team: string, n: number) => Array.from({ length: n }, (_, i) => ({ espnId: `${team}${i}`, name: `${team} Filler${i}` }));
const players: Record<string, any> = {
  "1": { player_id: "1", full_name: "Kevin Porter Jr.", first_name: "Kevin", last_name: "Porter", team: "MIL", fantasy_positions: ["PG", "SG"], injury_status: null },
  "2": { player_id: "2", full_name: "Good Player", team: "MIL", fantasy_positions: ["SF"], injury_status: null },
  "3": { player_id: "3", full_name: "Signed Guy", team: "MIL", fantasy_positions: ["C"], injury_status: null },
  "4": { player_id: "4", full_name: "Nic Variant", first_name: "Nic", last_name: "Variant", team: "MIL", fantasy_positions: ["PF"], injury_status: null },
  "5": { player_id: "5", full_name: "Free Agent", team: null, fantasy_positions: ["PG"], injury_status: null },
  "6": { player_id: "6", full_name: "Small Roster", team: "AAA", fantasy_positions: ["PG"], injury_status: null },
};
const rosters = (): TeamRosters => new Map([
  ["MIL", [...fill("MIL", 12), { espnId: "m2", name: "Good Player" }, { espnId: "m4", name: "Nicolas Variant" }]],
  ["BOS", [...fill("BOS", 13), { espnId: "b3", name: "Signed Guy" }, { espnId: "b5", name: "Free Agent" }]],
  ["AAA", fill("AAA", MIN_ROSTER - 1)],
]);

test("rosterCheck: waived -> no team; signed elsewhere -> new team; name variant / small roster / no data -> unchanged", () => {
  const f = rosterCheck(players, Object.keys(players), rosters());
  assert.deepEqual(f["1"], { pid: "1", from: "MIL", to: null, label: "not on MIL roster (waived/released) - no games until he signs" });
  assert.equal(f["2"], undefined, "on his roster");
  assert.equal(f["3"].to, "BOS"); assert.match(f["3"].label, /on BOS roster \(ESPN\), Sleeper still lists MIL/);
  assert.equal(f["4"], undefined, "same last name on the roster (Nic / Nicolas): unchanged");
  assert.equal(f["5"].from, null); assert.equal(f["5"].to, "BOS", "Sleeper lists no team, ESPN has signed him");
  assert.equal(f["6"], undefined, `a roster with < ${MIN_ROSTER} players is treated as incomplete`);
  assert.deepEqual(rosterCheck(players, Object.keys(players), null), {}, "no roster data: no change");
  // a homonym already on the other team in Sleeper is that player, not ours
  const hp = { ...players, "7": { player_id: "7", full_name: "Signed Guy", team: "BOS", fantasy_positions: ["C"], injury_status: null } };
  assert.equal(rosterCheck(hp, ["3"], rosters())["3"].to, null);
});

// ---- buildWeek on a stubbed backend: MIL plays Oct 21 and 23, BOS Oct 22 ----
const L = "L1", ASOF = Date.parse("2026-10-20T16:00:00Z");
const dates = ["2026-10-21", "2026-10-22", "2026-10-23"];
const sched = [{ d: dates[0], h: "MIL", a: "AAA" }, { d: dates[1], h: "BOS", a: "CCC" }, { d: dates[2], h: "MIL", a: "DDD" }]
  .map(({ d, h, a }) => ({ game_id: `s${d}`, date: d, week: 1, status: "", home: { team: h }, away: { team: a } }));
const proj = [dates[0], dates[2]].map((d) => ({ player_id: "2", date: d, team: "MIL", opponent: "X", game_id: `s${d}`, stats: { pts: 15 } }));
let espnDown = false;
const espnRoster = (id: string) => ({ athletes: (id === "15" ? rosters().get("MIL")! : id === "2" ? rosters().get("BOS")! : fill(id, 14)).map((a) => ({ id: a.espnId, displayName: a.name })) });
function stub(url: string): { ok: boolean; status: number; v?: unknown } {
  const u = new URL(url); const p = u.pathname; const ok = (v: unknown) => ({ ok: true, status: 200, v });
  if (u.host.includes("espn")) {
    if (p.endsWith("/scoreboard")) {
      const d8 = u.searchParams.get("dates")!; const g = sched.find((x) => x.date.replace(/-/g, "") === d8);
      return ok({ events: g ? [{ id: `e${d8}`, date: `${g.date}T23:30Z`, season: { type: 2 }, status: { type: { state: "pre", shortDetail: "" } }, competitions: [{ competitors: [{ team: { abbreviation: g.home.team } }, { team: { abbreviation: g.away.team } }] }] }] : [] });
    }
    if (espnDown) return { ok: false, status: 503 };
    if (p.endsWith("/nba/teams")) return ok({ sports: [{ leagues: [{ teams: [{ team: { id: "15", abbreviation: "MIL" } }, { team: { id: "2", abbreviation: "BOS" } }] }] }] });
    const m = p.match(/\/teams\/(\d+)\/roster$/); if (m) return ok(espnRoster(m[1]));
  }
  if (p === `/v1/league/${L}`) return ok({ league_id: L, name: "t", season: "2026", status: "in_season", roster_positions: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL", "BN", "BN"], scoring_settings: { pts: 1 }, settings: {}, total_rosters: 1 });
  if (p === `/v1/league/${L}/users`) return ok([{ user_id: "u1", display_name: "me" }]);
  if (p === `/v1/league/${L}/rosters`) return ok([{ roster_id: 1, owner_id: "u1", players: ["1", "2", "3"], starters: [], reserve: [], taxi: [] }]);
  if (p.startsWith(`/v1/league/${L}/matchups/`) || p.startsWith(`/v1/league/${L}/transactions/`)) return ok([]);
  if (p === "/v1/players/nba") return ok(players);
  if (p === "/schedule/nba/regular/2026") return ok(sched);
  if (p.startsWith("/projections/nba/2026/")) return ok(p.endsWith("/1") ? proj : []);
  if (p.startsWith("/stats/nba/")) return ok([]);
  if (p.startsWith("/v1/projections/nba/regular/")) return ok({ "1": { gp: 1, pts: 21.3 }, "3": { gp: 1, pts: 18 } });
  if (p === "/v1/state/nba") return ok({ week: 1, season: "2026" });
  throw new Error("unstubbed " + url);
}
globalThis.fetch = (async (url: string) => { const r = stub(String(url)); return { ok: r.ok, status: r.status, json: async () => r.v }; }) as any;
const gamesOf = (c: Awaited<ReturnType<typeof buildWeek>>, pid: string) => c.me.games.filter((g) => g.pid === pid).map((g) => `${g.date} ${g.team} ${g.proj}`);

test("buildWeek: roster fetch fails -> unchanged (season-projection fallback, Sleeper's team)", async () => {
  espnDown = true; resetRosterMemo();
  const c = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  assert.deepEqual(gamesOf(c, "1"), ["2026-10-21 MIL 21.3", "2026-10-23 MIL 21.3"]);
  assert.deepEqual(gamesOf(c, "3"), ["2026-10-21 MIL 18", "2026-10-23 MIL 18"]);
  assert.equal(c.me.rosterFix, undefined);
  espnDown = false; resetRosterMemo();
});

test("buildWeek: waived -> no games (labelled); signed elsewhere -> new team's games; switch off -> unchanged", async () => {
  const c = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  assert.deepEqual(gamesOf(c, "1"), [], "waived: no MIL games");
  assert.deepEqual(gamesOf(c, "2"), ["2026-10-21 MIL 15", "2026-10-23 MIL 15"], "on the roster: unchanged");
  assert.deepEqual(gamesOf(c, "3"), ["2026-10-22 BOS 18"], "on BOS's roster: BOS's game");
  assert.ok(c.notes.some((n) => n === "Kevin Porter Jr.: not on MIL roster (waived/released) - no games until he signs."), JSON.stringify(c.notes));
  assert.equal(c.me.rosterFix?.["1"].to, null);
  const fpOn = JSON.stringify(teamFingerprint(c.me));
  process.env.LOCKIN_ROSTER_CHECK = "0"; resetOptionCache(); resetRosterMemo();
  const off = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  assert.equal(gamesOf(off, "1").length, 2); assert.notEqual(JSON.stringify(teamFingerprint(off.me)), fpOn);
  delete process.env.LOCKIN_ROSTER_CHECK; resetOptionCache(); resetRosterMemo();
  // replay (historical) never uses today's rosters
  const rp = await buildWeek({ leagueId: L, rosterId: 1, week: 1, mode: "replay", skipOpp: true });
  assert.equal(gamesOf(rp, "1").length, 2);
});
