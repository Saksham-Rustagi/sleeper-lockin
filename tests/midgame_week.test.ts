// Task T3 end to end on a stubbed backend (8:40 PM ET, CHI @ TOR in Q2 with 5:00 left; MEM's game at 9:00 PM):
// buildWeek's in-game estimates (fouled out, ruled out mid-game per Sleeper's tag + ESPN's on-court flag, a normal game),
// the engine's mid-game check in the advice, the Do-now card and the reminder; the switch off = the old model.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
process.env.LOCKIN_ENGINE = "p7h"; process.env.LOCKIN_NO_WORKERS = "1"; delete process.env.LOCKIN_CACHE_DIR; // (memory caches only: never a live cache)
process.env.LOCKIN_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-mgw-")); // (options at their defaults)
import { buildWeek } from "../lib/live/week";
import { computeAdvice } from "../lib/live/advise";
import { doNowText } from "../lib/live/donow";
import { messages } from "../scripts/notify";
import { resetOptionCache } from "../lib/live/override";

const H = 3600e3; const ET = (h: number, m = 0) => Date.parse("2026-10-21T00:00:00-04:00") + h * H + m * 60e3;
const L = "MG1", ASOF = ET(20, 40);
const NAMES = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
const SCORING = { pts: 1, reb: 1, ast: 1, pf: -1 };
const P: Record<string, [string, string, string[], string | null]> = { // pid: name, team, positions, injury
  "1": ["Caleb Wilson", "CHI", ["SF", "PF"], null], "2": ["Leonard Miller", "CHI", ["SF", "PF"], null], "3": ["Collin Murray-Boyles", "TOR", ["PF", "C"], "Out"],
  "4": ["Big Center", "MEM", ["C"], null], "5": ["Guard One", "MEM", ["PG"], null], "6": ["Guard Two", "UTA", ["SG"], null],
};
const players = Object.fromEntries(Object.entries(P).map(([id, [n, t, pos, inj]]) => [id, { player_id: id, full_name: n, team: t, fantasy_positions: pos, injury_status: inj }]));
const sched = [
  { game_id: "g1", date: "2026-10-21", week: 1, status: "", home: { team: "TOR" }, away: { team: "CHI" } },
  { game_id: "g2", date: "2026-10-21", week: 1, status: "", home: { team: "MEM" }, away: { team: "UTA" } },
  { game_id: "g3", date: "2026-10-23", week: 1, status: "", home: { team: "TOR" }, away: { team: "MEM" } },
  { game_id: "g4", date: "2026-10-23", week: 1, status: "", home: { team: "UTA" }, away: { team: "CHI" } },
];
const projOf: Record<string, number> = { "1": 25, "2": 12, "3": 22, "4": 34, "5": 24, "6": 20 };
const proj = Object.entries(P).flatMap(([id, [, t]]) => sched.filter((g) => [g.home.team, g.away.team].includes(t)).map((g) => ({ player_id: id, date: g.date, team: t, opponent: "X", game_id: g.game_id, stats: { pts: projOf[id], sp: 1800 } })));
// live stats tonight (CHI @ TOR, 17 minutes played): Wilson a normal game, Miller fouled out, Murray-Boyles hurt and ruled out
const stats = [
  { player_id: "1", date: "2026-10-21", team: "CHI", opponent: "TOR", game_id: "g1", stats: { pts: 7, reb: 3, sp: 600, pf: 1 } },
  { player_id: "2", date: "2026-10-21", team: "CHI", opponent: "TOR", game_id: "g1", stats: { pts: 4, reb: 2, sp: 540, pf: 6 } },
  { player_id: "3", date: "2026-10-21", team: "TOR", opponent: "CHI", game_id: "g1", stats: { pts: 2, reb: 1, sp: 300, pf: 0 } },
];
const ev = (id: string, date: string, home: string, away: string, state: string, x: any = {}) => ({ id, date, season: { type: 2 }, status: { ...x, type: { state, shortDetail: "" } }, competitions: [{ competitors: [{ score: "0", team: { abbreviation: home } }, { score: "0", team: { abbreviation: away } }] }] });
const summary = { boxscore: { players: [
  { team: { abbreviation: "TOR" }, statistics: [{ keys: ["minutes", "points", "fouls"], athletes: [{ athlete: { displayName: "Collin Murray-Boyles" }, active: false, ejected: false, stats: ["5", "2", "0"] }] }] },
  { team: { abbreviation: "CHI" }, statistics: [{ keys: ["minutes", "points", "fouls"], athletes: [{ athlete: { displayName: "Caleb Wilson" }, active: true, ejected: false, stats: ["10", "7", "1"] }, { athlete: { displayName: "Leonard Miller" }, active: false, ejected: false, stats: ["9", "4", "6"] }] }] }] }, injuries: [] };
