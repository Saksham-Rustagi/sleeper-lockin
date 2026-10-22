// Task T3: the mid-game forfeit option (lib/engine/midgame.ts) and the in-game final-score estimate (lib/live/ingame.ts).
//  - estimator / out-for-the-game reasons / ESPN live parsing
//  - forfeitGame semantics; without in-game information the wrapped hooks are exactly the engine's (identity)
//  - synthetic scenarios: injured early -> bench now; late slot crunch -> bench now; a normal game -> never; a gain that only
//    comes at a later tip-off -> deferred; P8 and POLICY (p7h) engines
//  - monotonicity: the option never lowers expected points (fresh scenarios, independent of the decision's own)
//  - the Do-now card and the notifier
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildSync } from "esbuild";
import { p10Hooks, type RacePool } from "../lib/engine/p10";
import { createRacePool } from "../lib/live/racepool";
import * as E from "../lib/engine/core";
import { midgameHooks, forfeitCandidates, type MidgameResult } from "../lib/engine/midgame";
import { inGameEstimate, gameMinutes, outReason, parseEspnLive } from "../lib/live/ingame";
import { doNow, doNowText } from "../lib/live/donow";
import { messages } from "../scripts/notify";

const H = 3600e3, T0 = Date.parse("2026-10-21T23:00:00Z");
type G = { tip: number; mu: number; sd?: number; actual?: number; live?: number };
function tw(slots: string[], players: { pos: string[]; games: G[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: g.sd ?? 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true,
    ...(g.live !== undefined ? { pPlay: 1, live: { pts: g.live } } : {}) })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const P8: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 300, weekIters: 20000 } };
const BASE: E.Policy = { ...P8, name: "base", index: { resolve: "never", weekIters: 20000, slot: "roll" } };
const POLICY: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true, legacyBugs: ["heldTie"] };
const real = (t: E.TeamWeek) => ({ actual: Float64Array.from(t.games.map((g) => g.actual)), played: Uint8Array.from(t.games.map(() => 1)) });
const QUICK = { kMax: 128, batch: 32 };

// the state at the tip-off at time tt with player x in his game (started at his tip in slot sx, still in progress)
// (extra: more players in a game in progress, [player, slot])
function stateAt(t: E.TeamWeek, x: number, sx: number, tt: number, extra: [number, number][] = []) {
  const ev = E.buildEvents(t, true); const st = E.initState(t);
  for (const [q, sq] of [[x, sx], ...extra]) {
    const gi = t.byPlayer[q].find((g) => t.games[g].tip < tt && t.games[g].end > tt)!;
    st.inGame[q] = gi; st.started[gi] = 1; st.pinned[sq] = q; st.pinnedUntil[sq] = t.games[gi].end; st.lastSlot[q] = sq;
  }
  const i = ev.findIndex((e) => e.kind === 2 && e.t === tt);
  return { ev, st, i };
}
// the mid-game decision at the group ev[i] (P8 engine, or POLICY): forfeited player (-1 none) and the evaluation
// (inner: the engine's hooks factory, e.g. P10b's race; pool: continuations on worker threads)
function decideAt(t: E.TeamWeek, x: number, sx: number, tt: number, pol: E.Policy = P8, seed = 5, extra: [number, number][] = [],
  inner?: (ev: E.Ev[]) => E.Hooks | undefined, pool: RacePool | null = null) {
  const { ev, st, i } = stateAt(t, x, sx, tt, extra);
  let res: MidgameResult | null = null;
  const mk = () => inner?.(ev);
  const h = midgameHooks(t, ev, mk(), { pol, base: pol.index ? BASE : POLICY, makeInner: mk, realised: real(t), seed, pool, opts: QUICK, onResult: (r) => { res = r; } });
  const s = E.cloneState(st);
  E.simulate(t, pol, ev, real(t).actual, real(t).played, s, i, h, tt);
  return { res: res as MidgameResult | null, after: s, st, ev, i };
}

