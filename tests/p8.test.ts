// P8 (Lagrangian index policy): legality and the decisions the joint assignment makes possible.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import { indexContext } from "../lib/engine/p8";
import { runChecked } from "../research/invariants";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const P8: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "never", weekIters: 20000 } };
const real = (t: E.TeamWeek) => ({ a: Float64Array.from(t.games.map((g) => g.actual)), p: Uint8Array.from(t.games.map(() => 1)) });
const check = (t: E.TeamWeek, pol = P8) => runChecked(t, pol, E.buildEvents(t, true), real(t).a, real(t).p);
const legal = (r: ReturnType<typeof check>) => Object.keys(r.rep.counts).filter((k) => k.startsWith("L_"));

test("P8 obeys every rule on varied weeks (and the recount equals the engine total)", () => {
  const r = E.rng(4);
  const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  for (let trial = 0; trial < 12; trial++) {
    const n = 10 + Math.floor(r() * 6);
    const t = tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: n }, () => ({
      pos: POS[Math.floor(r() * POS.length)],
      games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.5).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })),
    })));
    for (const resolve of ["never", "tip"] as const) {
      const res = check(t, { ...P8, index: { ...P8.index!, resolve, iters: 500 } });
      assert.deepEqual(legal(res), [], JSON.stringify(res.rep.examples));
      assert.equal(res.total, res.trackerTotal);
    }
  }
});

test("P8 keeps holding a good score and sits tonight's weak player when the prices say so", () => {
  // one UTIL slot. A holds 30 from Monday and plays again Saturday (proj 25); B tips Wednesday (proj 8, final game).
  // Holding A (and locking or replacing him Saturday) is worth far more than B's game: B sits, A keeps the slot.
  const t = tw(["UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 30 }, { tip: T0 + 120 * H, mu: 25 }] },
    { pos: ["PG"], games: [{ tip: T0 + 48 * H, mu: 8 }] },
  ]);
  const st = E.initState(t); E.simulate(t, P8, E.buildEvents(t, true), real(t).a, real(t).p, st, 0, undefined, T0 + 48 * H);
  assert.equal(st.pendingX[0], 30, "A still holds 30 after Wednesday's tip-off"); assert.equal(st.started[t.byPlayer[1][0]], 0, "B sat");
  // the old rule (holdYield) had to lock or release A on Wednesday
  const old: E.Policy = { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true };
  const s2 = E.initState(t); E.simulate(t, old, E.buildEvents(t, true), real(t).a, real(t).p, s2, 0, undefined, T0 + 48 * H);
  assert.ok(Number.isNaN(s2.pendingX[0]), "P2LAH: A no longer holds on Wednesday");
});

test("P8 decides deadline lock-or-play and tonight's starts jointly", () => {
  // one UTIL slot. A holds 45 and tips again Thursday (proj 20): locking 45 beats playing; B (proj 30) also tips
  // Thursday but the slot is A's. With a modest held score (12) A plays instead of locking.
  const mk = (x: number) => tw(["UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 20, actual: x }, { tip: T0 + 72 * H, mu: 20 }] },
    { pos: ["PG"], games: [{ tip: T0 + 72 * H, mu: 30 }] },
  ]);
  const at = (t: E.TeamWeek) => { const st = E.initState(t); const ev = E.buildEvents(t, true); E.simulate(t, P8, ev, real(t).a, real(t).p, st, 0, undefined, T0 + 72 * H - 1); return indexContext(t, P8, st, ev.find((e) => e.kind === 2 && e.t === T0 + 72 * H)!)!.best; };
  const hi = at(mk(45)); assert.equal(hi.locks.get(0), 0); assert.equal(hi.starts.size, 0);
  const lo = at(mk(12)); assert.equal(lo.locks.size, 0); assert.equal(lo.starts.get(1), 0, "the 30-proj player gets the slot");
});

