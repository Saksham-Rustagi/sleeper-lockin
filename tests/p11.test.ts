// P11 (playing for the win) and the human opponent model: the smoothed opponent CDF, the risk dial's sign and monotone
// shape, P11 = P10 exactly when beta = 0, the monotone risk response of the complete policy on a lock-or-gamble decision,
// legality of every P11 decision (invariant checker), and the human model's bookkeeping.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import * as Hm from "../lib/engine/human";
import { p10Hooks } from "../lib/engine/p10";
import { p11Hooks, riskTilt, dialTilt, betaAt, phaseStart, type OppSource } from "../lib/engine/p11";
import { runChecked } from "../research/invariants";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; sd?: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: g.sd ?? 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const P8: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100, weekIters: 5000 } };
const BASE: E.Policy = { ...P8, name: "base", index: { resolve: "info", iters: 30, weekIters: 5000, slot: "roll" } };
const real = (t: E.TeamWeek) => ({ actual: Float64Array.from(t.games.map((g) => g.actual)), played: Uint8Array.from(t.games.map(() => 1)) });
const QUICK = { kMin: 16, batch: 16, kMax: 48 };
const normalOpp = (m: number, sd: number, n = 400): Hm.OppDist => { const r = E.rng(5); return Hm.oppDist(Array.from({ length: n }, () => m + sd * Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r()))); };

test("opponent CDF: smoothed, monotone, centred; the risk dial is >0 behind, <0 ahead, ~0 when decided, capped", () => {
  const D = normalOpp(250, 30);
  let prev = -1; for (let x = 100; x <= 400; x += 2.5) { const f = D.F(x); assert.ok(f >= prev - 1e-12 && f >= 0 && f <= 1); prev = f; }
  assert.ok(Math.abs(D.F(D.mean) - 0.5) < 0.05, `F(mean) = ${D.F(D.mean)}`); assert.equal(D.F(0), 0); assert.equal(D.F(1000), 1);
  const beta = 300, sd = 20; const g = (m: number) => dialTilt(m, sd, D, beta); // (the policy's dial: 0 below 0.001)
  assert.ok(g(220) > 0 && g(200) > 0, "behind: risk-seeking"); assert.ok(g(280) < 0 && g(300) < 0, "ahead: risk-averse");
  // the manager's invariant: far ahead never more risk than close, hopelessly behind never less than close
  const close = g(D.mean);
  assert.equal(close, 0, `close: neutral (${riskTilt(D.mean, sd, D, beta)})`);
  for (const far of [320, 360, 420]) assert.ok(g(far) <= close + 1e-12, `far ahead (${far}): ${g(far)} <= ${close}`);
  for (const hope of [180, 120, 50]) assert.ok(g(hope) >= close - 1e-12, `hopeless (${hope}): ${g(hope)} >= ${close}`);
  // sign-monotone along the margin, capped
  for (let m = 100; m <= 400; m += 5) { const v = riskTilt(m, sd, D, beta); assert.ok(Math.abs(v) <= 0.05 + 1e-12); if (m < D.mean - 5) assert.ok(v >= 0, `${m}`); if (m > D.mean + 5) assert.ok(v <= 0, `${m}`); }
  assert.ok(Math.abs(riskTilt(250, 20, D, 0)) < 1e-12, "beta = 0: no tilt");
});

test("phase-in schedules: late = the last 3 game days, ramp = linear in game days, const = all week", () => {
  const t = tw(["UTIL"], [{ pos: ["PG"], games: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ tip: T0 + d * 24 * H, mu: 20 })) }]);
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => T0 + d * 24 * H);
  assert.deepEqual(days.map((x) => betaAt(t, x, { beta: 300 })), [0, 0, 0, 0, 300, 300, 300]);
  assert.deepEqual(days.map((x) => betaAt(t, x, { beta: 300, sched: "ramp" })), [0, 50, 100, 150, 200, 250, 300]);
  assert.deepEqual(days.map((x) => betaAt(t, x, { beta: 300, sched: "const" })), days.map(() => 300));
  assert.equal(phaseStart(t, { beta: 300 }), days[4]); assert.equal(phaseStart(t, { beta: 0 }), Infinity);
});

test("P11 with beta = 0 (or before its phase-in) is exactly P10", () => {
  const r = E.rng(3); const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  const t = tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: 10 }, () => ({
    pos: POS[Math.floor(r() * POS.length)],
    games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.5).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })),
  })));
  const ev = E.buildEvents(t, true); const opp: OppSource = { dist: () => normalOpp(250, 30) };
  const a = E.simulate(t, P8, ev, real(t).actual, real(t).played, E.initState(t), 0, p10Hooks(t, BASE, ev, 9, real(t), QUICK)).total;
  const b = E.simulate(t, P8, ev, real(t).actual, real(t).played, E.initState(t), 0, p11Hooks(t, P8, BASE, ev, 9, real(t), opp, { ...QUICK, beta: 0 })).total;
  assert.equal(b, a);
  // a run whose phase-in starts on the last day equals P10 up to the moment before it
  const tB = phaseStart(t, { beta: 300, lateDays: 1 });
  const st1 = E.initState(t), st2 = E.initState(t);
  E.simulate(t, P8, ev, real(t).actual, real(t).played, st1, 0, p10Hooks(t, BASE, ev, 9, real(t), QUICK), tB - 1);
  E.simulate(t, P8, ev, real(t).actual, real(t).played, st2, 0, p11Hooks(t, P8, BASE, ev, 9, real(t), opp, { ...QUICK, beta: 300, lateDays: 1 }), tB - 1);
  assert.deepEqual([...st2.pendingX].map(String), [...st1.pendingX].map(String)); assert.deepEqual([...st2.lockedBy], [...st1.lockedBy]); assert.deepEqual([...st2.lockedPts], [...st1.lockedPts]);
});

