// P10 / P10b races on worker threads (lib/live/racepool.ts): the same decisions and the same race statistics as the
// single-thread race, whatever the number of workers (1, 3, 12), on random weeks and on the live app's path; exact
// price views in the workers; fallbacks (stale bundle, failure) give the single-thread results.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildSync } from "esbuild";
import * as E from "../lib/engine/core";
import { indexContext, exportPrices, importPrices, seedPrices } from "../lib/engine/p8";
import { p10Hooks, decisionKey, type P10Opts, type RacePool } from "../lib/engine/p10";
import { createRacePool, resetLiveRacePool, liveRaceWorkers, type RaceWorkerPool } from "../lib/live/racepool";
import { planHooks, resetEngineCache, raceOnWorkers, P8_POLICY } from "../lib/live/engine";
import { computeAdvice } from "../lib/live/advise";
import type { LiveTeam } from "../lib/live/week";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-race-"));
const bundle = path.join(dir, "simworker.cjs");
buildSync({ entryPoints: [path.join(__dirname, "../scripts/simworker.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "error" });
const pools = new Map<number, RaceWorkerPool>();
const pool = (n: number) => { let p = pools.get(n); if (!p) { p = createRacePool(bundle, n)!; assert.ok(p, `pool of ${n}`); pools.set(n, p); } return p; };
after(async () => { for (const p of pools.values()) await p.close(); await resetLiveRacePool(); });

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
// a random 9-slot week over `days` game days (built anew for every run: no shared caches between the runs compared)
function randomWeek(seed: number, n = 11, days = 4): E.TeamWeek {
  const r = E.rng(seed); const games: E.Game[] = [];
  const players = Array.from({ length: n }, () => ({ pos: POS[Math.floor(r() * POS.length)], games: Array.from({ length: days }, (_, d) => d).filter(() => r() < 0.6).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })) }));
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  const slots = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 0.92, p0: 0.4 } };
}
const TOP: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100, weekIters: 20000 } };
const B8: E.Policy = { ...TOP, name: "P10b base", index: { resolve: "tip", iters: 100, weekIters: 20000, slot: "roll" } };   // P10b: P8 continuations
const B8F: E.Policy = { ...TOP, name: "P10 base", index: { resolve: "info", iters: 30, weekIters: 20000, slot: "roll" } }; // P10: P8f continuations
const real = (t: E.TeamWeek) => ({ actual: Float64Array.from(t.games.map((g) => g.actual)), played: Uint8Array.from(t.games.map(() => 1)) });
const O: P10Opts = { batch: 8, kMin: 16, kMax: 64 };

// a whole week on the real outcomes: every decision, the final state, the race statistics (all but wall time)
function runWeek(seed: number, base: E.Policy, pool: RacePool | null, o: P10Opts = O, t = randomWeek(seed)) { const ev = E.buildEvents(t, true); const re = real(t);
  const h = p10Hooks(t, base, ev, seed, re, o, undefined, { pool });
  const log: string[] = [];
  const hk: E.Hooks = { decideIndex: (st, tt, i, ctx) => { const d = h.decideIndex!(st, tt, i, ctx); log.push(`${i}:${d ? decisionKey(d) : "-"}`); return d; } };
  const st = E.initState(t); const total = E.simulate(t, TOP, ev, re.actual, re.played, st, 0, hk).total;
  const { ms: _ms, ...stats } = h.stats;
  return { total, log, stats, st: JSON.stringify(Object.values(st).map((x) => (typeof x === "number" ? x : Array.from(x as ArrayLike<number>)))) };
}

test("price views rebuilt from a snapshot are exact (tables, decisions)", () => {
  const t = randomWeek(3); const ev = E.buildEvents(t, true); const re = real(t); const st = E.initState(t);
  const i = ev.findIndex((e, k) => k > 20 && e.kind === 2);
  E.simulate(t, TOP, ev, re.actual, re.played, st, 0, undefined, ev[i].t - 1);
  const c1 = indexContext(t, TOP, st, ev[i])!; const snap = exportPrices(t)!;
  const t2 = randomWeek(3); importPrices(t2, structuredClone(snap)); seedPrices(t2, "x");
  const c2 = indexContext(t2, { ...TOP, index: { ...TOP.index!, resolve: "never", slot: "x" } }, st, ev[i])!;
  assert.deepEqual(c2.cands.map((c) => [c.p, Array.from(c.w), Array.from(c.act), c.base, c.raw, c.wa.map((w) => Array.from(w))]), c1.cands.map((c) => [c.p, Array.from(c.w), Array.from(c.act), c.base, c.raw, c.wa.map((w) => Array.from(w))]));
  assert.equal(decisionKey(c2.best), decisionKey(c1.best)); assert.equal(c2.bestScore, c1.bestScore);
});

