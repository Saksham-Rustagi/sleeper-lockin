// Live engine selection (lib/live/engine.ts): default unchanged, env / config switch, every view uses the choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import * as E from "../lib/engine/core";
import { POLICY, type LiveTeam } from "../lib/live/week";
import { engineName, resetEngineCache, decisionPolicy, simPolicy, planHooks, replayHooks, engineTag, simTag, engineDecidesHolds, replayIsSlow, P8_POLICY, objectiveName, winActive } from "../lib/live/engine";
import { computeAdvice, engineCall } from "../lib/live/advise";
import { humanSnapshot, liveOppSource } from "../lib/live/opponent";
import { fingerprint } from "../lib/live/cache";
import { weekValues, lockWaitTotals } from "../lib/live/teamsim";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-engine-"));
process.env.LOCKIN_CONFIG_DIR = dir;
const withEngine = <T>(env: string | undefined, cfg: string | undefined, f: () => T): T => {
  const old = process.env.LOCKIN_ENGINE;
  if (env === undefined) delete process.env.LOCKIN_ENGINE; else process.env.LOCKIN_ENGINE = env;
  if (cfg === undefined) fs.rmSync(path.join(dir, "config.json"), { force: true }); else fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ leagueId: "x", rosterId: 8, engine: cfg }));
  resetEngineCache();
  try { return f(); } finally { if (old === undefined) delete process.env.LOCKIN_ENGINE; else process.env.LOCKIN_ENGINE = old; fs.rmSync(path.join(dir, "config.json"), { force: true }); resetEngineCache(); }
};

test("engine choice: default p7h, config file, env overrides config, unknown values fall back", () => {
  assert.equal(withEngine(undefined, undefined, engineName), "p7h");
  assert.equal(withEngine(undefined, "p8", engineName), "p8");
  assert.equal(withEngine("p9", "p8", engineName), "p9");
  assert.equal(withEngine(" P8 ", undefined, engineName), "p8");
  assert.equal(withEngine("fancy", undefined, engineName), "p7h");
});