test("in-game estimate: minutes, shrinkage, out for the game, overtime", () => {
  assert.deepEqual(gameMinutes(2, 0), { elapsed: 24, total: 48 });            // halftime
  assert.deepEqual(gameMinutes(1, 720), { elapsed: 0, total: 48 });
  assert.deepEqual(gameMinutes(5, 150), { elapsed: 50.5, total: 53 });        // 2:30 left in OT
  // halftime, 18 of 24 minutes, 16 pts; projected 32 min, pre-game mu 30 (0.94 / min)
  const a = inGameEstimate({ pts: 16, sec: 18 * 60, period: 2, clock: 0, preMu: 30, preSd: 12, projSec: 32 * 60 });
  // share (32/48*12 + 18) / 36 = 0.722 -> 17.3 more minutes; rate (0.9375*20 + 16) / 38 = 0.914
  assert.equal(a.remMin, 17.3); assert.equal(a.rate, 0.91); assert.equal(a.mu, 32); assert.equal(a.sd, 9);
  assert.ok(a.mu >= a.pts);
  // a cold first half shrinks toward the prior rate, not to zero
  const b = inGameEstimate({ pts: 0, sec: 15 * 60, period: 2, clock: 0, preMu: 30, preSd: 12, projSec: 32 * 60 });
  assert.ok(b.mu > 5 && b.mu < 16, String(b.mu));
  // out for the game: no remaining minutes, the final is what he has
  for (const o of [{ out: "ejected" }, { fouls: 6 }]) {
    const c = inGameEstimate({ pts: 7.5, sec: 20 * 60, period: 3, clock: 300, preMu: 30, preSd: 12, projSec: 32 * 60, ...o });
    assert.equal(c.mu, 7.5); assert.equal(c.sd, 0.05); assert.equal(c.remMin, 0); assert.ok(c.out);
  }
  // end of regulation: nothing left
  assert.equal(inGameEstimate({ pts: 20, sec: 30 * 60, period: 4, clock: 0, preMu: 30, preSd: 12, projSec: 32 * 60 }).mu, 20);
  // no projected minutes: from the pre-game mean (0.9 pts / min, 10..40 min)
  assert.ok(inGameEstimate({ pts: 10, sec: 10 * 60, period: 2, clock: 360, preMu: 27, preSd: 11 }).remMin > 0);
  // rounded to 0.5 (the cache key moves in steps)
  const k = inGameEstimate({ pts: 3.3, sec: 401, period: 1, clock: 100, preMu: 21.7, preSd: 10.4, projSec: 1700 });
  assert.equal(k.mu * 2, Math.round(k.mu * 2)); assert.equal(k.key, `${k.mu}|${k.sd}|0`);
});

test("out-for-the-game reasons and ESPN live parsing", () => {
  assert.equal(outReason({ ejected: true }), "ejected");
  assert.equal(outReason({ fouls: 6 }), "fouled out");
  assert.match(outReason({ tagOut: true, onCourt: null })!, /Sleeper: Out/);
  assert.equal(outReason({ tagOut: true, onCourt: true }), null, "on the court: the tag is stale");
  assert.match(outReason({ espnOutAfterTip: true })!, /ESPN/);
  assert.equal(outReason({ fouls: 5 }), null);
  const tip = Date.parse("2026-10-21T23:00Z");
  const j = { boxscore: { players: [{ team: { abbreviation: "GS" }, statistics: [{ keys: ["minutes", "points", "fouls"], athletes: [
    { athlete: { displayName: "A One" }, active: true, ejected: false, stats: ["20", "11", "2"] },
    { athlete: { displayName: "B Two" }, active: false, ejected: true, stats: ["8", "2", "3"] }] }] }] },
    injuries: [{ team: { abbreviation: "GS" }, injuries: [{ status: "Out", date: "2026-10-21T23:55Z", athlete: { displayName: "C Three" } }, { status: "Out", date: "2026-10-20T12:00Z", athlete: { displayName: "D Four" } }] }] };
  const p = parseEspnLive(j, tip);
  assert.deepEqual(p.players, [{ name: "A One", team: "GSW", onCourt: true, ejected: false, fouls: 2 }, { name: "B Two", team: "GSW", onCourt: false, ejected: true, fouls: 3 }]);
  assert.deepEqual(p.outAfterTip, [{ name: "C Three", team: "GSW" }], "only reports dated after the tip");
});

