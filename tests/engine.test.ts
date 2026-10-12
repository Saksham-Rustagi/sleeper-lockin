import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import * as E from "../lib/engine/core";
import { fantasyPoints, gameDist, injuryPlayProb } from "../lib/engine/model";
import { hungarianAlgorithm } from "../lib/matching";
import { validateWeekData } from "../lib/validation";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const POL: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true };
const run = (t: E.TeamWeek, pol = POL) => E.simulate(t, pol, E.buildEvents(t, pol.chain), Float64Array.from(t.games.map((g) => g.actual)), Uint8Array.from(t.games.map(() => 1)));

test("exact assignment matches brute force (vertex-weighted, positions)", () => {
  const slots = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"].map((s) => E.SLOT_MASK[s]);
  const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
  const r = E.rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const n = 4 + Math.floor(r() * 8);
    const pm = Array.from({ length: n }, () => E.posMask(POS[Math.floor(r() * POS.length)]));
    const w = Array.from({ length: n }, () => Math.round(r() * 40));
    const fast = E.assignExact(slots, (1 << 9) - 1, [...Array(n).keys()], pm, w).total;
    let best = 0;
    const rec = (i: number, used: number, tot: number) => {
      if (i === n) { best = Math.max(best, tot); return; }
      rec(i + 1, used, tot);
      for (let s = 0; s < 9; s++) if (!(used & (1 << s)) && (slots[s] & pm[i])) rec(i + 1, used | (1 << s), tot + w[i]);
    };
    rec(0, 0, 0);
    assert.equal(fast, best);
  }
});

test("legacy matrix matcher is exact (was greedy)", () => {
  // greedy would put the flexible 30-pt player in C and leave the C-only player unassigned
  const W = [[30, 30], [-Infinity, 25]]; // rows players, cols [UTIL, C]
  const a = hungarianAlgorithm(W);
  assert.deepEqual(a, [0, 1]);
});

test("a slot is reused the same night when games don't overlap", () => {
  const t = tw(["C"], [{ pos: ["C"], games: [{ tip: T0, mu: 20, actual: 10 }] }, { pos: ["C"], games: [{ tip: T0 + 3 * H, mu: 20, actual: 35 }] }]);
  const res = run(t);
  assert.equal(res.total, 35); // passed on the 10, started the late game in the same slot
});

test("overlapping games compete for one slot", () => {
  const t = tw(["C"], [{ pos: ["C"], games: [{ tip: T0, mu: 25, actual: 25 }] }, { pos: ["C"], games: [{ tip: T0 + 1 * H, mu: 20, actual: 40 }] }]);
  const res = run(t);
  assert.equal(res.total, 25); // the 8pm player could not be started while the 7pm game was in progress
});

test("an unlocked starter's final game counts at week end", () => {
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 7 }] }]);
  assert.equal(run(t).total, 7);
});

test("locks a big score, passes on a bad one when good games remain", () => {
  const big = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 45 }, { tip: T0 + 48 * H, mu: 20, actual: 5 }] }]);
  assert.equal(run(big).total, 45);
  const bad = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 4 }, { tip: T0 + 48 * H, mu: 25, actual: 30 }] }]);
  assert.equal(run(bad).total, 30);
});

test("benching a held player forfeits his game", () => {
  // P0 scores 15 then has no more games; P1 (better) plays later in the only slot -> P0 must be benched, his 15 is gone
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 15, actual: 15 }] }, { pos: ["SF"], games: [{ tip: T0 + 24 * H, mu: 30, actual: 12 }] }]);
  const res = run(t);
  assert.ok(res.total === 15 || res.total === 12);
  assert.notEqual(res.total, 27);
});

test("league scoring + model helpers", () => {
  const S = { pts: 1, reb: 1, ast: 1, stl: 3, blk: 3, to: -1, fga: -1, fgm: 1, ftmi: -1, tpm: 0.5, dd: 2 };
  assert.equal(fantasyPoints({ pts: 20, reb: 10, ast: 2, stl: 1, blk: 2, to: 3, fga: 15, fgm: 8, ftmi: 1, tpm: 2, dd: 1 }, S), 20 + 10 + 2 + 3 + 6 - 3 - 15 + 8 - 1 + 1 + 2);
  assert.ok(gameDist(25).mu < 25 && gameDist(25).sd > 8);
  assert.equal(injuryPlayProb("Out"), 0.03);
  assert.equal(injuryPlayProb(null), null);
});

test("weekly JSON with duplicate UTIL slots (UTIL_2) validates", () => {
  const p = __dirname + "/../export-2025-10-13.json";
  if (!fs.existsSync(p)) return;
  const r = validateWeekData(JSON.parse(fs.readFileSync(p, "utf8")));
  assert.ok(r.success, r.success ? "" : r.error.message);
});
