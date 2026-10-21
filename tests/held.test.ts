// Held vs locked (task "held vs locked", lib/live/week.ts inferSlot): Sleeper has no lock flag, so a slot's score is
// read as HELD (finished game, next game not tipped) unless there is evidence of a lock; in-progress games stay in
// play; lock toggles override; both teams. Plus the plan's honest display of players ruled Out (advise.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "held-cfg-"));
process.env.LOCKIN_CONFIG_DIR = CFG; delete process.env.LOCKIN_CACHE_DIR; process.env.LOCKIN_NO_WORKERS = "1";
process.env.LOCKIN_ROSTER_CHECK = "0"; delete process.env.LOCKIN_ENGINE;
import { buildWeek, inferSlot, type SlotGame } from "../lib/live/week";
import { computeAdvice } from "../lib/live/advise";

const G = (tip: number, status: SlotGame["status"], actual: number | null, livePts?: number | null): SlotGame => ({ gi: tip, tip, status, actual, livePts });

test("inferSlot: held / locked / in game / overrides and edge cases", () => {
  const inf = (pts: number, games: SlotGame[], override?: string | null) => inferSlot({ pts, pid: "p", override, overridePts: override ? 33 : null, games });
  // finished, next game not tipped -> held (the engine decides)
  assert.deepEqual(inf(15.5, [G(1, "post", 15.5), G(2, "pre", null)]), { kind: "held", pts: 15.5, gi: 1, deadline: 2, why: "finished, next game not tipped" });
  // a later game finished, slot still shows the earlier score -> locked
  assert.equal(inf(20, [G(1, "post", 20), G(2, "post", 8), G(3, "pre", null)]).kind, "locked");
  assert.equal((inf(20, [G(1, "post", 20), G(2, "post", 8), G(3, "pre", null)]) as any).source, "sleeper");
  // later game live, slot still shows the earlier score (live points differ / unknown) -> locked; live points shown -> in game
  assert.equal(inf(20, [G(1, "post", 20), G(2, "in", null, 6)]).kind, "locked");
  assert.equal(inf(20, [G(1, "post", 20), G(2, "in", null, null)]).kind, "locked");
  assert.equal(inf(6, [G(1, "post", 20), G(2, "in", null, 6)]).kind, "inGame");
  assert.equal(inf(0, [G(1, "post", 20), G(2, "in", null, 0)]).kind, "inGame");
  assert.equal(inf(20, [G(1, "post", 20), G(2, "in", null, 20)]).kind, "inGame"); // same score live: not evidence
  // no game left -> held == final -> locked ("final"); a 0 never locks
  assert.deepEqual(inf(9, [G(1, "post", 9)]), { kind: "locked", pts: 9, source: "final", why: "no game left: the held score is final" });
  assert.equal(inf(0, [G(1, "post", 0)]).kind, "held");
  assert.equal(inf(0, [G(1, "post", 0), G(2, "pre", null)]).kind, "held");
  // 0 on the slot after a nonzero game: he wasn't started for it -> holds nothing
  assert.equal(inf(0, [G(1, "post", 12), G(2, "pre", null)]).kind, "idle");
  // same score as an earlier game: the reversible reading (held), flagged
  const same = inf(10, [G(1, "post", 10), G(2, "post", 10), G(3, "pre", null)]);
  assert.equal(same.kind, "held"); assert.equal(same.note, true);
  // unmatched score (stat correction) -> held at Sleeper's number, flagged
  const um = inf(14, [G(1, "post", 13.5), G(2, "pre", null)]);
  assert.equal(um.kind, "held"); assert.equal((um as any).pts, 14); assert.equal(um.note, true);
  // no game played yet
  assert.equal(inf(0, [G(2, "pre", null)]).kind, "idle");
  // overrides: lock wins (at players_points), unlock means evidence never locks
  assert.deepEqual(inf(15.5, [G(1, "post", 15.5), G(2, "pre", null)], "p"), { kind: "locked", pts: 33, source: "override", why: "marked locked by you" });
  assert.equal(inf(20, [G(1, "post", 20), G(2, "post", 8), G(3, "pre", null)], null).kind, "held");
  assert.equal(inf(9, [G(1, "post", 9)], null).kind, "held");
  assert.equal(inf(20, [G(1, "post", 20), G(2, "in", null, 6)], null).kind, "inGame");
});