test("forfeitGame: slot free now, the game never counts, later games do", () => {
  // X (UTIL) tips at T0 (scores 40), and again tomorrow (scores 10); benched mid-game at T0+1h
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 40 }, { tip: T0 + 24 * H, mu: 10, actual: 10 }] }]);
  const { ev, st } = stateAt(t, 0, 0, T0 + 0.5 * H);
  const s = E.cloneState(st); E.forfeitGame(s, 0);
  assert.equal(s.pinned[0], -1); assert.equal(s.inGame[0], -1); assert.equal(s.started[t.byPlayer[0][0]], 1);
  const fromEv = ev.findIndex((e) => e.t > T0 + 0.5 * H);
  const kept = E.simulate(t, POLICY, ev, real(t).actual, real(t).played, E.cloneState(st), fromEv).total;
  const lost = E.simulate(t, POLICY, ev, real(t).actual, real(t).played, s, fromEv).total;
  assert.equal(kept, 40, "kept: his 40 is locked or counts"); assert.equal(lost, 10, "forfeited: only tomorrow's game");
});

test("no in-game information: the wrapped hooks are the engine's exactly (P8, POLICY, at every tip-off)", () => {
  const r = E.rng(9);
  for (let w = 0; w < 6; w++) {
    const pos = [["PG"], ["SG"], ["SF", "PF"], ["C"], ["PG", "SG"], ["PF", "C"], ["SF"]];
    const t = tw(["G", "F", "C", "UTIL"], pos.map((p) => ({ pos: p, games: [0, 1, 2].filter(() => r() < 0.7).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * 0.5 * H, mu: 10 + 25 * r(), actual: 30 * r() })) })));
    for (const pol of [P8, POLICY]) {
      const ev = E.buildEvents(t, true); const re = real(t);
      const a = E.simulate(t, pol, ev, re.actual, re.played, E.initState(t), 0);
      let calls = 0;
      const h = midgameHooks(t, ev, undefined, { pol, base: pol.index ? BASE : POLICY, makeInner: () => { calls++; return undefined; }, realised: re, seed: 1, opts: { first: false } });
      const b = E.simulate(t, pol, ev, re.actual, re.played, E.initState(t), 0, h);
      assert.equal(b.total, a.total); assert.deepEqual(b.st, a.st);
      assert.equal(calls, 0); assert.equal(h.midgame.checks, 0); assert.ok(h.midgame.groups > 0);
    }
  }
});

test("injured early: bench him now for the player tipping now (P8 and POLICY engines)", () => {
  // UTIL only. X (in UTIL since T0) left injured, out for the game with 2 pts; Y tips at T0+1h (proj 25), no other slot
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 2, sd: 0.05, live: 2 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 25 }] }]);
  for (const pol of [P8, POLICY]) {
    const { res, after } = decideAt(t, 0, 0, T0 + H, pol);
    assert.ok(res); const x = res!.evals.find((e) => e.p === 0)!;
    assert.equal(res!.pick, 0, `${pol.name}: forfeit (gain ${x.gain.toFixed(1)} ± ${x.se.toFixed(1)})`);
    assert.ok(x.pass && x.gain > 15, String(x.gain)); assert.deepEqual(x.starts, [1], "Y starts in the freed slot");
    assert.equal(after.pinned[0], 1, "Y is in UTIL"); assert.equal(after.inGame[0], -1);
  }
});