// lineup: Murray-Boyles C, Miller UTIL 1, Wilson UTIL 2 (all in the game in progress); Guard One PG, Guard Two SG; Big Center
// (C only, proj 34) on the bench and tipping at 9:00 PM - he needs C or a UTIL
const STARTERS = ["5", "6", "0", "0", "0", "0", "3", "2", "1"];
let summaryCalls = 0;
function stub(url: string): unknown {
  const u = new URL(url);
  if (u.host.includes("espn")) {
    if (u.pathname.endsWith("/scoreboard")) {
      const d = u.searchParams.get("dates");
      if (d === "20261021") return { events: [ev("e1", "2026-10-21T23:30Z", "TOR", "CHI", "in", { period: 2, clock: 300 }), ev("e2", "2026-10-22T01:00Z", "MEM", "UTA", "pre")] };
      if (d === "20261023") return { events: [ev("e3", "2026-10-23T23:30Z", "TOR", "MEM", "pre"), ev("e4", "2026-10-24T00:00Z", "UTA", "CHI", "pre")] };
      return { events: [] };
    }
    if (u.pathname.endsWith("/summary") && u.searchParams.get("event") === "e1") { summaryCalls++; return summary; }
    throw new Error("unstubbed " + url); // (rosters: fail-safe, unchanged)
  }
  const p = u.pathname;
  if (p === `/v1/league/${L}`) return { league_id: L, name: "t", season: "2026", status: "in_season", roster_positions: [...NAMES, "BN", "BN"], scoring_settings: SCORING, settings: {}, total_rosters: 2 };
  if (p === `/v1/league/${L}/users`) return [{ user_id: "u1", display_name: "me" }];
  if (p === `/v1/league/${L}/rosters`) return [{ roster_id: 1, owner_id: "u1", players: Object.keys(P), starters: STARTERS, reserve: [], taxi: [] }];
  if (p.startsWith(`/v1/league/${L}/matchups/`)) return [{ roster_id: 1, matchup_id: 1, starters: STARTERS, starters_points: STARTERS.map(() => 0), players: Object.keys(P), players_points: {}, points: 0 }];
  if (p.startsWith(`/v1/league/${L}/transactions/`)) return [];
  if (p === "/v1/players/nba") return players;
  if (p === "/schedule/nba/regular/2026") return sched;
  if (p.startsWith("/projections/nba/2026/")) return p.endsWith("/1") ? proj : [];
  if (p.startsWith("/stats/nba/2026/1")) return stats;
  if (p.startsWith("/stats/nba/")) return [];
  if (p.startsWith("/v1/projections/nba/regular/")) return {};
  if (p === "/v1/state/nba") return { week: 1, season: "2026" };
  throw new Error("unstubbed " + url);
}
globalThis.fetch = (async (url: string) => ({ ok: true, status: 200, json: async () => stub(String(url)) })) as any;

