// Lineup reminders without flip-flops (task S, lib/live/lineupnotify.ts via scripts/notify.ts messages()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { messages } from "../scripts/notify";
import type { LineupState } from "../lib/live/lineupnotify";

const TIP = Date.parse("2026-10-21T23:00:00Z"); // Wed 7:00 PM ET
const NOW = TIP - 60 * 60e3;
const NAMES = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
type P = { pid: string; pos: string; proj: number; injury?: string | null };
// me: Sleeper slots (index -> pid, held scores) + players with a game at TIP; plan: starters (slot, pid, playProb), holds
function advice(o: { at: Record<number, string>; held?: Record<string, number>; players: P[]; starts: [string, string, number?][]; holds?: [string, string][]; benched?: string[] }): any {
  const P = new Map(o.players.map((p) => [p.pid, p]));
  const slots = NAMES.map((slot, i) => {
    const pid = o.at[i]; if (!pid) return { slot, player: null, pid: null, locked: false, points: null, source: null, state: "empty" };
    const h = o.held?.[pid];
    return { slot, player: pid, pid, locked: false, points: h ?? null, source: null, state: h !== undefined ? "held" : "idle", injury: P.get(pid)?.injury ?? null };
  });
  const players = o.players.map((p) => ({ pid: p.pid, name: p.pid, pos: p.pos, injury: p.injury ?? null, locked: false, games: [{ date: "2026-10-21", opp: "TOR", tip: TIP, status: "pre", proj: p.proj, actual: null }] }));
  const decisions = Object.entries(o.held ?? {}).map(([pid, score]) => ({ player: pid, pid, score, deadline: TIP + 86400e3, deadlineText: "before Thu 7:00 PM", options: [], recommended: "HOLD", recommendedSlot: null, threshold: 24, reason: "", moves: [] }));
  return {
    asOf: NOW, decisions, me: { slots, players },
    plan: [{ tip: TIP, when: "Wed 7:00 PM", tentative: false, forfeits: [], locks: [], playing: [],
      starts: o.starts.map(([slot, pid, pp]) => ({ slot, player: pid, pid, proj: P.get(pid)!.proj, lockIf: 30, opp: "TOR", end: TIP + 150 * 60e3, ...(pp !== undefined ? { playProb: pp, label: "Out - 3% to play · free roll" } : {}) })),
      holds: (o.holds ?? []).map(([slot, pid]) => ({ player: pid, pid, score: o.held![pid], slot, from: null, move: false })),
      benched: (o.benched ?? []).map((pid) => ({ player: pid, pid, proj: P.get(pid)!.proj })) }],
  };
}
const lineupMsgs = (a: any, st: LineupState, notes: string[] = []) => messages(a, NOW, st, notes).filter((m) => /^(lineup|cutoffs)\|/.test(m.key));
const ROSTER: P[] = [{ pid: "Wallace", pos: "PG/SG", proj: 20 }, { pid: "Black", pos: "PG/SG", proj: 19.7, injury: "Out" }, { pid: "Johnson", pos: "SF/PF", proj: 35.9 }];

test("swap only (6:19 -> 6:24 PM today): 'lineup is set' once, then the engine's PG/SG swap sends nothing", () => {
  const st: LineupState = {};
  const at = { 0: "Wallace", 1: "Black", 4: "Johnson" }; const held = { Wallace: 5 };
  let m = lineupMsgs(advice({ at, held, players: ROSTER, starts: [["PF", "Johnson"], ["SG", "Black", 0.03]], holds: [["PG", "Wallace"]] }), st);
  assert.deepEqual(m.map((x) => x.title), ["🏀 Wed 7:00 PM tip-off — lineup is set"]);
  const notes: string[] = [];
  m = lineupMsgs(advice({ at, held, players: ROSTER, starts: [["PF", "Johnson"], ["PG", "Black", 0.03]], holds: [["SG", "Wallace"]] }), st, notes);
  assert.deepEqual(m, []); assert.match(notes[0], /already said/);
});

test("real change: who starts changes because of an injury -> reminder with the reason", () => {
  const st: LineupState = {};
  const players: P[] = [{ pid: "Green", pos: "PF/C", proj: 25, injury: "Questionable" }, { pid: "Johnson", pos: "SF/PF", proj: 35.9 }];
  lineupMsgs(advice({ at: { 4: "Green" }, players, starts: [["PF", "Green"]], benched: ["Johnson"] }), st); // lineup is set
  players[0].injury = "Out";
  const m = lineupMsgs(advice({ at: { 4: "Green" }, players, starts: [["PF", "Johnson"]], benched: ["Green"] }), st);
  assert.equal(m.length, 1);
  assert.match(m[0].title, /^⚠️ Green OUT → Before Wed 7:00 PM: PF Johnson$/);
  assert.match(m[0].body, /^Changed because: Green questionable → out\. Bench Green \(Out - ruled out\); Put Johnson in PF\./);
});

test("hysteresis: a starter swap within 0.5 pts flips nothing; a real projection move does", () => {
  const st: LineupState = {}; const notes: string[] = [];
  const players: P[] = [{ pid: "A", pos: "SF", proj: 20.2 }, { pid: "B", pos: "SF", proj: 20.4 }];
  // first run: Sleeper has A, the engine prefers B by 0.2 -> keep A (no reminder at all)
  let m = lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "B"]], benched: ["A"] }), st, notes);
  assert.deepEqual(m, []); assert.match(notes.at(-1)!, /^hysteresis: kept A \(20\.2\) over B \(20\.4\)/);
  assert.deepEqual(st[String(TIP)].starters, ["A"]);
  // engine back to A: lineup is set; then to B again: still nothing
  m = lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "A"]], benched: ["B"] }), st, notes);
  assert.deepEqual(m.map((x) => x.key), [`cutoffs|${TIP}`]);
  m = lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "B"]], benched: ["A"] }), st, notes);
  assert.deepEqual(m, []); assert.match(notes.at(-1)!, /^hysteresis/);
  // B's projection jumps to 23.0: material -> reminder with the reason
  players[1].proj = 23;
  m = lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "B"]], benched: ["A"] }), st, notes);
  assert.equal(m.length, 1); assert.match(m[0].body, /^Changed because: B proj 20\.4 → 23\.0\. Bench A .*; Put B in SF\./);
  assert.match(m[0].title, /^🔄 Before Wed 7:00 PM: SF B$/);
});

test("after 'lineup is set', a change with no material reason is not sent", () => {
  const st: LineupState = {}; const notes: string[] = [];
  const players: P[] = [{ pid: "A", pos: "SF", proj: 20 }, { pid: "B", pos: "SF", proj: 25 }];
  lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "A"]], benched: ["B"] }), st, notes);
  const m = lineupMsgs(advice({ at: { 3: "A" }, players, starts: [["SF", "B"]], benched: ["A"] }), st, notes);
  assert.deepEqual(m, []); assert.match(notes.at(-1)!, /without a material reason after "lineup is set"/);
  // the user moves things around in Sleeper -> that is a reason
  const m2 = lineupMsgs(advice({ at: { 5: "A" }, players: [...players, { pid: "C", pos: "SF", proj: 1 }], starts: [["SF", "B"]], benched: ["A"] }), st, notes);
  assert.equal(m2.length, 1); assert.match(m2[0].body, /your Sleeper lineup changed/);
});