// ---- stubbed Sleeper + ESPN: week 1, Wed Oct 21 2026 noon ET ----
const L = "LH", ASOF = Date.parse("2026-10-21T16:00:00Z");
const players: Record<string, any> = {
  "1": { player_id: "1", full_name: "Held Guard", team: "AAA", fantasy_positions: ["PG"], injury_status: null },
  "2": { player_id: "2", full_name: "Locked Guard", team: "AAA", fantasy_positions: ["SG"], injury_status: null },
  "3": { player_id: "3", full_name: "Live Wing", team: "BBB", fantasy_positions: ["SF"], injury_status: null },
  "4": { player_id: "4", full_name: "Final Center", team: "CCC", fantasy_positions: ["C"], injury_status: null },
  "5": { player_id: "5", full_name: "Out Guard", team: "DDD", fantasy_positions: ["PG"], injury_status: "Out" },
  "11": { player_id: "11", full_name: "Opp Forward", team: "AAA", fantasy_positions: ["PF"], injury_status: null },
};
const games = [ // date, home, away, tip (UTC), ESPN state at ASOF
  ["2026-10-18", "AAA", "ZZZ", "23:30", "post"], ["2026-10-19", "BBB", "YYY", "23:30", "post"], ["2026-10-20", "AAA", "CCC", "23:30", "post"],
  ["2026-10-21", "BBB", "EEE", "15:00", "in"], ["2026-10-21", "DDD", "FFF", "23:00", "pre"], ["2026-10-22", "AAA", "ZZZ", "23:30", "pre"],
  ["2026-10-23", "DDD", "YYY", "23:30", "pre"], ["2026-10-23", "BBB", "ZZZ", "23:30", "pre"],
];
const stat = (pid: string, date: string, team: string, pts: number) => ({ player_id: pid, date, team, opponent: "", game_id: "", stats: { pts, gp: 1 } });
const stats = [stat("1", "2026-10-18", "AAA", 10), stat("1", "2026-10-20", "AAA", 15), stat("2", "2026-10-18", "AAA", 20), stat("2", "2026-10-20", "AAA", 8),
  stat("3", "2026-10-19", "BBB", 12), stat("3", "2026-10-21", "BBB", 4), stat("4", "2026-10-20", "CCC", 9), stat("11", "2026-10-20", "AAA", 46.5), stat("11", "2026-10-18", "AAA", 30)];