test("monotone risk response: lock a sure 22 or gamble on a final game (mean 20, sd 12), by the opponent's level", () => {
  // one UTIL slot; A scored 22 on Monday and plays his final game Tuesday: lock 22 (safe) or play (risky). P8 locks.
  const t = tw(["UTIL"], [{ pos: ["PG"], games: [{ tip: T0, mu: 20, sd: 12, actual: 22 }, { tip: T0 + 24 * H, mu: 20, sd: 12, actual: 20 }] }]);
  const ev = E.buildEvents(t, true);
  const choice = (oppMean: number, beta: number) => {
    const opp: OppSource = { dist: () => normalOpp(oppMean, 3) };
    const st = E.initState(t);
    E.simulate(t, P8, ev, real(t).actual, real(t).played, st, 0, p11Hooks(t, P8, BASE, ev, 21, real(t), opp, { ...QUICK, beta, sched: "const" }), T0 + 24 * H + 1);
    return st.isLocked[0] ? "lock" : "play";
  };
  assert.equal(choice(32, 0), "lock", "points: lock the 22");
  const res = { far: choice(5, 300), close: choice(22, 300), behind: choice(32, 300), hopeless: choice(150, 300) };
  assert.equal(res.far, "lock", "far ahead: secure");
  assert.equal(res.behind, "play", "behind by 10 with one game left: gamble for the ceiling");
  assert.equal(res.hopeless, "lock", "nothing left to win: points (the tiebreaker) decide");
  const risk = (c: string) => (c === "play" ? 1 : 0);
  assert.ok(risk(res.far) <= risk(res.close), "far ahead never takes more risk than close");
  assert.ok(risk(res.hopeless) >= risk(res.close), "hopelessly behind never takes less risk than close");
});

test("every P11 decision is legal: invariant checker on random weeks, opponent close / far ahead / far behind", () => {
  const r = E.rng(17); const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  for (let trial = 0; trial < 3; trial++) {
    const t = tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: 10 }, () => ({
      pos: POS[Math.floor(r() * POS.length)],
      games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.5).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })),
    })));
    const ev = E.buildEvents(t, true); const opp: OppSource = { dist: () => normalOpp([200, 120, 320][trial], 25) };
    const h = p11Hooks(t, P8, BASE, ev, 5, real(t), opp, { ...QUICK, beta: 300, sched: "const" });
    const res = runChecked(t, P8, ev, real(t).actual, real(t).played, h);
    assert.deepEqual(Object.keys(res.rep.counts).filter((k) => k.startsWith("L_")), [], JSON.stringify(res.rep.examples));
    for (const k of ["S_forfeit_unforced", "S_idle_bench_exante"]) assert.equal(res.rep.counts[k] ?? 0, 0, `${k}: ${JSON.stringify(res.rep.examples[k])}`);
    assert.equal(res.total, res.trackerTotal);
    assert.ok(h.stats.win.decisions > 0);
  }
});

test("human model: week-end total = locked + held occupants; locks consistent; snapshots continue the same week", () => {
  const r = E.rng(29); const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  const t = tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: 14 }, () => ({
    pos: POS[Math.floor(r() * POS.length)],
    games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.55).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })),
  })));
  const re = real(t);
  for (let k = 0; k < 30; k++) {
    const rr = E.rng(100 + k); const hs = Hm.initHuman(t, { ...Hm.HUMAN, engA: 3, engB: 1 }, rr);
    const res = Hm.simulateHuman(t, Hm.HUMAN, hs, re.actual, re.played, rr);
    const slots = Hm.humanSlots(hs); assert.ok(Math.abs(slots.reduce((a, [x]) => a + x, 0) - res.total) < 1e-9);
    for (let s = 0; s < t.slots.length; s++) {
      if (!hs.locked[s]) continue; const p = hs.occ[s];
      assert.ok(p >= 0 && hs.isLocked[p] && (t.slots[s] & t.pmask[p]), "a locked slot holds an eligible locked player");
      assert.equal(t.games[hs.lockGame[s]].p, p); assert.equal(hs.pts[s], re.actual[hs.lockGame[s]], "the locked points are his game's");
    }
    assert.equal(new Set(Array.from(hs.occ).filter((p) => p >= 0)).size, Array.from(hs.occ).filter((p) => p >= 0).length, "nobody in two slots");
  }
  // stepping event by event equals one run (same random stream)
  const r1 = E.rng(7), r2 = E.rng(7); const a = Hm.initHuman(t, Hm.HUMAN, r1), b = Hm.initHuman(t, Hm.HUMAN, r2);
  const ta = Hm.simulateHuman(t, Hm.HUMAN, a, re.actual, re.played, r1).total;
  const n = Hm.humanWeek(t).ev.length; for (let i = 0; i < n; i++) Hm.simulateHuman(t, Hm.HUMAN, b, re.actual, re.played, r2, i, Infinity, i + 1);
  assert.equal(Hm.humanTotal(b), ta);
  // the opponent distribution from a known final state is that total (+ residual 0 once nothing remains)
  const D = Hm.oppDist(Hm.oppSamples(t, Hm.HUMAN, b, n, Infinity, re, 50, E.rng(1)));
  assert.ok(Math.abs(D.mean - ta) < 1e-9 && D.sd === 0);
});
