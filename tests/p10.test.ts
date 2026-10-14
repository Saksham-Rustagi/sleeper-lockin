// P10 (one complete decision per tip-off, raced rollouts): legality of every candidate, dominance repair, racing, and the
// known pathological cases of the older policies.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import { indexContext, type IndexDecision } from "../lib/engine/p8";
import { candidates, decisionProblem, repair, race, p10Hooks, decisionKey } from "../lib/engine/p10";
import { runChecked } from "../research/invariants";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const P8: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 300, weekIters: 20000 } };
const BASE: E.Policy = { ...P8, name: "base", index: { resolve: "never", weekIters: 20000, slot: "roll" } };
const real = (t: E.TeamWeek) => ({ actual: Float64Array.from(t.games.map((g) => g.actual)), played: Uint8Array.from(t.games.map(() => 1)) });
const QUICK = { kMin: 16, batch: 16, kMax: 48 };
const hooks = (t: E.TeamWeek, ev: E.Ev[], o = QUICK) => p10Hooks(t, BASE, ev, 7, real(t), o);
const run = (t: E.TeamWeek, toTime = Infinity) => { const ev = E.buildEvents(t, true); const st = E.initState(t); const r = E.simulate(t, P8, ev, real(t).actual, real(t).played, st, 0, hooks(t, ev), toTime); return { st, total: r.total }; };
// the state just before the tip-off at time tt, and the P8 context there
function at(t: E.TeamWeek, tt: number) {
  const ev = E.buildEvents(t, true); const st = E.initState(t);
  E.simulate(t, P8, ev, real(t).actual, real(t).played, st, 0, undefined, tt - 1);
  const i = ev.findIndex((e) => e.kind === 2 && e.t === tt); const ctx = indexContext(t, P8, st, ev[i])!;
  return { ev, st, e: ev[i], ctx };
}

test("race: picks a clearly better challenger, drops clearly worse ones early, keeps the incumbent on ties", () => {
  const gen = (mus: number[], sd: number, seed: number) => {
    const r = E.rng(seed); const z = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    const seen: number[][] = mus.map(() => []);
    const fn = (alive: number[], k0: number, n: number) => { const out = alive.map(() => [] as number[]); for (let k = 0; k < n; k++) { const common = 40 * z(); alive.forEach((c, j) => { out[j].push(common + mus[c] + sd * z()); seen[c].push(k0 + k); }); } return out; };
    return { fn, seen };
  };
  const a = gen([0, 3, -6, 2.2], 2, 1); const ra = race(4, a.fn);
  assert.equal(ra.pick, 1, "the +3 challenger wins"); assert.ok(a.seen[2].length < ra.k, `the -6 one was dropped before the end (${a.seen[2].length} vs ${ra.k})`);
  const b = gen([0, -3, -4], 2, 2); const rb = race(3, b.fn);
  assert.equal(rb.pick, 0); assert.equal(rb.k, 32, "stops at kMin: nobody can beat the incumbent");
  const c = gen([0, 0, 0], 2, 3); const rc = race(3, c.fn, { kMax: 128 });
  assert.equal(rc.pick, 0, "no switch on a tie"); assert.ok(rc.k <= 128);
});