test("P10b and P10 races on 1, 3 and 12 workers = the single-thread race (decisions, totals, states, statistics)", () => {
  for (const [seed, base] of [[101, B8], [102, B8], [103, B8F]] as const) {
    const one = runWeek(seed, base, null);
    assert.ok(one.stats.raced >= 5 && one.stats.sims > 300, `week ${seed} races (${one.stats.raced} raced, ${one.stats.sims} continuations)`);
    for (const n of [1, 3, 12]) {
      const w = runWeek(seed, base, pool(n));
      assert.deepEqual(w.log, one.log, `week ${seed}, ${n} workers: decisions`);
      assert.equal(w.total, one.total); assert.equal(w.st, one.st); assert.deepEqual(w.stats, one.stats, `week ${seed}, ${n} workers: stats`);
      assert.ok(pool(n).alive(), "no fallback happened");
    }
  }
  // the default racing settings (16 per round, up to 256) on one week
  const d1 = runWeek(104, B8, null, {}), d12 = runWeek(104, B8, pool(12), {});
  assert.deepEqual(d12, d1);
});

test("a pool serves many team-weeks in turn (workers keep the last two; returning to an older one re-sends it)", () => {
  const p = createRacePool(bundle, 3)!; pools.set(-3, p);
  const ws = [111, 112, 113].map((s) => randomWeek(s)); const one = [111, 112, 113].map((s) => runWeek(s, B8, null));
  for (const i of [0, 1, 2, 0, 2]) assert.deepEqual(runWeek(111 + i, B8, p, O, ws[i]), one[i], `team-week ${i}`);
  assert.ok(p.alive(), "no fallback");
});

test("fallbacks give the single-thread results: stale worker bundle, a failing pool", () => {
  const stale = path.join(dir, "stale.cjs"); fs.writeFileSync(stale, "require('worker_threads').parentPort.on('message', () => {});");
  assert.equal(createRacePool(stale, 2), null, "a bundle without the race protocol is not used");
  // a pool that fails (here: a team-week the workers can't receive) is switched off and the race goes on in this thread
  const p = createRacePool(bundle, 2)!; pools.set(-2, p);
  const one = runWeek(105, B8, null);
  const t = randomWeek(105); (t as any).bad = () => 0; // not structured-cloneable
  const ev = E.buildEvents(t, true); const re = real(t); const h = p10Hooks(t, B8, ev, 105, re, O, undefined, { pool: p });
  const st = E.initState(t); const total = E.simulate(t, TOP, ev, re.actual, re.played, st, 0, h).total;
  assert.equal(total, one.total); const { ms: _ms, ...stats } = h.stats; assert.deepEqual(stats, one.stats);
  assert.equal(p.alive(), false, "switched off");
});

