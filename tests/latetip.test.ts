// Task T (live bugs, Wed Oct 21): (1) a game whose scheduled tip has passed but is still "pre" (late tip / delay) keeps
// its players in the plan - they start at max(scheduled, now), are never "no game today", and the card's next tip-off is
// that game; (2) an Out player whose team's game is in progress scores 0, is stuck in his slot until it ends, gets no
// "lock if" cut-off, and holds nothing afterwards. Pure helpers, the card (lib/live/donow.ts), and buildWeek + the
// advice on a stubbed Sleeper + ESPN backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "latetip-cfg-"));
process.env.LOCKIN_CONFIG_DIR = CFG; delete process.env.LOCKIN_CACHE_DIR; delete process.env.LOCKIN_MINUTES_OVERRIDE;
process.env.LOCKIN_ENGINE = "p7h"; process.env.LOCKIN_NO_WORKERS = "1"; process.env.LOCKIN_ROSTER_CHECK = "0"; process.env.LOCKIN_CUTOFF_SIMS = "400"; // (fast)
import { buildWeek, lateTip, expectedEnd, outInGame, LATE_GAME_LEN } from "../lib/live/week";
import { computeAdvice } from "../lib/live/advise";
import { doNow, doNowText } from "../lib/live/donow";

const ET = (h: number, m = 0) => Date.parse("2026-10-21T00:00:00Z") + ((h + 4) * 60 + m) * 60e3; // Wed Oct 21 ET (EDT)
const MIN = 60e3;

test("lateTip / expectedEnd / outInGame", () => {
  // 7:30 game not tipped at 7:40: tips at the next 5-min mark after now (7:45), not merged with the 8:00 group
  assert.equal(lateTip(ET(19, 30), ET(19, 40), [ET(20)]), ET(19, 45));
  assert.equal(lateTip(ET(19, 30), ET(19, 42), [ET(20)]), ET(19, 45));
  assert.equal(lateTip(ET(19, 30), ET(19, 56), [ET(20)]), ET(19, 59)); // (1 min before the next group)
  assert.equal(lateTip(ET(19, 30), ET(19, 59) + 30e3, [ET(20)]), ET(20)); // (too close: same group)
  assert.equal(lateTip(ET(19, 30), ET(19, 40), []), ET(19, 45));
  // a late tip ends ~2h15 after its expected tip (at least scheduled + 2.5 h)
  assert.equal(expectedEnd({ status: "pre", tip: ET(20, 5), sched: ET(19, 30) }, ET(20)), ET(20, 5) + LATE_GAME_LEN);
  assert.equal(expectedEnd({ status: "pre", tip: ET(19, 45), sched: ET(19, 30) }, ET(19, 40)), ET(22));
  assert.equal(expectedEnd({ status: "pre", tip: ET(22) }, ET(19)), ET(22) + 150 * MIN);
  // in progress: from the clock (Q2 11:40 at 7:49 PM -> 2140 clock s x 2.5 + 15 min halftime -> 9:33:10, to the minute up)
  assert.equal(expectedEnd({ status: "in", tip: ET(19), period: 2, clock: 700 }, ET(19, 49)), ET(21, 34));
  assert.equal(expectedEnd({ status: "in", tip: ET(19), period: 4, clock: 30 }, ET(21, 40)), ET(21, 45)); // (>= 5 min)
  assert.equal(expectedEnd({ status: "in", tip: ET(19) }, ET(19, 49)), ET(21, 30)); // (no clock: scheduled + 2.5 h)
  assert.equal(outInGame("Out", null), true); assert.equal(outInGame("Out", { pts: 0 }), true);
  assert.equal(outInGame("Out", { gp: 1, pts: 4 }), false); assert.equal(outInGame("Questionable", null), false); assert.equal(outInGame(null, null), false);
});

