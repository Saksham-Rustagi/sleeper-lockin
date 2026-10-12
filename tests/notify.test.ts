import { test } from "node:test";
import assert from "node:assert/strict";
import { messages } from "../scripts/notify";

const now = Date.parse("2026-10-27T22:30:00Z"); // 6:30pm ET
const advice: any = {
  decisions: [
    { player: "Evan Mobley", pid: "2259", score: 41.5, deadline: now + 48 * 3600e3, deadlineText: "before Thu 7:00 PM (ATL)", recommended: "LOCK", recommendedSlot: "C", threshold: 27.3, reason: "Locking 41.5 beats waiting by 9.1 pts." },
    { player: "Jalen Green", pid: "2309", score: 18.0, deadline: now + 50 * 60e3, deadlineText: "before Tue 7:20 PM (DEN)", recommended: "HOLD", recommendedSlot: null, threshold: 21.0, reason: "Keep him in a starting slot." },
  ],
  plan: [{ tip: now + 30 * 60e3, when: "Tue 7:00 PM", tentative: false, starts: [{ slot: "UTIL", player: "Donovan Clingan", pid: "2728", proj: 30, lockIf: 28.5 }, { slot: "PG", player: "Darius Garland", pid: "2007", proj: 25, lockIf: 24 }], benched: [{ player: "Collin Gillespie", proj: 18 }] }],
  me: { slots: [{ pid: "2007" }, { pid: "2259" }] },
};
test("notifier builds lock / hold / final-call / lineup reminders", () => {
  const m = messages(advice, now);
  const titles = m.map((x) => x.title).join("\n");
  assert.match(titles, /LOCK Evan Mobley \(41\.5\) at C/);
  assert.match(titles, /HOLD Jalen Green/);
  assert.match(titles, /Final call on Jalen Green/);
  assert.match(titles, /🏀 Before Tue 7:00 PM: start Donovan Clingan \(UTIL\)/);
  assert.ok(!/Garland \(PG\)/.test(titles), "Garland is already in the lineup");
  assert.equal(new Set(m.map((x) => x.key)).size, m.length, "dedupe keys unique");
});

test("late scratch reminder explains the swap", () => {
  const a: any = JSON.parse(JSON.stringify(advice));
  a.decisions = [];
  a.me.slots = [{ pid: "2007", player: "Darius Garland", injury: null, locked: false }, { pid: "2259", player: "Evan Mobley", injury: "Out", locked: false }];
  a.plan[0].starts = [{ slot: "C", player: "Donovan Clingan", pid: "2728", proj: 30, lockIf: 28 }, { slot: "PG", player: "Darius Garland", pid: "2007", proj: 25, lockIf: 24 }];
  const m = messages(a, now);
  assert.equal(m.length, 1);
  assert.match(m[0].title, /⚠️ Evan Mobley OUT → Before Tue 7:00 PM: start Donovan Clingan \(C\)/);
  assert.match(m[0].body, /Bench Evan Mobley \(ruled out\)/);
});

test("lock instructions: swap into the best slot without benching anyone", async () => {
  const { lockMoves } = await import("../lib/live/advise");
  const E = await import("../lib/engine/core");
  const slotNames = ["PF", "C", "UTIL", "UTIL"]; const slots = slotNames.map((s) => E.SLOT_MASK[s]);
  const pmask = [E.posMask(["C", "PF"]), E.posMask(["C"]), E.posMask(["SF"])]; const names = ["Evan Mobley", "Donovan Clingan", "Keegan Murray"]; const pids = ["m", "c", "k"];
  const st: any = { lockedBy: new Int32Array(4).fill(-1), pinned: new Int32Array(4).fill(-1), pendingX: new Float64Array(3).fill(NaN) };
  // Mobley sits in UTIL 1, Clingan in C: lock Mobley at C -> Clingan must move to UTIL (he can't play PF)... UTIL 1 is Mobley's spot, so a swap works
  let m = lockMoves(slotNames, slots, pmask, names, pids, ["k", "c", "m", null], st, 0, 1);
  assert.match(m[0], /Swap Evan Mobley \(UTIL 1\) ↔ Donovan Clingan \(C\)/); assert.match(m[1], /Lock Evan Mobley in C/);
  // Mobley in PF, lock at C: Clingan can't take PF -> moved to the empty UTIL 2 first
  m = lockMoves(slotNames, slots, pmask, names, pids, ["m", "c", "k", null], st, 0, 1);
  assert.match(m[0], /Move Donovan Clingan C → UTIL 2, then Evan Mobley PF → C/);
  m = lockMoves(slotNames, slots, pmask, names, pids, ["m", "c", "k", null], st, 0, 0);
  assert.match(m[0], /already there/);
});

test("reminder tells you to MOVE a held player (not bench him) when a new starter needs his slot", () => {
  const a: any = JSON.parse(JSON.stringify(advice));
  a.decisions = [];
  a.me.slots = [{ pid: "2259", player: "Evan Mobley", injury: null, locked: false }, { pid: "2007", player: "Darius Garland", injury: null, locked: false }];
  a.plan[0].starts = [{ slot: "C", player: "Donovan Clingan", pid: "2728", proj: 30, lockIf: 28 }];
  a.plan[0].holds = [{ player: "Evan Mobley", pid: "2259", score: 24.5, slot: "UTIL 2", from: "C", move: true }];
  const m = messages(a, now);
  assert.equal(m.length, 1);
  assert.match(m[0].body, /Move held Evan Mobley \(24\.5\) → UTIL 2 - NOT to the bench/);
});
