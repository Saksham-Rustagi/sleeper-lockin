// "Do now" card (task U, lib/live/donow.ts): the lineup to have set in Sleeper before the next tip-off, the diff vs the
// current Sleeper lineup, and the later changes today (slot reuse after a game ends).
import { test } from "node:test";
import assert from "node:assert/strict";
import { doNow, doNowText } from "../lib/live/donow";

const ET = (h: number, m = 0) => Date.parse("2026-10-21T00:00:00Z") + ((h + 4) * 60 + m) * 60e3; // Wed Oct 21 ET (EDT)
const NAMES = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
type Sl = { pid?: string; player?: string; state?: string; points?: number | null; gameEnd?: number; lockIf?: number | null; injury?: string | null };
const slots = (m: Record<number, Sl>) => NAMES.map((slot, i) => {
  const x = m[i]; if (!x) return { slot, player: null, pid: null, locked: false, points: null, source: null, state: "empty" };
  return { slot, player: x.player ?? x.pid!, pid: x.pid!, locked: x.state === "locked", points: x.points ?? null, source: null, state: x.state ?? "idle", injury: x.injury ?? null, ...(x.gameEnd ? { gameEnd: x.gameEnd, lockIf: x.lockIf ?? null } : {}) };
});
const tp = (tip: number, p: any = {}) => ({ tip, when: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(tip), starts: [], benched: [], tentative: false, holds: [], forfeits: [], locks: [], playing: [], ...p });
const st = (slot: string, pid: string, tip: number, proj: number, lockIf: number | null, x: any = {}) => ({ slot, player: pid, pid, proj, lockIf, opp: "TOR", end: tip + 150 * 60e3, ...x });
const pl = (pid: string, pos: string, injury: string | null = null) => ({ pid, name: pid, pos, injury, games: [] });
const hold = (d: string, score: number, threshold: number, deadline: number) => ({ player: d, pid: d, score, deadline, deadlineText: "before Thu 7:00 PM (DEN)", options: [], recommended: "HOLD", recommendedSlot: null, threshold, reason: "", moves: [] });
const row = (d: ReturnType<typeof doNow>, slot: string) => d.rows.find((r) => r.slot === slot)!;