// ---- the card, pure ----
const NAMES = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
type Sl = { pid?: string; state?: string; points?: number | null; gameEnd?: number; lockIf?: number | null; injury?: string | null; dnp?: boolean; team?: string };
const slots = (m: Record<number, Sl>) => NAMES.map((slot, i) => {
  const x = m[i]; if (!x) return { slot, player: null, pid: null, locked: false, points: null, source: null, state: "empty" };
  return { slot, player: x.pid!, pid: x.pid!, locked: false, points: x.points ?? null, source: null, state: x.state ?? "idle", injury: x.injury ?? null, ...(x.gameEnd ? { gameEnd: x.gameEnd, lockIf: x.lockIf ?? null } : {}), ...(x.dnp ? { dnp: true, team: x.team } : {}) };
});
const when = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(t);
const tp = (tip: number, p: any = {}) => ({ tip, when: p.late ? `${when(p.late)} (late tip - not tipped yet)` : when(tip), starts: [], benched: [], tentative: false, holds: [], forfeits: [], locks: [], playing: [], ...p });
const st = (slot: string, pid: string, tip: number, proj: number, lockIf: number | null, opp = "TOR") => ({ slot, player: pid, pid, proj, lockIf, opp, end: tip + 135 * MIN });
const game = (tip: number, status = "pre", x: any = {}) => ({ date: "2026-10-21", opp: "X", tip, status, proj: 20, actual: null, ...x });
const pl = (pid: string, pos: string, games: any[], injury: string | null = null) => ({ pid, name: pid, pos, injury, games });
const row = (d: ReturnType<typeof doNow>, slot: string) => d.rows.find((r) => r.slot === slot)!;

test("card: a late 7:30 tip is the next tip-off; its players stay in, never 'no game today'", () => {
  const late = ET(19, 30), exp = ET(19, 45);
  const d = doNow({
    asOf: ET(19, 40), decisions: [],
    me: { slots: slots({ 3: { pid: "Wilson" }, 4: { pid: "Murray-Boyles" }, 7: { pid: "Miller" }, 1: { pid: "Ivey" } }) as any,
      players: [pl("Wilson", "SF/PF", [game(exp, "pre", { late })]), pl("Murray-Boyles", "PF/C", [game(exp, "pre", { late })]), pl("Miller", "SF/PF", [game(exp, "pre", { late })]),
        pl("Ivey", "PG/SG", [game(ET(20))]), pl("Jackson", "PF/C", [game(ET(20))]), pl("Rested", "SG", [{ ...game(ET(19)), date: "2026-10-23", tip: ET(19) + 2 * 86400e3 }])] },
    plan: [tp(exp, { late, starts: [st("SF", "Wilson", exp, 22, 30), st("PF", "Murray-Boyles", exp, 18, 25), st("UTIL 1", "Miller", exp, 14, 20)] }),
      tp(ET(20), { tentative: true, starts: [st("SG", "Ivey", ET(20), 28, 35), st("C", "Jackson", ET(20), 30, 36)] })] as any,
  });
  const txt = doNowText(d);
  assert.doesNotMatch(txt, /no game today/); assert.doesNotMatch(txt, /no game at/);
  assert.equal(d.tip, exp); assert.match(txt, /before the Wed 7:30 PM \(late tip - not tipped yet\) tip-off/);
  for (const [s, p] of [["SF", "Wilson"], ["PF", "Murray-Boyles"], ["UTIL 1", "Miller"]]) {
    assert.equal(row(d, s).player, p); assert.equal(row(d, s).change, null); assert.match(row(d, s).status, /^plays 7:30 PM \(late tip\) vs TOR/);
  }
  assert.match(row(d, "C").status, /plays 8:00 PM/); // Jackson set now (slot unused before)
  assert.ok(!d.changes.some((c) => /bench (Wilson|Murray-Boyles|Miller)/i.test(c)));
});

test("card: 'no game today' only when he has no game that date; a game later today / earlier today is said so", () => {
  const d = doNow({
    asOf: ET(18), decisions: [],
    me: { slots: slots({ 6: { pid: "Later" }, 8: { pid: "Done" }, 3: { pid: "Rested" } }) as any,
      players: [pl("Later", "C", [game(ET(22))]), pl("Done", "C", [{ ...game(ET(13)), status: "post", actual: 10 }]), pl("Rested", "SF", [{ ...game(ET(19)), date: "2026-10-23", tip: ET(19) + 2 * 86400e3 }]),
        pl("Big1", "C", [game(ET(19))]), pl("Big2", "C", [game(ET(19))]), pl("Wing", "SF", [game(ET(19))])] },
    plan: [tp(ET(19), { starts: [st("C", "Big1", ET(19), 30, 35), st("UTIL 2", "Big2", ET(19), 29, 34), st("SF", "Wing", ET(19), 25, 30)] }),
      tp(ET(22), { tentative: true, starts: [st("UTIL 1", "Later", ET(22), 20, 25)] })] as any,
  });
  const ch = d.changes.join(" | ");
  assert.match(ch, /Bench Later \(next game 10:00 PM\)/);
  assert.equal(row(d, "UTIL 2").player, "Done"); assert.equal(row(d, "UTIL 2").status, "his game today is over - can stay");
  assert.match(ch, /Bench Rested \(no game today\)/);
});

