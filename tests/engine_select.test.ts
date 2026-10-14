// Live engine selection (lib/live/engine.ts): default unchanged, env / config switch, every view uses the choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import * as E from "../lib/engine/core";
import { POLICY, type LiveTeam } from "../lib/live/week";
import { engineName, resetEngineCache, decisionPolicy, simPolicy, planHooks, replayHooks, engineTag, P8_POLICY } from "../lib/live/engine";
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
  for (const e of ["p10", "p10b"]) {
    assert.ok(withEngine(e, undefined, () => planHooks(T.tw, T.events, 10, 1, T.real))?.decideIndex, `${e} plan hooks`);
    assert.ok(withEngine(e, undefined, () => replayHooks(T.tw, T.events, 10, 1, T.real))?.decideIndex, `${e} replay hooks`);
    assert.equal(withEngine(e, undefined, engineName), e);
  }
});