// the live app's path (lib/live/engine.ts planHooks / advise.ts computeAdvice) with engine p10b
const T1 = Date.parse("2026-10-26T23:00:00Z");
function liveTeam(): LiveTeam {
  const r = E.rng(77); const pos = POS; const nP = 11;
  const players = Array.from({ length: nP }, (_, i) => ({ pos: pos[i % pos.length], g: [0, 1, 2, 3].filter(() => r() < 0.55).map((d) => [d * 24 + Math.floor(r() * 3), 12 + Math.round(r() * 25)]) }));
  players[0].g = [[0, 25], [72, 25]]; // A: Monday game finished (held 31), plays again Thursday
  const games: E.Game[] = []; players.forEach((p, i) => p.g.forEach(([h, mu]) => games.push({ p: i, tip: T1 + h * H, end: T1 + (h + 2.5) * H, mu, sd: 8, projRaw: mu, actual: 0, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  const slotNames = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
  const names = players.map((_, i) => String.fromCharCode(65 + i)); const pids = names.map((n) => n.toLowerCase());
  const tw: E.TeamWeek = { slots: slotNames.map((s) => E.SLOT_MASK[s]), slotNames, pmask: players.map((p) => E.posMask(p.pos)), names, games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 0.9, p0: 0.3 } };
  const asOf = T1 + 12 * H; const events = E.buildEvents(tw, true); const evIdx = events.findIndex((e) => e.t > asOf);
  const done = games.map((g) => g.end <= asOf);
  const st = E.initState(tw); games.forEach((g, gi) => { if (done[gi]) st.started[gi] = 1; });
  const g0 = byPlayer[0][0]; st.pendingX[0] = 31; st.lastSlot[0] = 7;
  return {
    rosterId: 8, ownerId: "o", teamName: "t", pids, names, positions: players.map((p) => p.pos), injury: players.map(() => null), tw,
    games: games.map((g, gi) => ({ gi, pid: pids[g.p], date: "", tip: g.tip, end: g.end, team: "", opp: "", proj: g.mu, mu: g.mu, sd: 8, status: done[gi] ? "post" : "pre", actual: done[gi] ? (gi === g0 ? 31 : 0) : null, played: done[gi] ? gi === g0 : null })),
    real: { actual: Float64Array.from(games.map((_, gi) => (gi === g0 ? 31 : 0))), played: Uint8Array.from(games.map((_, gi) => (gi === g0 ? 1 : 0))) },
    st, events, evIdx, lineup: [null, null, null, null, null, null, null, "a", null], lockSource: slotNames.map(() => null), sleeperPoints: null,
  };
}
const withEnv = async <R>(env: Record<string, string | undefined>, f: () => Promise<R> | R): Promise<R> => {
  const old: Record<string, string | undefined> = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  resetEngineCache(); await resetLiveRacePool();
  try { return await f(); } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } resetEngineCache(); await resetLiveRacePool(); }
};
const ONE = { LOCKIN_ENGINE: "p10b", LOCKIN_NO_WORKERS: "1", LOCKIN_RACE_WORKERS: undefined, LOCKIN_SIMWORKER: bundle };
const POOL = (n: number) => ({ LOCKIN_ENGINE: "p10b", LOCKIN_NO_WORKERS: undefined, LOCKIN_RACE_WORKERS: String(n), LOCKIN_SIMWORKER: bundle });

test("live path (engine p10b): plan hooks on the median path and the whole advice are identical with 1 / 3 / 12 race workers", async () => {
  const T = liveTeam(); const week = 3;
  const median = () => { const a = T.real.actual.slice(), p = T.real.played.slice(); T.games.forEach((g) => { if (g.status !== "post") { a[g.gi] = g.mu; p[g.gi] = 1; } }); return { a, p }; };
  // the plan's hooks (lib/live/engine.ts planHooks) over every remaining tip-off, as the plan / replay drive them (chunked)
  const planRun = () => {
    const h = planHooks(T.tw, T.events, 200, 4242 + week, T.real) as E.Hooks & { stats: any }; const { a, p } = median();
    let st = E.cloneState(T.st), ev = T.evIdx; const steps: string[] = [];
    for (const tip of [...new Set(T.games.filter((g) => g.status === "pre").map((g) => g.tip))].sort((x, y) => x - y)) {
      const r = E.simulate(T.tw, P8_POLICY, T.events, a, p, st, ev, h, tip); st = r.st; ev = r.evIdx;
      steps.push(`${tip}:${Array.from(st.pinned)}|${Array.from(st.lockedBy)}|${Array.from(st.pendingX)}`);
    }
    const { ms: _ms, ...stats } = h.stats; return { steps, stats, workers: liveRaceWorkers() };
  };
  const one = await withEnv(ONE, planRun);
  assert.equal(one.workers, 0); assert.ok(one.stats.raced >= 3, `races (${one.stats.raced})`);
  for (const n of [1, 3, 12]) {
    const w = await withEnv(POOL(n), planRun);
    assert.equal(w.workers, n); assert.deepEqual(w.steps, one.steps, `${n} workers: plan`); assert.deepEqual(w.stats, one.stats, `${n} workers: stats`);
  }
  // the whole advice (plan, hold / lock / bench calls, cut-offs, actions), as /api/advise and the notifier compute it
  const ctx = { league: { name: "L" } as any, season: "2026", week, dates: [], asOf: T1 + 12 * H, mode: "live" as const, slotNames: T.tw.slotNames, me: T, opp: null, notes: [] };
  const advice = async () => { const a = await computeAdvice(ctx, 40, new Float64Array([1, 2, 3]), null); return JSON.stringify({ ...a, generatedAt: 0 }); };
  const a1 = await withEnv(ONE, advice), a12 = await withEnv(POOL(12), advice);
  assert.match(a1, /P10b \(complete decision/); assert.equal(a12, a1);
  // the instant off-switch: "raceWorkers": 0 in config.json (re-read every 30 s) races on this thread
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-race-cfg-"));
  assert.equal(await withEnv({ ...POOL(12), LOCKIN_CONFIG_DIR: cdir }, () => raceOnWorkers()), true);
  fs.writeFileSync(path.join(cdir, "config.json"), JSON.stringify({ leagueId: "x", rosterId: 8, raceWorkers: 0 }));
  assert.equal(await withEnv({ ...POOL(12), LOCKIN_CONFIG_DIR: cdir }, () => raceOnWorkers()), false);
  assert.equal(await withEnv({ ...POOL(12), LOCKIN_CONFIG_DIR: cdir }, advice), a1);
});