test("the default engine changes nothing: same policies, same hooks, same cache fingerprints", () => {
  withEngine(undefined, undefined, () => {
    assert.equal(decisionPolicy(), POLICY); assert.equal(simPolicy(), POLICY); assert.equal(engineTag(), undefined);
    const x = { v: 3, K: 20000, week: 7, team: { pids: ["1", "2"] } };
    const raw = crypto.createHash("sha1").update(JSON.stringify(x)).digest("hex");
    assert.equal(fingerprint(x), raw, "default fingerprints are byte-identical to before");
  });
  const fpDefault = withEngine(undefined, undefined, () => fingerprint({ a: 1 }));
  const fpP8 = withEngine("p8", undefined, () => fingerprint({ a: 1 }));
  const fpP9 = withEngine("p9", undefined, () => fingerprint({ a: 1 }));
  assert.ok(fpDefault !== fpP8 && fpP8 !== fpP9, "each engine has its own cache entries");
  withEngine("p8", undefined, () => { assert.equal(decisionPolicy(), P8_POLICY); assert.ok(simPolicy().index?.fresh, "simulations use the fast index rule"); });
});

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
// a small live team at Tuesday noon: one Monday game finished (held 30 in UTIL), the rest to come
function liveTeam(): LiveTeam {
  const players = [{ pos: ["SF"], g: [[0, 25, 30], [96, 25, 0]] }, { pos: ["PG"], g: [[24, 20, 0], [72, 22, 0]] }, { pos: ["C"], g: [[25, 28, 0], [97, 26, 0]] }, { pos: ["PF", "C"], g: [[48, 18, 0]] }];
  const games: E.Game[] = []; players.forEach((p, i) => p.g.forEach(([h, mu, a]) => games.push({ p: i, tip: T0 + h * H, end: T0 + (h + 2.5) * H, mu, sd: 8, projRaw: mu, actual: a, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  const tw: E.TeamWeek = { slots: ["PG", "C", "UTIL"].map((s) => E.SLOT_MASK[s]), slotNames: ["PG", "C", "UTIL"], pmask: players.map((p) => E.posMask(p.pos)), names: ["A", "B", "C", "D"], games, byPlayer, lastPlayed0: [1, 1, 1, 1], dnp: { p1: 0.9, p0: 0.3 } };
  const asOf = T0 + 12 * H; const events = E.buildEvents(tw, true); const evIdx = events.findIndex((e) => e.t > asOf);
  const st = E.initState(tw); const g0 = byPlayer[0][0]; st.started[g0] = 1; st.pendingX[0] = 30; st.lastSlot[0] = 2;
  return {
    rosterId: 8, ownerId: "o", teamName: "t", pids: ["a", "b", "c", "d"], names: tw.names, positions: players.map((p) => p.pos), injury: [null, null, null, null], tw,
    games: games.map((g, gi) => ({ gi, pid: ["a", "b", "c", "d"][g.p], date: "", tip: g.tip, end: g.end, team: "", opp: "", proj: g.mu, mu: g.mu, sd: 8, status: gi === g0 ? "post" : "pre", actual: gi === g0 ? 30 : null, played: gi === g0 ? true : null })),
    real: { actual: Float64Array.from(games.map((g, gi) => (gi === g0 ? 30 : 0))), played: Uint8Array.from(games.map((_, gi) => (gi === g0 ? 1 : 0))) },
    st, events, evIdx, lineup: [null, null, "a"], lockSource: [null, null, null], sleeperPoints: null,
  };
}

test("projections and lock cut-off simulations run on the selected engine", () => {
  const T = liveTeam(); const asOf = T0 + 12 * H;
  const v7 = withEngine(undefined, undefined, () => weekValues(T, 60, 11, asOf));
  const v8 = withEngine("p8", undefined, () => weekValues(T, 60, 11, asOf));
  const m = (v: Float64Array) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(Number.isFinite(m(v7)) && Number.isFinite(m(v8)) && m(v8) >= 30, `p7h ${m(v7)} p8 ${m(v8)}`);
  assert.ok(Array.from(v7).some((x, k) => x !== v8[k]), "a different engine plays the week differently");
  // cut-off simulations (as the plan uses them): C (player 2) has just tipped off in the C slot; forcing the lock of a
  // 100 from that game at his first decision counts the 100
  const g = T.tw.byPlayer[2][0]; const tip = T.tw.games[g].tip;
  const st0 = E.cloneState(T.st); st0.inGame[2] = g; st0.started[g] = 1; st0.pinned[1] = 2; st0.pinnedUntil[1] = T.tw.games[g].end; st0.lastSlot[2] = 1;
  const ev0 = T.events.findIndex((e) => e.t > tip);
  for (const e of ["p7h", "p8", "p9"]) withEngine(e, undefined, () => {
    const lock = lockWaitTotals(T, E.cloneState(st0), ev0, 2, g, 100, "lock", 20, 3, asOf);
    const wait = lockWaitTotals(T, E.cloneState(st0), ev0, 2, g, 100, "wait", 20, 3, asOf);
    assert.ok(Array.from(lock).every((x) => x >= 100), `${e}: lock counts the score`);
    assert.ok(Array.from(wait).some((x, k) => x !== lock[k]), `${e}: waiting differs from locking`);
  });
});

test("plan / replay hooks follow the engine", () => {
  const T = liveTeam();
  const h7 = withEngine(undefined, undefined, () => planHooks(T.tw, T.events, 10, 1, T.real));
  const h8 = withEngine("p8", undefined, () => planHooks(T.tw, T.events, 10, 1, T.real));
  const h9 = withEngine("p9", undefined, () => planHooks(T.tw, T.events, 10, 1, T.real));
  assert.ok(h7?.decideStarts && !h7.decideIndex); assert.equal(h8, undefined); assert.ok(h9?.decideIndex);
  assert.ok(withEngine(undefined, undefined, () => replayHooks(T.tw, T.events, 10, 1, T.real))?.decideLock);
  assert.equal(withEngine("p8", undefined, () => replayHooks(T.tw, T.events, 10, 1, T.real)), undefined);
  for (const e of ["p10", "p10b", "p10b-full"]) {
    assert.ok(withEngine(e, undefined, () => planHooks(T.tw, T.events, 10, 1, T.real))?.decideIndex, `${e} plan hooks`);
    assert.ok(withEngine(e, undefined, () => replayHooks(T.tw, T.events, 10, 1, T.real))?.decideIndex, `${e} replay hooks`);
    assert.equal(withEngine(e, undefined, engineName), e);
  }
});

// objective "win" (Phase 5): config / env, only with the race engines, its own cache entries, the opponent's snapshot
const withObjective = <T>(env: string | undefined, cfg: { engine?: string; objective?: string } | undefined, f: () => T): T => {
  const old = process.env.LOCKIN_OBJECTIVE, oldE = process.env.LOCKIN_ENGINE; delete process.env.LOCKIN_ENGINE;
  if (env === undefined) delete process.env.LOCKIN_OBJECTIVE; else process.env.LOCKIN_OBJECTIVE = env;
  if (cfg === undefined) fs.rmSync(path.join(dir, "config.json"), { force: true }); else fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ leagueId: "x", rosterId: 8, ...cfg }));
  resetEngineCache();
  try { return f(); } finally {
    if (old === undefined) delete process.env.LOCKIN_OBJECTIVE; else process.env.LOCKIN_OBJECTIVE = old;
    if (oldE !== undefined) process.env.LOCKIN_ENGINE = oldE; fs.rmSync(path.join(dir, "config.json"), { force: true }); resetEngineCache();
  }
};
test("objective: default points (fingerprints unchanged), 'win' only with p10 / p10b, own cache entries", () => {
  assert.equal(withObjective(undefined, undefined, objectiveName), "points");
  assert.equal(withObjective(undefined, { objective: "win" }, objectiveName), "win");
  assert.equal(withObjective("points", { objective: "win" }, objectiveName), "points", "env wins");
  assert.equal(withObjective("maybe", undefined, objectiveName), "points");
  assert.equal(withObjective(undefined, { objective: "win" }, () => winActive()), false, "p7h can't play for the win");
  assert.equal(withObjective(undefined, { objective: "win" }, () => engineTag()), undefined, "p7h + win: unchanged behaviour, unchanged fingerprints");
  assert.equal(withObjective(undefined, { engine: "p10b", objective: "win" }, () => winActive()), true);
  const fps = [withObjective(undefined, { engine: "p10b" }, () => fingerprint({ a: 1 })), withObjective(undefined, { engine: "p10b", objective: "win" }, () => fingerprint({ a: 1 }))];
  assert.notEqual(fps[0], fps[1], "win has its own cache entries");
  assert.equal(withObjective(undefined, { objective: "points" }, () => fingerprint({ a: 1 })), crypto.createHash("sha1").update(JSON.stringify({ a: 1 })).digest("hex"));
});
test("objective 'win': plan hooks play P11 against the opponent's snapshot; without an opponent, P10", () => {
  const T = liveTeam(); const opp = liveTeam(); const asOf = T0 + 12 * H;
  const hs = humanSnapshot(opp);
  assert.equal(hs.occ[2], 0, "his held player sits in UTIL"); assert.equal(hs.held[0], 30);
  const D = liveOppSource(opp, asOf, 1, 200)!.dist(asOf)!;
  assert.ok(D.mean > 30 && Number.isFinite(D.sd), `his final > the 30 he holds (${D.mean})`);
  const h = withObjective(undefined, { engine: "p10", objective: "win" }, () => planHooks(T.tw, T.events, 10, 1, T.real, undefined, liveOppSource(opp, asOf, 1, 200)));
  assert.ok(h?.decideIndex && (h as any).stats?.win, "P11 hooks");
  const h0 = withObjective(undefined, { engine: "p10", objective: "win" }, () => planHooks(T.tw, T.events, 10, 1, T.real));
  assert.ok(h0?.decideIndex && !(h0 as any).stats?.win, "no opponent: P10");
  const hp = withObjective(undefined, { engine: "p10" }, () => planHooks(T.tw, T.events, 10, 1, T.real, undefined, liveOppSource(opp, asOf, 1, 200)));
  assert.ok(hp?.decideIndex && !(hp as any).stats?.win, "objective points: P10 even with an opponent");
});

// p10b ships as a split engine (task G): P10b decides, mass simulations stay on POLICY; the old all-P8f p10b is p10b-full
test("p10b: decisions by P10b, mass simulations (projections, cut-offs) exactly p7h's; p10b-full keeps P8f", () => {
  withEngine("p10b", undefined, () => {
    assert.equal(decisionPolicy(), P8_POLICY); assert.equal(simPolicy(), POLICY); assert.ok(engineDecidesHolds());
  });
  withEngine("p10b-full", undefined, () => {
    assert.equal(decisionPolicy(), P8_POLICY); assert.ok(simPolicy().index?.fresh, "p10b-full simulates with P8f"); assert.ok(!engineDecidesHolds());
  });
  for (const e of [undefined, "p8", "p9", "p10"]) assert.ok(!withEngine(e, undefined, () => engineDecidesHolds()), `${e ?? "p7h"} unchanged`);
  // the notifier precomputes replays (quiet hours) only for the race engines; p7h's notifier is unchanged
  for (const e of ["p10", "p10b", "p10b-full"]) assert.ok(withEngine(e, undefined, () => replayIsSlow()), e);
  for (const e of [undefined, "p8", "p9"]) assert.ok(!withEngine(e, undefined, () => replayIsSlow()), e ?? "p7h");
  const T = liveTeam(); const asOf = T0 + 12 * H;
  const v7 = withEngine(undefined, undefined, () => weekValues(T, 60, 11, asOf));
  assert.deepEqual(withEngine("p10b", undefined, () => weekValues(T, 60, 11, asOf)), v7, "p10b projections = p7h's");
  assert.ok(Array.from(withEngine("p10b-full", undefined, () => weekValues(T, 60, 11, asOf))).some((x, k) => x !== v7[k]), "p10b-full projections differ");
  const g = T.tw.byPlayer[2][0]; const tip = T.tw.games[g].tip;
  const st0 = E.cloneState(T.st); st0.inGame[2] = g; st0.started[g] = 1; st0.pinned[1] = 2; st0.pinnedUntil[1] = T.tw.games[g].end; st0.lastSlot[2] = 1;
  const ev0 = T.events.findIndex((e) => e.t > tip);
  for (const mode of ["lock", "wait"] as const) {
    const c7 = withEngine(undefined, undefined, () => lockWaitTotals(T, E.cloneState(st0), ev0, 2, g, 40, mode, 30, 3, asOf));
    assert.deepEqual(withEngine("p10b", undefined, () => lockWaitTotals(T, E.cloneState(st0), ev0, 2, g, 40, mode, 30, 3, asOf)), c7, `p10b cut-off sims (${mode}) = p7h's`);
  }
});

test("p10b cache fingerprints: mass simulations share p7h's entries, decisions have their own (also vs p10b-full)", () => {
  const x = { v: 3, K: 20000, week: 7, team: { pids: ["1", "2"] } };
  const raw = crypto.createHash("sha1").update(JSON.stringify(x)).digest("hex");
  assert.equal(withEngine(undefined, undefined, () => fingerprint(x, "sim")), raw, "p7h sim fingerprints byte-identical");
  assert.equal(withEngine(undefined, undefined, () => fingerprint(x)), raw, "p7h decision fingerprints byte-identical");
  assert.equal(withEngine("p10b", undefined, () => fingerprint(x, "sim")), raw, "p10b projections / Waivers / Matchups / IR: p7h's cache entries");
  const d10b = withEngine("p10b", undefined, () => fingerprint(x)), dFull = withEngine("p10b-full", undefined, () => fingerprint(x));
  assert.ok(d10b !== raw && dFull !== raw && d10b !== dFull, "advise / replay: one entry per decision engine");
  assert.notEqual(withEngine("p10b-full", undefined, () => fingerprint(x, "sim")), raw, "p10b-full simulates differently");
  assert.equal(withEngine("p10b", undefined, () => engineTag()), "p10b+sim:p7h", "never the old p10b's tag");
  assert.equal(withEngine("p8", undefined, () => fingerprint(x, "sim")), withEngine("p8", undefined, () => fingerprint(x)), "p8 unchanged: one tag");
  assert.equal(withObjective(undefined, { engine: "p10b", objective: "win" }, () => fingerprint(x, "sim")), raw, "win changes decisions only");
  assert.notEqual(withObjective(undefined, { engine: "p10b", objective: "win" }, () => fingerprint(x)), d10b);
  assert.equal(withEngine("p10b", undefined, () => simTag()), undefined);
});

test("p10b advice: every hold / lock / bench call is P10b's decision at the first tip-off, consistent with the plan", async () => {
  process.env.LOCKIN_NO_WORKERS = "1";
  const T = liveTeam(); const asOf = T0 + 12 * H; const week = 3;
  const ctx = { league: { name: "L" } as any, season: "2026", week, dates: [], asOf, mode: "live" as const, slotNames: T.tw.slotNames, me: T, opp: null, notes: [] };
  const ms = new Float64Array([1, 2, 3]);
  const with10b = async <R>(f: () => Promise<R>) => { process.env.LOCKIN_ENGINE = "p10b"; resetEngineCache(); try { return await f(); } finally { delete process.env.LOCKIN_ENGINE; resetEngineCache(); } };
  const a = await with10b(() => computeAdvice(ctx, 40, ms, null));
  assert.equal(a.decisions.length, 1, "A holds 30"); const d = a.decisions[0];
  // the engine's decision, reproduced independently: P8 + the P10b race (plan hooks) on the plan's median path
  const firstTip = a.plan[0].tip; assert.equal(firstTip, T0 + 24 * H);
  const actual = T.real.actual.slice(), played = T.real.played.slice();
  T.games.forEach((g) => { if (g.status !== "post") { actual[g.gi] = g.mu; played[g.gi] = 1; } });
  const hooks = planHooks(T.tw, T.events, 200, 4242 + week, T.real, "p10b");
  const st = E.simulate(T.tw, P8_POLICY, T.events, actual, played, E.cloneState(T.st), T.evIdx, hooks, firstTip).st;
  const call = engineCall(st, 0);
  assert.equal(d.recommended, call.action, d.reason);
  if (call.action === "LOCK") assert.equal(T.tw.slots[T.tw.slotNames.indexOf(d.recommendedSlot!)], T.tw.slots[call.slot!]);
  assert.match(d.reason, /^P10b/);
  assert.ok(d.options.some((o) => o.action === d.recommended), "the call is one of the options shown");
  const inHolds = a.plan[0].holds.some((h) => h.pid === "a"), forfeit = a.plan[0].forfeits.some((f) => f.player === "A");
  if (d.recommended === "HOLD") assert.ok(inHolds); else if (d.recommended === "BENCH") assert.ok(forfeit); else assert.ok(!inHolds && !forfeit);
  // engineCall: the three outcomes
  const s = E.cloneState(T.st); assert.equal(engineCall(s, 0).action, "HOLD");
  s.pendingX[0] = NaN; assert.equal(engineCall(s, 0).action, "BENCH");
  const s2 = E.cloneState(T.st); E.doLock(s2, 0, 2); assert.deepEqual(engineCall(s2, 0), { action: "LOCK", slot: 2 });
  // the default engine keeps its own rule (best quick-simulation option)
  const a7 = await computeAdvice(ctx, 40, ms, null);
  assert.doesNotMatch(a7.decisions[0].reason, /P10b/);
});
