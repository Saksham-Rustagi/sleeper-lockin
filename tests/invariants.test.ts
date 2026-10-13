import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import { reach, placeAll, runChecked } from "../research/invariants";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
const POL: E.Policy = { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true };
const check = (t: E.TeamWeek, hooks?: E.Hooks, pol = POL) => runChecked(t, pol, E.buildEvents(t, true), Float64Array.from(t.games.map((g) => g.actual)), Uint8Array.from(t.games.map(() => 1)), hooks);
const legal = (r: ReturnType<typeof check>) => Object.keys(r.rep.counts).filter((k) => k.startsWith("L_"));

test("reachability: swaps and moves via an empty slot; a 3-cycle with no spare slot is unreachable", () => {
  // eligibility a,b,c bits: slot0 {a,c}, slot1 {a,b}, slot2 {b,c}; p0=a at slot0 -> slot1, p1=b slot1 -> slot2, p2=c slot2 -> slot0
  const slots = [5, 3, 6], pm = [1, 2, 4];
  const goal = (a: Int8Array) => a[0] === 1 && a[1] === 2 && a[2] === 0;
  assert.equal(reach(slots, pm, 0b111, [0, 1, 2], [0, 1, 2], goal), null, "no pairwise swap is legal, no empty slot");
  const r = reach([...slots, 7], pm, 0b1111, [0, 1, 2], [0, 1, 2], goal);
  assert.ok(r && r !== "capped" && r.moves === 4, "with a spare slot: park one, rotate, return");
  // a frozen (locked / in-game) spare slot doesn't help
  assert.equal(reach([...slots, 7], pm, 0b0111, [0, 1, 2], [0, 1, 2], goal), null);
  // plain swap of two players eligible for each other's slots
  const s2 = reach([3, 3], [3, 3], 0b11, [0, 1], [0, 1], (a) => a[0] === 1 && a[1] === 0);
  assert.ok(s2 && s2 !== "capped" && s2.moves === 1);
  assert.ok(placeAll(slots, pm, 0b111, [0, 1, 2]));
  assert.equal(placeAll([1, 1], [1, 1, 1], 0b11, [0, 1, 2]), null);
});

test("engine weeks pass every rule check and the recount equals the engine total", () => {
  const weeks = [
    // slot reuse the same night, holding while a teammate plays, crowded night, final-game auto-count
    tw(["C"], [{ pos: ["C"], games: [{ tip: T0, mu: 20, actual: 10 }] }, { pos: ["C"], games: [{ tip: T0 + 3 * H, mu: 20, actual: 35 }] }]),
    tw(["UTIL", "UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 30 }, { tip: T0 + 96 * H, mu: 25, actual: 10 }] }, { pos: ["PG"], games: [{ tip: T0 + 24 * H, mu: 20, actual: 22 }] }]),
    tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 35 }, { tip: T0 + 72 * H, mu: 20, actual: 15 }] }, { pos: ["PG"], games: [{ tip: T0 + 24 * H, mu: 20, actual: 40 }] }]),
    tw(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"], Array.from({ length: 12 }, (_, i) => ({
      pos: [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]][i % 8],
      games: [0, 1, 2].map((d) => ({ tip: T0 + (d * 2 + (i % 3)) * 24 * H + (i % 4) * H, mu: 15 + ((i * 7) % 20), actual: 5 + ((i * 13 + d * 17) % 40) })),
    }))),
  ];
  for (const t of weeks) {
    const r = check(t);
    assert.deepEqual(legal(r), [], JSON.stringify(r.rep.examples));
    assert.equal(r.total, r.trackerTotal);
    const plain = E.simulate(t, POL, E.buildEvents(t, true), Float64Array.from(t.games.map((g) => g.actual)), Uint8Array.from(t.games.map(() => 1))).total;
    assert.equal(r.total, plain, "observing the engine must not change it");
  }
});

// (ineligible / stranding locks and week-end accounting: tests/fixes.test.ts, with the legacy flags)
test("illegal hook decisions are caught: start into an occupied slot, idle benching", () => {
  // two players tip together; a hook seats the second in the slot the first already occupies
  const t2 = tw(["UTIL", "UTIL"], [{ pos: ["C"], games: [{ tip: T0, mu: 20 }] }, { pos: ["C"], games: [{ tip: T0, mu: 19 }] }]);
  const r2 = check(t2, { decideStarts: () => new Map([[0, 0], [1, 0]]) });
  assert.ok(r2.rep.counts.L_start_bad_slot >= 1, JSON.stringify(r2.rep.counts));
  // a hook sits the only player of the night although nobody else could ever use the slot during his game
  const t3 = tw(["UTIL"], [{ pos: ["C"], games: [{ tip: T0, mu: 20, actual: 30 }] }, { pos: ["PG"], games: [{ tip: T0 + 48 * H, mu: 20 }] }]);
  const r3 = check(t3, { decideStarts: (_st, t) => (t === T0 ? new Map() : undefined) });
  assert.equal(r3.rep.counts.S_idle_bench_exante, 1, JSON.stringify(r3.rep.counts));
});