test("decisionProblem catches illegal decisions and unreachable rearrangements", () => {
  // slots PG, SG, SF; A (PG/SG) in PG, B (SG/SF) in SG, C (PG/SF) in SF all hold scores; D (C) tips now.
  // Rotating A->SG, B->SF, C->PG is eligible but unreachable (no pair can swap, no slot is empty).
  const mk = (slots: string[]) => tw(slots, [
    { pos: ["PG", "SG"], games: [{ tip: T0, mu: 10 }] }, { pos: ["SG", "SF"], games: [{ tip: T0, mu: 10 }] },
    { pos: ["PG", "SF"], games: [{ tip: T0, mu: 10 }] }, { pos: ["C"], games: [{ tip: T0 + 24 * H, mu: 10 }] },
  ]);
  const t = mk(["PG", "SG", "SF"]); const st = E.initState(t);
  [0, 1, 2].forEach((p) => { st.pendingX[p] = 10; st.lastSlot[p] = p; });
  const e: E.Ev = { t: T0 + 24 * H, kind: 2, g: 3, group: [3] };
  const D = (h: [number, number][], s: [number, number][] = [], l: [number, number][] = []): IndexDecision => ({ holds: new Map(h), starts: new Map(s), locks: new Map(l) });
  assert.equal(decisionProblem(t, st, e, D([[0, 0], [1, 1], [2, 2]])), null);
  assert.match(decisionProblem(t, st, e, D([[0, 1], [1, 2], [2, 0]]))!, /not reachable/);
  assert.match(decisionProblem(t, st, e, D([[0, 0], [1, 1]], [[3, 2]]))!, /ineligible/);
  assert.match(decisionProblem(t, st, e, D([[0, 1], [1, 1]]))!, /twice/);
  assert.match(decisionProblem(t, st, e, D([], [[0, 0]]))!, /does not tip/);
  assert.match(decisionProblem(t, st, e, D([[3, 0]]))!, /holds no score/);
  st.lockedBy[2] = 9; assert.match(decisionProblem(t, st, e, D([[0, 0], [1, 1]], [], [[2, 2]]))!, /locked or in a game/);
  // with a spare UTIL slot the rotation is reachable (4 moves)
  const t2 = mk(["PG", "SG", "SF", "UTIL"]); const st2 = E.initState(t2); [0, 1, 2].forEach((p) => { st2.pendingX[p] = 10; st2.lastSlot[p] = p; });
  assert.equal(decisionProblem(t2, st2, e, D([[0, 1], [1, 2], [2, 0]])), null);
  // a held player can't hold through his own tip-off
  const e0: E.Ev = { t: T0, kind: 2, g: 0, group: [0] }; const st3 = E.initState(t); st3.pendingX[0] = 5; st3.lastSlot[0] = 0;
  assert.match(decisionProblem(t, st3, e0, D([[0, 0]]))!, /own tip-off/);
});

test("repair keeps a let-go held score when a slot stays free, and starts a player sat into an idle slot", () => {
  // slots PG, UTIL. A (SF) holds 20 from Monday, plays again Saturday; B (PG) tips Wednesday, nobody else plays.
  const t = tw(["PG", "UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 20 }, { tip: T0 + 120 * H, mu: 20 }] },
    { pos: ["PG"], games: [{ tip: T0 + 48 * H, mu: 15 }] },
  ]);
  const { st, ctx } = at(t, T0 + 48 * H);
  const r = repair(t, st, ctx, { starts: new Map(), locks: new Map(), holds: new Map() });
  assert.equal(r.holds.get(0), 1, "A keeps holding in UTIL"); assert.equal(r.starts.get(1), 0, "B starts in the idle PG slot");
});

test("every P10 candidate is legal and reachable; P10 obeys every rule and makes no dominated choice", () => {
  const r = E.rng(11);
  const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  let nCands = 0;
  for (let trial = 0; trial < 6; trial++) {
    const n = 10 + Math.floor(r() * 5);
    const t = tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: n }, () => ({
      pos: POS[Math.floor(r() * POS.length)],
      games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.5).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })),
    })));
    const ev = E.buildEvents(t, true); const h = hooks(t, ev);
    const wrapped: E.Hooks = {
      decideIndex: (st, tt, evIdx, ctx) => {
        const cs = candidates(t, st, ev[evIdx], ctx); nCands += cs.length;
        assert.equal(new Set(cs.map((c) => decisionKey(c.d))).size, cs.length, "distinct candidates");
        for (const c of cs) assert.equal(decisionProblem(t, st, ev[evIdx], c.d), null, `${c.why}: ${decisionProblem(t, st, ev[evIdx], c.d)}`);
        return h.decideIndex!(st, tt, evIdx, ctx);
      },
    };
    const res = runChecked(t, P8, ev, real(t).actual, real(t).played, wrapped);
    assert.deepEqual(Object.keys(res.rep.counts).filter((k) => k.startsWith("L_")), [], JSON.stringify(res.rep.examples));
    for (const k of ["S_forfeit_unforced", "S_idle_bench_exante", "F_yield_idle"]) assert.equal(res.rep.counts[k] ?? 0, 0, `${k}: ${JSON.stringify(res.rep.examples[k])}`);
    assert.equal(res.total, res.trackerTotal);
  }
  assert.ok(nCands > 100, `alternatives were generated (${nCands})`);
});