test("held player stays where he sits (sticky), locked slot fixed, free roll, new starters in the narrowest free slots", () => {
  const d = doNow({
    asOf: ET(18), decisions: [hold("Wallace", 15.5, 24, ET(19) + 24 * 3600e3)] as any,
    me: { slots: slots({ 0: { pid: "Wallace", state: "held", points: 15.5 }, 1: { pid: "Castle", state: "locked", points: 30 }, 3: { pid: "Flagg" } }) as any,
      players: [pl("Wallace", "PG/SG"), pl("Castle", "SG"), pl("Flagg", "SF"), pl("Garland", "PG"), pl("Black", "PG/SG", "Out")] },
    plan: [tp(ET(19), {
      starts: [st("PG", "Garland", ET(19), 25, 24), st("G", "Black", ET(19), 20, 18, { label: "Out - 3% to play (exp 0.6) · free roll (his slot isn't needed before his game ends)", playProb: 0.03 })],
      holds: [{ player: "Wallace", pid: "Wallace", score: 15.5, slot: "UTIL 1", from: "PG", move: true }],
    })] as any,
  });
  // the engine put Garland in PG and moved Wallace to UTIL 1: an arbitrary placement - Wallace keeps PG, nobody moves
  assert.equal(row(d, "PG").player, "Wallace"); assert.match(row(d, "PG").status, /^held 15\.5 - keep, don't lock \(lock-if 24\.0\)/);
  assert.equal(row(d, "PG").change, null);
  assert.equal(row(d, "G").player, "Garland"); assert.match(row(d, "G").status, /^plays 7:00 PM vs TOR \(proj 25\.0\) · lock if ≥ 24\.0$/);
  assert.equal(row(d, "G").change, "put Garland in G");
  assert.equal(row(d, "SG").change, null); assert.equal(row(d, "SG").status, "locked 30.0");
  assert.equal(row(d, "UTIL 1").player, "Black"); assert.equal(row(d, "UTIL 1").status, "free roll - Out, 3% to play (7:00 PM)");
  assert.equal(row(d, "SF").change, null); assert.match(row(d, "SF").status, /can stay/); // idle, his slot isn't needed
  assert.deepEqual(d.changes, ["Put Garland in G", "Put Black in UTIL 1"]);
  assert.equal(d.upToDate, null);
  assert.equal(d.compact, "G Garland, UTIL 1 Black (free roll)");
  assert.equal(d.rows.length, 9);
  assert.match(doNowText(d), /Set your lineup to \(before the Wed 7:00 PM tip-off\)/);
});

test("nothing to do: the lineup already matches; until the next game end with a lock call", () => {
  const d = doNow({
    asOf: ET(18), decisions: [hold("Wallace", 15.5, 24, ET(19) + 24 * 3600e3)] as any,
    me: { slots: slots({ 0: { pid: "Garland" }, 7: { pid: "Wallace", state: "held", points: 15.5 } }) as any, players: [pl("Garland", "PG"), pl("Wallace", "PG/SG")] },
    plan: [tp(ET(19), { starts: [st("PG", "Garland", ET(19), 25, 24)], holds: [{ player: "Wallace", pid: "Wallace", score: 15.5, slot: "UTIL 1", from: "UTIL 1", move: false }] })] as any,
  });
  assert.deepEqual(d.changes, []);
  assert.ok(d.rows.every((r) => r.change === null));
  assert.equal(d.upToDate, "Your lineup is already correct - nothing to do until ~9:30 PM, when Garland's game ends.");
  assert.deepEqual(d.then[0].items, ["Garland: lock him if he scores ≥ 24.0"]);
});

test("slot reuse: a game in progress now; the later starter goes into his slot after it ends", () => {
  const d = doNow({
    asOf: ET(20), decisions: [],
    // (G and both UTILs taken: Garland can only play PG, so Wallace has to move once his game ends)
    me: { slots: slots({ 0: { pid: "Wallace", state: "playing", gameEnd: ET(21, 15), lockIf: 28 }, 2: { pid: "L1", state: "locked", points: 20 }, 7: { pid: "L2", state: "locked", points: 20 }, 8: { pid: "L3", state: "locked", points: 20 } }) as any,
      players: [pl("Wallace", "PG/SG"), pl("Garland", "PG"), pl("L1", "PG"), pl("L2", "C"), pl("L3", "C")] },
    plan: [tp(ET(22), { starts: [st("PG", "Garland", ET(22), 25, 24)], holds: [{ player: "Wallace", pid: "Wallace", score: 20, slot: "UTIL 1", from: "PG", move: true }] })] as any,
  });
  // nothing can change now (he is in his game), so the table shows him there
  assert.deepEqual(d.changes, []);
  assert.equal(row(d, "PG").player, "Wallace"); assert.equal(row(d, "PG").status, "in game now (ends ~9:15 PM) · lock if ≥ 28.0");
  assert.equal(row(d, "PG").later, "~9:15 PM: put Garland in PG");
  assert.equal(row(d, "SG").status, "empty until ~9:15 PM");
  const s = d.then[0];
  assert.equal(s.title, "~9:15 PM, when Wallace's game ends (changes due before the 10:00 PM tip-off)");
  assert.deepEqual(s.items, ["Wallace: lock him if he scores ≥ 28.0", "Move Wallace PG → SG (held 20.0 - keep him in a starting slot, never via the bench)", "Put Garland in PG"]);
  assert.match(d.upToDate!, /nothing to do until ~9:15 PM, when Wallace's game ends/);
});

test("later tip-off today: a free slot is set now; a reused slot changes after the earlier game ends", () => {
  const d = doNow({
    asOf: ET(18), decisions: [],
    // (F and both UTILs locked: Wells can only play SF, so Johnson has to move once his game ends)
    me: { slots: slots({ 3: { pid: "Johnson" }, 5: { pid: "L1", state: "locked", points: 20 }, 7: { pid: "L2", state: "locked", points: 20 }, 8: { pid: "L3", state: "locked", points: 20 } }) as any,
      players: [pl("Johnson", "SF/PF"), pl("Green", "C"), pl("Wells", "SF"), pl("L1", "PF"), pl("L2", "C"), pl("L3", "C")] },
    plan: [
      tp(ET(19), { starts: [st("SF", "Johnson", ET(19), 35, 33)] }),
      tp(ET(22), { tentative: true, starts: [st("C", "Green", ET(22), 19, 18), st("SF", "Wells", ET(22), 15, 14)], holds: [{ player: "Johnson", pid: "Johnson", score: 35, slot: "UTIL 1", from: "SF", move: true }] }),
    ] as any,
  });
  // Green's C is unused at 7:00 PM: set him now
  assert.equal(row(d, "C").player, "Green"); assert.match(row(d, "C").status, /plays 10:00 PM vs TOR .*set now/); assert.equal(row(d, "C").change, "put Green in C");
  assert.deepEqual(d.changes, ["Put Green in C"]);
  // SF is Johnson's until his game ends; then Johnson (held) moves and Wells comes in
  assert.equal(row(d, "SF").change, null);
  assert.equal(row(d, "SF").later, "~9:30 PM: put Wells in SF");
  const s = d.then.find((x) => /Johnson's game ends/.test(x.title))!;
  assert.match(s.title, /^~9:30 PM, when Johnson's game ends \(changes due before the 10:00 PM tip-off\)$/);
  assert.deepEqual(s.items, ["Johnson: lock him if he scores ≥ 33.0", "Move Johnson SF → PF (held 35.0 - keep him in a starting slot, never via the bench)", "Put Wells in SF"]);
  assert.ok(s.tentative);
});

test("LOCK now: banner with slot and deadline; a lock stays in his own slot of the same name", () => {
  const lock = (p: string, score: number, slot: string) => ({ player: p, pid: p, score, deadline: ET(19) + 48 * 3600e3, deadlineText: "before Fri 7:00 PM (ATL)", options: [], recommended: "LOCK", recommendedSlot: slot, threshold: 27.3, reason: "", moves: [] });
  const d = doNow({
    asOf: ET(18), decisions: [lock("Mobley", 41.5, "C"), lock("Clingan", 30, "UTIL")] as any,
    me: { slots: slots({ 6: { pid: "Mobley", state: "held", points: 41.5 }, 7: { pid: "Clingan", state: "held", points: 30 } }) as any, players: [pl("Mobley", "PF/C"), pl("Clingan", "C")] },
    plan: [tp(ET(19), { locks: [{ player: "Mobley", pid: "Mobley", score: 41.5, slot: "C" }, { player: "Clingan", pid: "Clingan", score: 30, slot: "UTIL 2" }] })] as any,
  });
  assert.deepEqual(d.locks.map((l) => l.text), ["LOCK Mobley (41.5) in C - before Fri 7:00 PM (ATL)", "LOCK Clingan (30.0) in UTIL 1 - before Fri 7:00 PM (ATL)"]);
  assert.equal(row(d, "C").status, "LOCK now (41.5 ≥ lock-if 27.3)");
  assert.equal(row(d, "UTIL 1").player, "Clingan"); assert.equal(row(d, "UTIL 2").player, null); // no UTIL 1 -> UTIL 2 move
  assert.deepEqual(d.changes, ["LOCK Mobley in C", "LOCK Clingan in UTIL 1"]);
  assert.equal(d.upToDate, null);
});

test("interchangeable slots: a starter stays in his UTIL, the held score in the other UTIL stays too", () => {
  const d = doNow({
    asOf: ET(18), decisions: [hold("Hart", 7, 24, ET(19) + 24 * 3600e3)] as any,
    me: { slots: slots({ 7: { pid: "Wilson" }, 8: { pid: "Hart", state: "held", points: 7 } }) as any, players: [pl("Wilson", "SF/PF"), pl("Hart", "C")] },
    plan: [tp(ET(19), { starts: [st("UTIL 2", "Wilson", ET(19), 23, 24)], holds: [{ player: "Hart", pid: "Hart", score: 7, slot: "UTIL 1", from: "UTIL 2", move: true }] })] as any,
  });
  assert.deepEqual(d.changes, []);
  assert.equal(row(d, "UTIL 1").player, "Wilson"); assert.equal(row(d, "UTIL 2").player, "Hart");
});

test("a held score the plan lets go: benched, said explicitly; an Out player who sits", () => {
  const d = doNow({
    asOf: ET(18), decisions: [{ ...hold("Miller", 4, 20, ET(19) + 24 * 3600e3), recommended: "BENCH" }] as any,
    me: { slots: slots({ 5: { pid: "Miller", state: "held", points: 4 }, 0: { pid: "Black", injury: "Out" } }) as any, players: [pl("Miller", "SF/PF"), pl("Black", "PG", "Out"), pl("Wells", "SF")] },
    plan: [tp(ET(19), { starts: [st("F", "Wells", ET(19), 15, 14)], forfeits: [{ player: "Miller", score: 4 }], benched: [{ player: "Black", pid: "Black", proj: 20, playProb: 0.03, expected: 0.6, label: "Out - 3% to play (exp 0.6): don't start (PG is needed by Garland)" }] })] as any,
  });
  assert.equal(row(d, "F").change, "bench Miller (lets go of his held 4.0)");
  assert.equal(row(d, "SF").change, "put Wells in SF"); // a new starter: the narrowest slot he fits
  assert.equal(row(d, "PG").change, "bench Black (Out - ruled out)");
  assert.ok(d.bench.some((b) => /^Black - sits Wed 7:00 PM \(Out - 3% to play \(exp 0\.6\) - don't start/.test(b)));
  assert.ok(d.bench.some((b) => /^Miller - let go of his held 4\.0/.test(b)));
});

// ---- task S: sticky placement ----
test("swap only: the engine swaps two PG/SG-eligible players (Black PG, held Wallace SG) - no changes", () => {
  const d = doNow({
    asOf: ET(18), decisions: [hold("Wallace", 5, 24, ET(19) + 24 * 3600e3)] as any,
    me: { slots: slots({ 0: { pid: "Wallace", state: "held", points: 5 }, 1: { pid: "Black", injury: "Out" }, 4: { pid: "Johnson" } }) as any,
      players: [pl("Wallace", "PG/SG"), pl("Black", "PG/SG", "Out"), pl("Johnson", "SF/PF")] },
    plan: [tp(ET(19), {
      starts: [st("PF", "Johnson", ET(19), 35.9, 33), st("PG", "Black", ET(19), 19.7, 18, { label: "Out - 3% to play (exp 0.6) · free roll (his slot isn't needed before his game ends)", playProb: 0.03 })],
      holds: [{ player: "Wallace", pid: "Wallace", score: 5, slot: "SG", from: "PG", move: true }],
    })] as any,
  });
  assert.deepEqual(d.changes, []);
  assert.equal(row(d, "PG").player, "Wallace"); assert.equal(row(d, "SG").player, "Black");
  assert.match(d.upToDate!, /^Your lineup is already correct/);
  assert.deepEqual(d.target.map((t) => `${t.slot} ${t.pid} ${t.kind}`), ["PG Wallace held", "SG Black freeRoll", "PF Johnson start"]);
});

test("later-move feasibility: a starter moves now only because a later starter needs his slot", () => {
  // Black (PG/SG) sits in SG and plays at 7:00 PM (ends 9:30); Garland (SG only) plays at 9:00 PM while Black is still
  // in his game; G and both UTILs are locked -> Black must start in PG, so SG is free for Garland at 9:00
  const lk = { state: "locked", points: 20 };
  const input = (players: ReturnType<typeof pl>[]) => ({
    asOf: ET(18), decisions: [],
    me: { slots: slots({ 1: { pid: "Black" }, 2: { pid: "L1", ...lk }, 7: { pid: "L2", ...lk }, 8: { pid: "L3", ...lk } }) as any, players },
    plan: [tp(ET(19), { starts: [st("PG", "Black", ET(19), 20, 18)] }),
      tp(ET(21), { tentative: true, starts: [st("SG", "Garland", ET(21), 22, 20)], playing: [{ player: "Black", pid: "Black", slot: "PG", end: ET(21, 30) }] })] as any,
  });
  const d = doNow(input([pl("Black", "PG/SG"), pl("Garland", "SG"), pl("L1", "PG"), pl("L2", "C"), pl("L3", "C")]));
  assert.deepEqual(d.changes, ["Move Black SG → PG", "Put Garland in SG"]); // (Garland's SG is unused before 9:00: set now)
  // same, but Garland can also play G... which is locked; and if he could play PG/SG, Black would stay -> no move
  const d2 = doNow(input([pl("Black", "PG/SG"), pl("Garland", "PG/SG"), pl("L1", "PG"), pl("L2", "C"), pl("L3", "C")]));
  assert.ok(!d2.changes.some((c) => /^Move Black/.test(c)), d2.changes.join("; "));
  assert.equal(row(d2, "SG").player, "Black");
});

test("stable: the same lineup whatever slot names the engine picks for equivalent players", () => {
  const mk = (blackSlot: string, wallaceSlot: string) => doNow({
    asOf: ET(18), decisions: [hold("Wallace", 5, 24, ET(19) + 24 * 3600e3)] as any,
    me: { slots: slots({ 0: { pid: "Wallace", state: "held", points: 5 }, 1: { pid: "Black" } }) as any, players: [pl("Wallace", "PG/SG"), pl("Black", "PG/SG")] },
    plan: [tp(ET(19), { starts: [st(blackSlot, "Black", ET(19), 19.7, 18)], holds: [{ player: "Wallace", pid: "Wallace", score: 5, slot: wallaceSlot, from: "PG", move: wallaceSlot !== "PG" }] })] as any,
  });
  for (const [b, w] of [["PG", "SG"], ["SG", "PG"], ["G", "UTIL 2"], ["UTIL 1", "G"]]) {
    const d = mk(b, w);
    assert.deepEqual(d.changes, [], `${b}/${w}: ${d.changes.join("; ")}`);
  }
});

test("worst case stays fast: 9 interchangeable players, a later tip-off that can't be fully placed", () => {
  const ps = Array.from({ length: 14 }, (_, i) => pl(`P${i}`, "PG/SG/SF/PF/C"));
  const tips = Array.from({ length: 8 }, (_, k) => ET(19) + k * 30 * 60e3);
  const t0 = Date.now();
  const d = doNow({
    asOf: ET(18), decisions: [],
    me: { slots: slots(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, { pid: `P${i}` }]))) as any, players: ps },
    // every tip-off: 9 starters out of 14 (more than the free slots once earlier games pin theirs)
    plan: tips.map((tip, k) => tp(tip, { starts: Array.from({ length: 9 }, (_, i) => st(NAMES[i] === "UTIL" ? `UTIL ${i - 6}` : NAMES[i], `P${(i + k) % 14}`, tip, 20, 18)) })) as any,
  });
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.equal(d.rows.length, 9);
});
