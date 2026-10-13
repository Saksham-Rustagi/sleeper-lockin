import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import * as L from "../lib/engine/lagrange";
import { bruteForce, randInst } from "../research/bruteforce";

const H = 3600e3;

test("lagrangian bound >= brute-force optimum on tiny weeks, and reasonably tight", () => {
  const r = E.rng(11); let sumGap = 0, sumOpt = 0, n = 0, worst = 0;
  for (let trial = 0; trial < 60; trial++) {
    const inst = randInst(r);
    const opt = bruteForce(inst);
    const b = L.minimizeBound(inst, { iters: 6000 });
    assert.ok(b.bound >= opt - 1e-6, `trial ${trial}: bound ${b.bound} < optimum ${opt}`);
    assert.ok(b.bound <= b.free + 1e-9);
    sumGap += b.bound - opt; sumOpt += opt; n++; worst = Math.max(worst, (b.bound - opt) / Math.max(1, opt));
  }
  // tight-ish: on average within 6% of the true optimum
  if (process.env.LAG_VERBOSE) console.log(`avg gap ${(sumGap / n).toFixed(3)} pts, ${(100 * sumGap / sumOpt).toFixed(2)}% of optimum; worst ${(100 * worst).toFixed(1)}%`);
  assert.ok(sumGap / sumOpt < 0.06, `average relative gap ${(sumGap / sumOpt).toFixed(3)} (worst ${worst.toFixed(3)})`);
});

test("lagrangian bound is exact for one slot and two sequential players (lock-or-wait)", () => {
  // A plays Monday (0 or 40), B plays Tuesday (20). Optimal: start A, keep the 40, else start B => 0.5*40 + 0.5*20 = 30
  const inst: L.LInstance = {
    slots: [E.SLOT_MASK.UTIL], pmask: [31, 31], lastPlayed0: [1, 1], dnp: { p1: 1, p0: 1 },
    games: [
      { p: 0, tip: 0, end: 2.5 * H, dist: { kind: "discrete", x: [0, 40], w: [0.5, 0.5] } },
      { p: 1, tip: 24 * H, end: 26.5 * H, dist: { kind: "discrete", x: [20], w: [1] } },
    ],
  };
  assert.equal(bruteForce(inst), 30);
  const b = L.minimizeBound(inst, { iters: 4000 });
  assert.ok(Math.abs(b.bound - 30) < 1e-3, `bound ${b.bound}`);
});

test("no contention: the bound is the exact single-player DP (= stopValue without DNP; = brute force with the DNP chain)", () => {
  // as many UTIL slots as players: the optimal mu is 0 and each player is the exact single-player DP
  const players = [[30, 25, 28], [18, 22], [40]];
  const games: E.Game[] = []; players.forEach((ms, p) => ms.forEach((mu, k) => games.push({ p, tip: (k * 24 + p) * H, end: (k * 24 + p + 2.5) * H, mu, sd: 8, projRaw: mu, actual: mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  const tw: E.TeamWeek = { slots: players.map(() => 31), slotNames: players.map(() => "UTIL"), pmask: players.map(() => 31), names: ["a", "b", "c"], games, byPlayer, lastPlayed0: [1, 0, 1], dnp: { p1: 1, p0: 1 } };
  const b = L.minimizeBound(L.fromTeamWeek(tw), { iters: 200 });
  const sv = players.reduce((s, _, p) => s + E.stopValue(tw, p, 0, tw.lastPlayed0[p]), 0);
  // stopValue ignores the -5 clamp and can't bench a negative final game: negligible at these means
  assert.ok(Math.abs(b.bound - sv) < 0.01, `bound ${b.bound} vs stop values ${sv}`);
  // with the DNP chain (observed before the next game) vs brute force on discrete scores, one UTIL slot per player.
  // (stopValue uses unconditional play marginals for later games, so it is not the exact DP when DNP is possible.)
  const r = E.rng(9);
  for (let trial = 0; trial < 20; trial++) {
    const inst = randInst(r); inst.slots = inst.pmask.map(() => 31);
    const opt = bruteForce(inst); const bb = L.minimizeBound(inst, { iters: 50 });
    assert.ok(Math.abs(bb.bound - opt) < 1e-9 && Math.abs(bb.free - opt) < 1e-9, `trial ${trial}: ${bb.bound} vs ${opt}`);
  }
});

test("subgradient: d bound / d mu = 1 - expected occupancy (finite differences)", () => {
  const r = E.rng(5); const inst = randInst(r);
  const P = L.prepare(inst); const mu = new Float64Array(P.nS * P.B).map(() => r() * 5);
  const ev = L.evaluate(P, mu);
  // finite-difference check of d bound / d mu = 1 - occ on a few coordinates (bound is piecewise smooth)
  for (let i = 0; i < mu.length; i += Math.max(1, Math.floor(mu.length / 7))) {
    const h = 1e-5; const m2 = mu.slice(); m2[i] += h;
    const fd = (L.evaluate(P, m2).bound - ev.bound) / h;
    assert.ok(Math.abs(fd - (1 - ev.occ[i])) < 1e-3, `coord ${i}: fd ${fd} vs ${1 - ev.occ[i]}`);
  }
});