test("card: Out player stuck in a game in progress - scores 0, no lock cut-off, his slot frees at the end", () => {
  const end = ET(21, 30);
  const d = doNow({
    asOf: ET(19, 44), decisions: [],
    me: { slots: slots({ 0: { pid: "Black", state: "playing", gameEnd: end, lockIf: 23.2, injury: "Out", dnp: true, team: "ATL" }, 2: { pid: "L1", state: "locked", points: 20 }, 7: { pid: "L2", state: "locked", points: 20 }, 8: { pid: "L3", state: "locked", points: 20 } }) as any,
      players: [pl("Black", "PG/SG", [game(ET(19), "in", { dnp: true })], "Out"), pl("Garland", "PG", [game(ET(22))]), pl("L1", "PG", []), pl("L2", "C", []), pl("L3", "C", [])] },
    plan: [tp(ET(22), { starts: [st("PG", "Garland", ET(22), 25, 24)], playing: [] })] as any,
  });
  assert.equal(row(d, "PG").status, "Out - scores 0; stuck in this slot until the ATL game ends ~9:30 PM (Sleeper locks him at tip)");
  const txt = doNowText(d);
  assert.doesNotMatch(row(d, "PG").status, /lock if/i); assert.doesNotMatch(txt, /Black: lock him if/); assert.doesNotMatch(txt, /LOCK Black/);
  assert.equal(row(d, "PG").later, "~9:30 PM: put Garland in PG");
});

