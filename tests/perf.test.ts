// Task C: the optimised engine paths must return exactly what the original code returned.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";

// the original assignExact (commit 99f1a40): stable sort by weight + Kuhn augmenting paths in slot order
function refAssign(slots: number[], openMask: number, players: number[], pm: number[], w: ArrayLike<number>) {
  const order = players.filter((p) => w[p] > 0).sort((a, b) => w[b] - w[a]);
  const matchSlot = new Int32Array(slots.length).fill(-1); const so = E.slotOrder(slots); let total = 0;
  const visited = new Uint8Array(slots.length);
  const tryAug = (p: number): boolean => {
    for (const s of so) {
      if (!((openMask >> s) & 1) || visited[s] || !(slots[s] & pm[p])) continue;
      visited[s] = 1;
      if (matchSlot[s] < 0 || tryAug(matchSlot[s])) { matchSlot[s] = p; return true; }
    }
    return false;
  };
  for (const p of order) { visited.fill(0); if (tryAug(p)) total += w[p]; }
  const slotOf = new Map<number, number>(); matchSlot.forEach((p, s) => { if (p >= 0) slotOf.set(p, s); });
  return { total, slotOf };
}
const STD = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"].map((s) => E.SLOT_MASK[s]);
const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"], ["SG", "SF"], ["UTIL"]];

test("assignExact / assignTotal / allSeatable equal the original matcher (random, ties, partial open masks)", () => {
  const r = E.rng(11);
  for (let trial = 0; trial < 3000; trial++) {
    const odd = trial % 5 === 4; // other layouts: fewer / more slots, random masks
    const slots = odd ? Array.from({ length: 3 + Math.floor(r() * 9) }, () => 1 + Math.floor(r() * 31)) : STD;
    const n = 1 + Math.floor(r() * 20);
    const pm = Array.from({ length: n }, () => (odd ? Math.floor(r() * 32) : E.posMask(POS[Math.floor(r() * POS.length)])));
    const w = Float64Array.from({ length: n }, () => (r() < 0.2 ? 0 : r() < 0.3 ? 5 : r() < 0.1 ? -1 : r() * 40)); // zeros, ties, negatives
    const players = [...Array(n).keys()].sort(() => r() - 0.5);
    const open = Math.floor(r() * (1 << slots.length)) | (r() < 0.5 ? (1 << slots.length) - 1 : 0);
    const ref = refAssign(slots, open, players, pm, w);
    const got = E.assignExact(slots, open, players, pm, w);
    assert.equal(got.total, ref.total); assert.deepEqual([...got.slotOf], [...ref.slotOf]);
    assert.equal(E.assignTotal(slots, open, players, pm, w), ref.total);
    const ones = new Float64Array(n).fill(1);
    assert.equal(E.allSeatable(slots, open, players, pm), refAssign(slots, open, players, pm, ones).total === n);
  }
});

test("slotOrder follows an in-place change of the slots array", () => {
  const s = [16, 31, 1]; const a = E.slotOrder(s).slice();
  s[1] = 1; s[2] = 31;
  assert.notDeepEqual(E.slotOrder(s), a); assert.deepEqual(E.slotOrder(s), [0, 1, 2]);
});

test("stopValue memo is invalidated when the team-week's inputs are replaced", () => {
  const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
  const games: E.Game[] = [0, 1, 2].map((k) => ({ p: 0, tip: T0 + k * 24 * H, end: T0 + k * 24 * H + 2.5 * H, mu: 30, sd: 9, projRaw: 30, actual: 30, played: true }));
  const t: E.TeamWeek = { slots: STD, slotNames: [], pmask: [1], names: ["A"], games, byPlayer: [[0, 1, 2]], lastPlayed0: [1], dnp: { p1: 0.95, p0: 0.4 } };
  const v0 = E.stopValue(t, 0, 0, 1);
  t.nextGameIdx = [0]; t.pNext = [0.05];
  const v1 = E.stopValue(t, 0, 0, 1);
  t.pNext = [null];
  assert.ok(v1 < v0 - 1); assert.equal(E.stopValue(t, 0, 0, 1), v0);
  t.dnp = { p1: 0.5, p0: 0.5 }; assert.ok(E.stopValue(t, 0, 0, 1) < v0);
  // legacy flags bypass the memo
  assert.equal(E.stopValue(t, 0, 0, 1, { legacyBugs: ["negEnd"] } as E.Policy), E.stopValue({ ...t }, 0, 0, 1, { legacyBugs: ["negEnd"] } as E.Policy));
});

test("emax (one exp) equals the two-exp formula bit for bit", () => {
  const r = E.rng(5); const pdf = (z: number) => Math.exp(-0.5 * z * z) / 2.5066282746310002;
  for (let i = 0; i < 20000; i++) {
    const mu = r() * 60 - 5, sd = 3 + r() * 15, v = r() * 120 - 20;
    const z = (mu - v) / sd;
    assert.equal(E.emax(mu, sd, v), v + (mu - v) * E.normCdf(z) + sd * pdf(z));
  }
});