test("holding is an evaluated option: keep a good held score and sit tonight's weak player", () => {
  // one UTIL slot. A holds 30 from Monday and plays again Saturday (proj 25); B tips Wednesday (proj 8, final game).
  const t = tw(["UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 30 }, { tip: T0 + 120 * H, mu: 25 }] },
    { pos: ["PG"], games: [{ tip: T0 + 48 * H, mu: 8 }] },
  ]);
  const { st, e, ctx } = at(t, T0 + 48 * H);
  const cs = candidates(t, st, e, ctx);
  assert.ok(cs.some((c) => c.d.holds.has(0) && !c.d.starts.has(1)), "hold A, sit B is a candidate");
  assert.ok(cs.some((c) => c.d.starts.has(1) && !c.d.holds.has(0)), "let A go, start B is a candidate");
  assert.ok(cs.some((c) => c.d.locks.has(0)), "lock A now is a candidate");
  const r = run(t, T0 + 48 * H);
  assert.equal(r.st.pendingX[0], 30, "P10 keeps holding A"); assert.equal(r.st.started[t.byPlayer[1][0]], 0, "B sat");
});

test("deadline lock-or-play and tonight's starts are one search", () => {
  // one UTIL slot. A holds x and tips again Thursday (proj 20); B (proj 30) tips Thursday too.
  const mk = (x: number) => tw(["UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 20, actual: x }, { tip: T0 + 72 * H, mu: 20 }] },
    { pos: ["PG"], games: [{ tip: T0 + 72 * H, mu: 30 }] },
  ]);
  for (const x of [45, 12]) {
    const t = mk(x); const { st, e, ctx } = at(t, T0 + 72 * H); const cs = candidates(t, st, e, ctx);
    // (alternatives more than `margin` priced points below P8's decision are not raced: playing A again at 45, locking 12)
    assert.ok(cs.some((c) => c.d.starts.get(1) === 0), `x=${x}: start B is a candidate`);
    if (x === 45) assert.ok(cs.some((c) => c.d.locks.get(0) === 0), `x=${x}: lock A is a candidate`);
    else assert.ok(cs.some((c) => c.d.starts.get(0) === 0), `x=${x}: play A again is a candidate`);
    const r = run(t);
    if (x === 45) assert.equal(r.total, 45, "a 45 is locked"); else assert.equal(r.total, 30, "B plays (his 30 counts at week end)");
  }
});

test("no 'let go at his own tip-off, then sat' while his slot would stay idle", () => {
  // one PG slot; A (PG) holds 12 and tips again Thursday; nobody else can use the slot: every candidate plays or locks him
  const t = tw(["PG"], [
    { pos: ["PG"], games: [{ tip: T0, mu: 15, actual: 12 }, { tip: T0 + 72 * H, mu: 15 }] },
    { pos: ["C"], games: [{ tip: T0 + 72 * H, mu: 30 }] },
  ]);
  const { st, e, ctx } = at(t, T0 + 72 * H);
  for (const c of candidates(t, st, e, ctx)) assert.ok(c.d.starts.has(0) || c.d.locks.has(0), `${c.why}: A neither plays nor locks`);
});