test("P8 assignment is the exact max-weight matching (vs brute force)", () => {
  const r = E.rng(8);
  for (let trial = 0; trial < 30; trial++) {
    const t = tw(["PG", "G", "F", "UTIL"], Array.from({ length: 6 }, (_, i) => ({ pos: [["PG"], ["SG"], ["PG", "SG"], ["SF", "PF"], ["C"]][i % 5], games: [{ tip: T0 + (i % 2) * H, mu: 5 + Math.round(r() * 35) }] })));
    const st = E.initState(t); const ev = E.buildEvents(t, true).find((e) => e.kind === 2)!;
    const ctx = indexContext(t, P8, st, ev)!;
    let best = 0; const rec = (i: number, used: number, v: number) => { if (i === ctx.cands.length) { best = Math.max(best, v); return; } rec(i + 1, used, v); ctx.cands[i].w.forEach((w, s) => { if (w > -Infinity && !(used & (1 << s))) rec(i + 1, used | (1 << s), v + w); }); };
    rec(0, 0, 0);
    assert.ok(Math.abs(ctx.bestScore - best) < 1e-9, `${ctx.bestScore} vs ${best}`);
  }
});

test("P8 simulations are repeatable: same inputs give identical totals regardless of call order", () => {
  // two team-weeks, model scenarios simulated from a mid-week state (as the live app / research/p10cmp.ts do) and from
  // event 0, in different orders and interleaved with the other team; P8 (re-solve every tip-off), P8f, P8f "fresh"
  const r = E.rng(11); const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  const mk = () => tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: 13 }, () => ({
    pos: POS[Math.floor(r() * POS.length)], games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.55).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30) })) })));
  const teams = [mk(), mk()].map((t) => {
    const ev = E.buildEvents(t, true); const base = { actual: real(t).a, played: real(t).p };
    const sc = [0, 1, 2, 3].map((k) => E.sampleScenario(t, null, -Infinity, E.rng(100 + k), base));
    // the mid-week state: P8 on scenario 0 until Thursday (computed once; later runs start from a copy of it)
    const pre = E.simulate(t, P8, ev, sc[0].actual, sc[0].played, E.initState(t), 0, undefined, T0 + 72 * H - 1);
    return { t, ev, sc, st: E.cloneState(pre.st), i: pre.evIdx };
  });
  const pols: E.Policy[] = [
    { ...P8, index: { resolve: "tip", iters: 60, weekIters: 20000 } },
    { ...P8, index: { resolve: "info", iters: 30, weekIters: 20000 } },
    { ...P8, index: { resolve: "info", iters: 30, weekIters: 20000, slot: "sim", fresh: true } },
  ];
  for (const pol of pols) for (const mid of [true, false]) {
    const run = (j: number, k: number) => { const T = teams[j]; return E.simulate(T.t, pol, T.ev, T.sc[k].actual, T.sc[k].played, mid ? E.cloneState(T.st) : E.initState(T.t), mid ? T.i : 0).total; };
    const a = [0, 1, 2, 3].map((k) => run(0, k));
    const again = [0, 1, 2, 3].map((k) => run(0, k));
    const rev = [3, 2, 1, 0].map((k) => run(0, k)).reverse();
    const inter = [0, 1, 2, 3].map((k) => (run(1, 3 - k), run(0, k)));
    const tag = `${pol.index!.resolve}${pol.index!.fresh ? " fresh" : ""} ${mid ? "mid-week" : "event 0"}`;
    assert.deepEqual(again, a, tag); assert.deepEqual(rev, a, tag); assert.deepEqual(inter, a, tag);
  }
  // a run stepped in chunks (the same State object resumed where it stopped) equals the run in one go
  const T = teams[0]; const pol = pols[0];
  const whole = E.simulate(T.t, pol, T.ev, T.sc[1].actual, T.sc[1].played, E.initState(T.t), 0).total;
  let st = E.initState(T.t), i = 0;
  for (let d = 1; d <= 7; d++) { const res = E.simulate(T.t, pol, T.ev, T.sc[1].actual, T.sc[1].played, st, i, undefined, T0 + d * 24 * H); st = res.st; i = res.evIdx; }
  assert.equal(E.simulate(T.t, pol, T.ev, T.sc[1].actual, T.sc[1].played, st, i).total, whole);
});