const proj = games.filter((g) => g[4] === "pre").flatMap(([d, h, a]) => Object.values(players).filter((p) => p.team === h || p.team === a).map((p) => ({ player_id: p.player_id, date: d, team: p.team, opponent: "", game_id: "", stats: { pts: 20 } })));
let starters1 = ["1", "2", "5", "3", "0", "0", "4", "0", "0"], points1 = [15, 20, 0, 4, 0, 0, 9, 0, 0];
function stub(url: string): unknown {
  const u = new URL(url);
  if (u.host.includes("espn")) {
    if (u.pathname.endsWith("/scoreboard")) {
      const d8 = u.searchParams.get("dates")!; const d = `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6)}`;
      return { events: games.filter((g) => g[0] === d).map(([dd, h, a, t, s]) => ({ id: `e${dd}${h}`, date: `${dd}T${t}Z`, season: { type: 2 }, status: { type: { state: s, shortDetail: "" } }, competitions: [{ competitors: [{ score: "0", team: { abbreviation: h } }, { score: "0", team: { abbreviation: a } }] }] })) };
    }
    return {};
  }
  const p = u.pathname;
  if (p === `/v1/league/${L}`) return { league_id: L, name: "t", season: "2026", status: "in_season", roster_positions: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL", "BN", "BN"], scoring_settings: { pts: 1 }, settings: {}, total_rosters: 2 };
  if (p === `/v1/league/${L}/users`) return [{ user_id: "u1", display_name: "me" }, { user_id: "u2", display_name: "them" }];
  if (p === `/v1/league/${L}/rosters`) return [{ roster_id: 1, owner_id: "u1", players: ["1", "2", "3", "4", "5"], starters: [], reserve: [], taxi: [] }, { roster_id: 2, owner_id: "u2", players: ["11"], starters: [], reserve: [], taxi: [] }];
  if (p.startsWith(`/v1/league/${L}/matchups/`)) return [
    { roster_id: 1, matchup_id: 1, starters: starters1, starters_points: points1, players: ["1", "2", "3", "4", "5"], players_points: { "1": 15, "2": 20, "3": 4, "4": 9 }, points: 48 },
    { roster_id: 2, matchup_id: 1, starters: ["0", "0", "0", "0", "11", "0", "0", "0", "0"], starters_points: [0, 0, 0, 0, 46.5, 0, 0, 0, 0], players: ["11"], players_points: { "11": 46.5 }, points: 46.5 }];
  if (p.startsWith(`/v1/league/${L}/transactions/`)) return [];
  if (p === "/v1/players/nba") return players;
  if (p === "/schedule/nba/regular/2026") return games.map(([d, h, a]) => ({ game_id: `s${d}${h}`, date: d, week: 1, status: "", home: { team: h }, away: { team: a } }));
  if (p.startsWith("/projections/nba/2026/")) return p.endsWith("/1") ? proj : [];
  if (p.startsWith("/stats/nba/2026/")) return p.endsWith("/1") ? stats : [];
  if (p.startsWith("/v1/projections/nba/regular/")) return {};
  if (p === "/v1/state/nba") return { week: 1, season: "2026" };
  throw new Error("unstubbed " + url);
}
globalThis.fetch = (async (url: string) => ({ ok: true, status: 200, json: async () => stub(String(url)) })) as any;

test("buildWeek live: held / locked / in game per slot, both teams; lock toggles", async () => {
  const ctx = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF });
  const me = ctx.me, ix = (pid: string) => me.pids.indexOf(pid);
  // Held Guard: finished Tue (15), next Thu -> held, slot open
  assert.equal(me.st.lockedBy[0], -1); assert.equal(me.st.pendingX[ix("1")], 15); assert.equal(me.st.isLocked[ix("1")], 0);
  // Locked Guard: Tue (8) finished after Sun (20) but the slot shows 20 -> locked
  assert.equal(me.st.lockedBy[1], ix("2")); assert.equal(me.st.lockedPts[1], 20); assert.equal(me.lockSource[1], "sleeper");
  // Live Wing: in progress (slot shows the live 4) -> in game, pinned
  assert.equal(me.st.lockedBy[3], -1); assert.equal(me.st.pinned[3], ix("3")); assert.ok(me.st.inGame[ix("3")] >= 0);
  // Final Center: no game left -> locked (final)
  assert.equal(me.st.lockedBy[6], ix("4")); assert.equal(me.lockSource[6], "final");
  // Out Guard: nothing yet
  assert.equal(me.st.lockedBy[2], -1); assert.ok(Number.isNaN(me.st.pendingX[ix("5")]));
  // opponent: 46.5 finished Tue, next game Thu -> held, not locked
  const op = ctx.opp!; assert.ok(op);
  assert.equal(op.st.lockedBy[4], -1); assert.equal(op.st.pendingX[op.pids.indexOf("11")], 46.5);

  // toggles: mark the held guard locked, mark the locked guard unlocked
  const t = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, lockOverrides: { 0: "1", 1: null } });
  assert.equal(t.me.st.lockedBy[0], t.me.pids.indexOf("1")); assert.equal(t.me.st.lockedPts[0], 15); assert.equal(t.me.lockSource[0], "override");
  assert.equal(t.me.st.lockedBy[1], -1); assert.equal(t.me.st.pendingX[t.me.pids.indexOf("2")], 20);
});

test("advice: held slots shown as held with their deadline; Out player labelled with his play probability", async () => {
  const ctx = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF });
  const a = await computeAdvice(ctx, 20, new Float64Array([100, 110]), new Float64Array([90, 95]));
  assert.equal(a.me.slots[0].state, "held"); assert.match(a.me.slots[0].stateText!, /^held \(decide by Thu/); assert.equal(a.me.slots[0].points, 15);
  assert.equal(a.me.slots[1].state, "locked"); assert.equal(a.me.slots[6].stateText, "locked (final game)");
  assert.equal(a.me.slots[3].state, "playing");
  assert.equal(a.opp!.slots[4].state, "held"); assert.equal(a.opp!.slots[4].points, 46.5);
  // the held guard gets a hold / lock / bench decision; nothing else does
  assert.deepEqual(a.decisions.map((d) => d.player), ["Held Guard"]);
  // the Out guard's Wed game: labelled wherever the plan puts him; as a start only as a free roll
  const wed = a.plan.find((p) => p.when.startsWith("Wed"))!; assert.ok(wed, "Wed 7:00 PM tip-off planned");
  const st = wed.starts.find((s) => s.player === "Out Guard"); const bn = wed.benched.find((b) => b.player === "Out Guard");
  const x = st ?? bn; assert.ok(x, "Out Guard is in the Wed plan");
  assert.equal(x!.playProb, 0.03); assert.equal(x!.expected, 0.6); assert.match(x!.label!, /^Out - 3% to play \(exp 0\.6\)/);
  if (st) assert.match(st.label!, /free roll/);
  // the median path doesn't pretend he played: he holds nothing afterwards
  assert.ok(a.plan.every((p) => !p.holds.some((h) => h.player === "Out Guard")));
});