test("late slot crunch: a normal game gives way to a much better player only he can make room for", () => {
  // PG + UTIL. X (UTIL) has 10 at the half, ~20 expected; Y1 (PG) and Y2 (C, proj 38) tip now; Y2 fits only UTIL
  const t = tw(["PG", "UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, sd: 6, live: 10 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 30 }] }, { pos: ["C"], games: [{ tip: T0 + H, mu: 38 }] }]);
  const { res, after } = decideAt(t, 0, 1, T0 + H);
  const x = res!.evals[0];
  assert.equal(res!.pick, 0, `gain ${x.gain.toFixed(1)}`); assert.ok(x.gain > 8); assert.deepEqual(x.starts, [2]);
  assert.ok([after.pinned[0], after.pinned[1]].includes(2) && [after.pinned[0], after.pinned[1]].includes(1));
});

test("a normal game is never forfeited for a weaker or equal player; nothing to decide without a tip-off need", () => {
  // X has 15 at the half (~30 expected); Y (proj 20) tips now and has no slot
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 30, sd: 7, live: 15 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 20 }] }]);
  const { res, after } = decideAt(t, 0, 0, T0 + H);
  assert.equal(res!.pick, -1); assert.ok(res!.evals[0].gain < 0); assert.equal(after.inGame[0], t.byPlayer[0][0], "still in his game");
  // a tie (Y as good as X's expected final): no forfeit either (needs > 1 pt and > 2 se)
  const t2 = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, sd: 6, live: 10 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 20 }] }]);
  assert.equal(decideAt(t2, 0, 0, T0 + H).res!.pick, -1);
  // only locked players tip / nobody tips: no candidates at all
  const t3 = tw(["UTIL", "C"], [{ pos: ["SF"], games: [{ tip: T0, mu: 2, sd: 0.05, live: 2 }] }, { pos: ["C"], games: [{ tip: T0 + H, mu: 30 }] }]);
  const s3 = stateAt(t3, 0, 0, T0 + H); s3.st.isLocked[1] = 1; s3.st.lockedBy[1] = 1; s3.st.lockedPts[1] = 20;
  assert.deepEqual(forfeitCandidates(t3, s3.st, s3.ev[s3.i]), []);
  // a game without in-game information is never a candidate
  const t4 = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 2 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 25 }] }]);
  const s4 = stateAt(t4, 0, 0, T0 + H); assert.deepEqual(forfeitCandidates(t4, s4.st, s4.ev[s4.i]), []);
});