// ---- buildWeek + advice on a stubbed backend (7:40 PM: ATL @ ORL in Q2, CHI @ TOR 7:30 not tipped, UTA @ MEM 8:00) ----
const L = "LT1", ASOF = ET(19, 40);
const SCORING = { pts: 1, reb: 1, ast: 1 };
const P: Record<string, [string, string, string[], string | null]> = { // pid: name, team, positions, injury
  "1": ["Anthony Black", "ORL", ["PG", "SG"], "Out"], "2": ["Caleb Wilson", "CHI", ["SF", "PF"], null], "3": ["Collin Murray-Boyles", "TOR", ["PF", "C"], null],
  "4": ["Leonard Miller", "CHI", ["SF", "PF"], null], "5": ["Jaden Ivey", "MEM", ["PG", "SG"], null], "6": ["Jaren Jackson", "MEM", ["PF", "C"], null],
  "7": ["Bench Guard", "MEM", ["SG"], null],
};
const players = Object.fromEntries(Object.entries(P).map(([id, [n, t, pos, inj]]) => [id, { player_id: id, full_name: n, team: t, fantasy_positions: pos, injury_status: inj }]));
const sched = [
  { game_id: "g1", date: "2026-10-21", week: 1, status: "", home: { team: "ORL" }, away: { team: "ATL" } },
  { game_id: "g2", date: "2026-10-21", week: 1, status: "", home: { team: "TOR" }, away: { team: "CHI" } },
  { game_id: "g3", date: "2026-10-21", week: 1, status: "", home: { team: "MEM" }, away: { team: "UTA" } },
  { game_id: "g4", date: "2026-10-23", week: 1, status: "", home: { team: "ORL" }, away: { team: "CHI" } },
  { game_id: "g5", date: "2026-10-23", week: 1, status: "", home: { team: "MEM" }, away: { team: "TOR" } },
];
const proj = Object.entries(P).flatMap(([id, [, t]]) => sched.filter((g) => [g.home.team, g.away.team].includes(t)).map((g) => ({ player_id: id, date: g.date, team: t, opponent: "X", game_id: g.game_id, stats: { pts: 20 + Number(id), sp: 1800 } })));
const ev = (date: string, home: string, away: string, state: string, x: any = {}) => ({ id: `${home}${date}`, date, season: { type: 2 }, status: { ...x, type: { state, shortDetail: "" } }, competitions: [{ competitors: [{ score: "0", team: { abbreviation: home } }, { score: "0", team: { abbreviation: away } }] }] });
const STARTERS = ["1", "0", "0", "2", "3", "0", "0", "4", "0"]; // Black PG (in his game), Wilson SF, Murray-Boyles PF, Miller UTIL
function stub(url: string): unknown {
  const u = new URL(url);
  if (u.host.includes("espn")) {
    if (u.pathname.endsWith("/scoreboard")) {
      const d = u.searchParams.get("dates");
      if (d === "20261021") return { events: [ev("2026-10-21T23:00Z", "ORL", "ATL", "in", { period: 2, clock: 700 }), ev("2026-10-21T23:30Z", "TOR", "CHI", "pre"), ev("2026-10-22T00:00Z", "MEM", "UTA", "pre")] };
      if (d === "20261023") return { events: [ev("2026-10-23T23:00Z", "ORL", "CHI", "pre"), ev("2026-10-23T23:30Z", "MEM", "TOR", "pre")] };
      return { events: [] };
    }
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
  if (p.startsWith("/stats/nba/")) return [];
  if (p.startsWith("/v1/projections/nba/regular/")) return {};
  if (p === "/v1/state/nba") return { week: 1, season: "2026" };
  throw new Error("unstubbed " + url);
}
globalThis.fetch = (async (url: string) => ({ ok: true, status: 200, json: async () => stub(String(url)) })) as any;

test("buildWeek + advice: late CHI @ TOR players planned at the expected tip; Out Black in ATL @ ORL scores 0", async () => {
  const ctx = await buildWeek({ leagueId: L, rosterId: 1, week: 1, asOf: ASOF, skipOpp: true });
  const T = ctx.me; const g = (pid: string, date = "2026-10-21") => T.games.find((x) => x.pid === pid && x.date === date)!;
  for (const pid of ["2", "3", "4"]) {
    assert.equal(g(pid).status, "pre"); assert.equal(g(pid).late, ET(19, 30)); assert.equal(g(pid).tip, ET(19, 45)); assert.equal(g(pid).end, ET(22));
  }
  assert.equal(g("5").tip, ET(20)); assert.equal(g("5").late, undefined);
  const b = g("1"); const bi = T.pids.indexOf("1");
  assert.equal(b.status, "in"); assert.equal(b.dnp, true); assert.equal(b.end, ET(21, 25)); // (Q2 11:40 at 7:40 PM)
  assert.equal(T.tw.nextGameIdx![bi], b.gi); assert.equal(T.tw.pNext![bi], 0);
  assert.equal(T.st.inGame[bi], b.gi); // pinned in his slot until the game ends

  const a = await computeAdvice(ctx, 20, new Float64Array([0]), null);
  assert.equal(a.plan[0].tip, ET(19, 45)); assert.equal(a.plan[0].late, ET(19, 30)); assert.match(a.plan[0].when, /7:30 PM \(late tip/);
  const starts0 = a.plan[0].starts.map((s) => s.pid).sort();
  assert.deepEqual(starts0, ["2", "3", "4"]);
  const bs = a.me.slots.find((s) => s.pid === "1")!;
  assert.equal(bs.state, "playing"); assert.equal(bs.dnp, true); assert.equal(bs.lockIf, null); assert.equal(bs.team, "ORL");
  // after his game he holds nothing: never in a later tip-off's holds
  assert.ok(a.plan.every((pl) => !pl.holds.some((h) => h.pid === "1")));
  const d = a.doNow!; const txt = doNowText(d);
  assert.doesNotMatch(txt, /no game today/); assert.doesNotMatch(txt, /Anthony Black: lock him if/); assert.doesNotMatch(txt, /Bench (Caleb Wilson|Collin Murray-Boyles|Leonard Miller)/);
  assert.match(d.rows.find((r) => r.pid === "1")!.status, /^Out - scores 0; stuck in this slot until the ORL game ends ~9:25 PM/);
  assert.equal(d.tip, ET(19, 45));
});