test("buildWeek: in-game estimates for a game in progress (normal, fouled out, ruled out mid-game)", async () => {
  const ctx = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  const T = ctx.me; const g = (pid: string) => T.games.find((x) => x.pid === pid && x.date === "2026-10-21")!;
  assert.ok(summaryCalls > 0, "ESPN summary of the game in progress fetched");
  const w = g("1"), m = g("2"), c = g("3");
  // Wilson: 10 pts in 10 min, 19 of 48 game minutes gone
  assert.equal(w.inGame!.pts, 9); assert.equal(w.inGame!.min, 10); assert.equal(w.inGame!.elapsed, 19); assert.equal(w.inGame!.out, null);
  assert.ok(w.inGame!.mu > 15 && w.inGame!.mu < 30, String(w.inGame!.mu)); assert.equal(w.mu, w.inGame!.mu); assert.equal(w.sd, w.inGame!.sd);
  assert.equal(m.inGame!.out, "fouled out"); assert.equal(m.mu, 0); // 4 + 2 - 6 fouls
  assert.match(c.inGame!.out!, /ruled out .*Sleeper: Out/); assert.equal(c.mu, 3); assert.equal(c.sd, 0.05);
  assert.equal(c.dnp, undefined, "(he has stats: not the task-T dnp case)");
  for (const x of [w, m, c]) { const eg = T.tw.games[x.gi]; assert.equal(eg.pPlay, 1); assert.deepEqual(eg.live, { pts: x.inGame!.pts }); assert.equal(eg.mu, x.mu); }
  // the next games are untouched
  const later = T.tw.games.filter((x) => x.tip > ASOF); assert.ok(later.every((x) => x.pPlay === undefined && x.live === undefined));
  // pinned in their slots (in a game)
  for (const pid of ["1", "2", "3"]) { const i = T.pids.indexOf(pid); assert.ok(T.st.inGame[i] >= 0); }
});

test("advice: bench the fouled-out player now for the 9:00 PM center; card, reminder; option off = old model", async () => {
  const ctx = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  const a = await computeAdvice(ctx, 30, new Float64Array([0]), null);
  const mg = a.plan[0].midgame!;
  assert.ok(mg?.length >= 2, "evaluated the players in the game in progress");
  const bench = mg.filter((x) => x.recommended === "BENCH_NOW");
  assert.equal(bench.length, 1); assert.equal(bench[0].player, "Leonard Miller", JSON.stringify(mg.map((x) => [x.player, x.gain, x.se])));
  assert.deepEqual(bench[0].for, ["Big Center"]); assert.ok(bench[0].gain > 3, `gain ${bench[0].gain} ± ${bench[0].se}`);
  assert.match(bench[0].text, /^Bench Leonard Miller now - forfeits his 0\.0 so far \(fouled out\); frees UTIL 1 for Big Center at 9:00 PM, \+\d+\.\d exp pts$/);
  assert.ok(a.plan[0].starts.some((s) => s.player === "Big Center"));
  assert.ok(a.actions.some((x) => /^Bench Leonard Miller now/.test(x)));
  const d = a.doNow!;
  assert.deepEqual(d.forfeits!.map((f) => f.player), ["Leonard Miller"]);
  assert.ok(d.changes.some((c) => /^Bench Leonard Miller now \(in his game - forfeits his 0\.0 so far, fouled out; frees UTIL 1 for Big Center/.test(c)), d.changes.join(" | "));
  assert.ok(d.changes.some((c) => /Big Center/.test(c) && /UTIL 1|C\b/.test(c)), d.changes.join(" | "));
  assert.doesNotMatch(doNowText(d), /Leonard Miller: lock him if/);
  const msg = messages(a, ASOF).find((x) => x.key.startsWith("forfeit|2|"));
  assert.ok(msg); assert.match(msg!.title, /^⚠️ BENCH Leonard Miller NOW \(forfeits his 0\.0\) → Big Center in UTIL 1$/);
  // the option off: no in-game estimate, no mid-game check
  process.env.LOCKIN_MIDGAME_FORFEIT = "0"; resetOptionCache();
  try {
    const ctx2 = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
    assert.ok(ctx2.me.games.every((x) => !x.inGame)); assert.ok(ctx2.me.tw.games.every((x) => x.pPlay === undefined && !x.live));
    const a2 = await computeAdvice(ctx2, 30, new Float64Array([0]), null);
    assert.equal(a2.plan[0].midgame, undefined); assert.equal(a2.doNow!.forfeits, undefined);
  } finally { delete process.env.LOCKIN_MIDGAME_FORFEIT; resetOptionCache(); }
});