test("a gain that only comes at a later tip-off is deferred (keep him in for now)", () => {
  // two UTIL slots. X (UTIL 1) out for the game with 1 pt, ends at T0+2.5h. Z tips at T0+0.5h (takes UTIL 2 either way);
  // W (proj 30) tips at T0+1.5h and needs X's slot: benching X helps, but only at 1.5h -> not now
  const t = tw(["UTIL", "UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 1, sd: 0.05, live: 1 }] }, { pos: ["PG"], games: [{ tip: T0 + 0.5 * H, mu: 20 }] }, { pos: ["C"], games: [{ tip: T0 + 1.5 * H, mu: 30 }] }]);
  const a = decideAt(t, 0, 0, T0 + 0.5 * H);
  const x = a.res!.evals[0];
  assert.equal(a.res!.pick, -1); assert.ok(x.deferred && !x.pass, `deferred (gain ${x.gain.toFixed(1)})`); assert.ok(x.gain > 10);
  // at the 1.5h tip-off (now the next one, Z in his game in UTIL 2) the same forfeit is used at once: bench now
  const b = decideAt(t, 0, 0, T0 + 1.5 * H, P8, 5, [[1, 1]]);
  assert.equal(b.res!.pick, 0); assert.deepEqual(b.res!.evals[0].starts, [2]);
});

test("P10b's race as the engine: the same call, identical on worker threads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-mg-")); const bundle = path.join(dir, "simworker.cjs");
  buildSync({ entryPoints: [path.join(__dirname, "../scripts/simworker.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "error" });
  const pool = createRacePool(bundle, 3)!; assert.ok(pool); after(() => pool.close());
  // (each run on a fresh team-week: no shared caches)
  const mk = () => tw(["PG", "UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, sd: 6, live: 10 }] }, { pos: ["PG"], games: [{ tip: T0 + H, mu: 30 }] },
    { pos: ["C"], games: [{ tip: T0 + H, mu: 38 }, { tip: T0 + 24 * H, mu: 20 }] }]);
  const run = (p: RacePool | null) => {
    const t = mk();
    const d = decideAt(t, 0, 1, T0 + H, P8, 5, [], (ev) => p10Hooks(t, BASE, ev, 5, real(t), { kMin: 16, batch: 16, kMax: 48 }, undefined, { pool: p }), p);
    return { pick: d.res!.pick, evals: d.res!.evals.map((x) => [x.gain, x.se, x.keep, x.forfeit, x.n, x.starts]), after: Array.from(d.after.pinned) };
  };
  const a = run(null), b = run(pool);
  assert.equal(a.pick, 0, `forfeit with the race (gain ${a.evals[0][0]})`); assert.deepEqual(a.evals[0][5], [2]);
  assert.deepEqual(b, a, "worker threads: identical");
});

test("monotonicity: the option never lowers expected points (fresh scenarios, independent of the decision)", () => {
  // random weeks with a player in a game in progress at a tip-off; with the option (forfeit if the engine says so) vs
  // without, both then played by P8 on the same 300 fresh model scenarios
  const r = E.rng(77); let picked = 0; const diffs: number[] = [];
  for (let w = 0; w < 14; w++) {
    // slots G, F, UTIL with X (SF) in UTIL; five teammates, most of them tipping at the next tip-off (a slot crunch);
    // X either out for the game with a low score, or a normal game with a few points so far
    const slots = ["G", "F", "UTIL"];
    const pos = [["SF"], ["PG"], ["C"], ["SG", "SF"], ["PF"], ["PG", "SG"]];
    const out = r() < 0.5; const live = out ? 4 * r() : 3 + 10 * r();
    const t = tw(slots, pos.map((p, i) => ({ pos: p, games: i === 0
      ? [{ tip: T0, mu: out ? live : live + 4 + 8 * r(), sd: out ? 0.05 : 5, live }, { tip: T0 + 48 * H, mu: 15 + 10 * r() }]
      : [{ tip: T0 + (r() < 0.8 ? 1 : 3) * H, mu: 12 + 25 * r() }, { tip: T0 + 24 * H + Math.floor(r() * 3) * H, mu: 10 + 20 * r() }] })));
    const sx = 2; // X in UTIL
    const tt = Math.min(...t.games.filter((g) => g.p !== 0).map((g) => g.tip));
    const d = decideAt(t, 0, sx, tt, P8, 100 + w);
    if (!d.res) continue;
    const fwd = E.cloneState(d.st); if (d.res.pick >= 0) { E.forfeitGame(fwd, d.res.pick); picked++; }
    const rr = E.rng(5000 + w); let s = 0, s2 = 0; const K = 300;
    for (let k = 0; k < K; k++) {
      const sc = E.sampleScenario(t, d.st, tt, rr, real(t));
      const a = E.simulate(t, P8, d.ev, sc.actual, sc.played, E.cloneState(fwd), d.i).total;
      const b = E.simulate(t, P8, d.ev, sc.actual, sc.played, E.cloneState(d.st), d.i).total;
      s += a - b; s2 += (a - b) ** 2;
    }
    const m = s / K, se = Math.sqrt(Math.max(0, s2 / K - m * m) / (K - 1));
    if (d.res.pick < 0) assert.equal(m, 0, "no forfeit: identical"); else assert.ok(m > -2 * se, `week ${w}: forfeit lowers points ${m.toFixed(2)} ± ${se.toFixed(2)}`);
    diffs.push(m);
  }
  assert.ok(picked >= 2, `some forfeits happen (${picked})`);
  assert.ok(diffs.reduce((a, b) => a + b, 0) / diffs.length >= 0, "on average never worse");
});

// ---- the Do-now card and the notifier ----
const ET = (h: number, m = 0) => Date.parse("2026-10-21T00:00:00-04:00") + h * H + m * 60e3;
const NAMES = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
const slots = (occ: Record<number, any>) => NAMES.map((slot, i) => ({ slot, player: occ[i]?.pid ?? null, pid: occ[i]?.pid ?? null, locked: false, points: null, source: null, state: occ[i] ? "idle" : "empty", ...(occ[i] ?? {}) }));
test("card + notifier: bench a player in his game now, with the reason; deferred ones are notes", () => {
  const m = { player: "Wilson", pid: "Wilson", slot: "SF", pts: 1.5, min: 14, final: 1.5, sd: 0.05, out: "ruled out for the rest of the game (Sleeper: Out)", keep: 270, forfeit: 281, gain: 11, se: 0.8, n: 256,
    recommended: "BENCH_NOW", for: ["Green"], tip: ET(22), text: "Bench Wilson now - forfeits his 1.5 so far (ruled out for the rest of the game (Sleeper: Out)); frees SF for Green at 10:00 PM, +11.0 exp pts" };
  const k = { ...m, player: "Miller", pid: "Miller", slot: "UTIL 1", pts: 2, recommended: "KEEP", deferred: ET(22, 30), for: [], gain: 2.2, text: "Keep Miller in UTIL 1 for now (in his game: 2.0 so far, ~6.5 expected by the end) - benching him before the 10:30 PM tip-off may be worth +2.2 exp pts; re-checked then" };
  const a: any = {
    asOf: ET(21, 50), decisions: [],
    me: { slots: slots({ 3: { pid: "Wilson", state: "playing", gameEnd: ET(22, 10), lockIf: 24 }, 7: { pid: "Miller", state: "playing", gameEnd: ET(22, 10), lockIf: 23 } }), players: [] },
    plan: [{ tip: ET(22), when: "Wed 10:00 PM", tentative: false, starts: [{ slot: "SF", player: "Green", pid: "Green", proj: 21, lockIf: 25, opp: "POR", end: ET(22) + 2.25 * H }], benched: [], holds: [], forfeits: [], locks: [],
      playing: [{ player: "Miller", pid: "Miller", slot: "UTIL 1", end: ET(22, 10) }], midgame: [m, k] }],
  };
  const d = doNow(a);
  assert.deepEqual(d.forfeits?.map((f) => f.pid), ["Wilson"]);
  assert.ok(d.changes.some((c) => /^Bench Wilson now \(in his game - forfeits his 1\.5 so far, ruled out .*frees SF for Green at 10:00 PM, \+11\.0 exp pts\)$/.test(c)), d.changes.join(" | "));
  assert.ok(d.changes.some((c) => /^Put Green in SF$/.test(c)), d.changes.join(" | "));
  assert.equal(d.rows.find((r) => r.slot === "SF")!.pid, "Green");
  assert.ok(!d.then.some((s) => s.items.some((i) => /Wilson/.test(i))), "no lock check / later step for the benched player");
  assert.equal(d.upToDate, null);
  assert.deepEqual(d.midgameNotes, [k.text]);
  const txt = doNowText(d); assert.match(txt, /⚠️ Bench Wilson now/); assert.match(txt, /\(in-game\) Keep Miller/);
  // Miller (kept) stays in UTIL 1 now
  assert.equal(d.rows.find((r) => r.slot === "UTIL 1")!.pid, "Miller");
  const msgs = messages(a, ET(21, 50));
  const f = msgs.find((x) => x.key.startsWith("forfeit|Wilson|"))!;
  assert.ok(f); assert.match(f.title, /^⚠️ BENCH Wilson NOW \(forfeits his 1\.5\) → Green in SF$/); assert.match(f.body, /frees SF for Green/);
});
