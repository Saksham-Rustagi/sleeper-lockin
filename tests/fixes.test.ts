// Engine-v2 phase-1 rule fixes: each bug reproduced with its legacy flag, and shown fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../lib/engine/core";
import * as L from "../lib/engine/lagrange";
import { runChecked } from "../research/invariants";
import { bruteForce } from "../research/bruteforce";

const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
function tw(slots: string[], players: { pos: string[]; games: { tip: number; mu: number; actual?: number }[] }[]): E.TeamWeek {
  const games: E.Game[] = [];
  players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual ?? g.mu, played: true })));
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 1, p0: 1 } };
}
// tips in hours after T0: [hour, mu, actual]
const twH = (slots: string[], players: { pos: string[]; g: [number, number, number][] }[]) =>
  tw(slots, players.map((p) => ({ pos: p.pos, games: p.g.map(([h, mu, actual]) => ({ tip: T0 + h * H, mu, actual })) })));
const POL: E.Policy = { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true };
const LEG = (bugs: E.LegacyBug[] | true): E.Policy => ({ ...POL, legacyBugs: bugs });
const real = (t: E.TeamWeek) => ({ a: Float64Array.from(t.games.map((g) => g.actual)), p: Uint8Array.from(t.games.map(() => 1)) });
const check = (t: E.TeamWeek, hooks?: E.Hooks, pol = POL) => runChecked(t, pol, E.buildEvents(t, true), real(t).a, real(t).p, hooks);
const legal = (r: ReturnType<typeof check>) => Object.keys(r.rep.counts).filter((k) => k.startsWith("L_"));
const runTo = (t: E.TeamWeek, pol: E.Policy, until: number, hooks?: E.Hooks) => { const st = E.initState(t); E.simulate(t, pol, E.buildEvents(t, true), real(t).a, real(t).p, st, 0, hooks, until); return st; };

test("legacy flags: legacyBugs=true reproduces the old engine on the old unit-test weeks", () => {
  const t = tw(["UTIL", "UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 30 }, { tip: T0 + 96 * H, mu: 25, actual: 10 }] }, { pos: ["PG"], games: [{ tip: T0 + 24 * H, mu: 20, actual: 22 }] }]);
  assert.equal(check(t, undefined, LEG(true)).total, 52);
  assert.ok(E.legacy(LEG(true), "strand") && E.legacy(LEG(["stop"]), "stop") && !E.legacy(LEG(["stop"]), "strand") && !E.legacy(POL, "stop"));
});

test("B1: a hook-forced lock that strands a held teammate is refused by the fixed engine", () => {
  // slots PG, UTIL. A (PG/SF) holds 25 and tips again Friday; B (SF) holds 12 (final game). Locking A into UTIL leaves
  // B, who can't play PG, without a slot: Sleeper would bench him (forfeit) but the old engine still treated him as held.
  const t = tw(["PG", "UTIL"], [
    { pos: ["PG", "SF"], games: [{ tip: T0, mu: 20, actual: 25 }, { tip: T0 + 96 * H, mu: 20 }] },
    { pos: ["SF"], games: [{ tip: T0 + 3 * H, mu: 20, actual: 12 }] },
  ]);
  const hook: E.Hooks = { decideLock: (_st, p) => (p === 0 ? 1 : (undefined as any)) };
  assert.equal(check(t, hook, LEG(["strand"])).rep.counts.L_held_stranded, 1);
  const st = E.initState(t); st.pendingX[0] = 25; st.pendingX[1] = 12;
  assert.ok(!E.lockFeasible(t, st, 0, 1) && E.lockFeasible(t, st, 0, 0), "only the PG lock keeps B seated");
  const r = check(t, hook);
  assert.deepEqual(legal(r), []); assert.equal(r.total, 37, "A locked in PG (25) + B's final game (12)");
  // an ineligible slot from a hook is never applied either
  const t1 = tw(["PG", "C"], [{ pos: ["PG"], games: [{ tip: T0, mu: 20, actual: 30 }, { tip: T0 + 96 * H, mu: 20 }] }, { pos: ["C"], games: [{ tip: T0 + 24 * H, mu: 20 }] }]);
  const bad: E.Hooks = { decideLock: (s, p) => (p === 0 && !Number.isNaN(s.pendingX[0]) ? 1 : (undefined as any)) };
  assert.ok(check(t1, bad, LEG(["strand"])).rep.counts.L_lock_inelig >= 1);
  assert.deepEqual(legal(check(t1, bad)), []);
});

test("B1: the rule itself stranded a held teammate (Lonzo-Ball-style, found by random search) - fixed", () => {
  // Thursday: P3 (PG/SF) was locked into F to keep PG open for P1's later games; P4 (PF only) then had no slot.
  const t = twH(["F", "UTIL", "PG"], [
    { pos: ["C"], g: [[2, 23, 44], [26, 12, 38], [49, 31, 17], [73, 10, 32]] },
    { pos: ["PG"], g: [[24, 21, 11], [50, 27, 11], [98, 9, 2], [122, 33, 14]] },
    { pos: ["PF", "C"], g: [[24, 17, 25], [49, 14, 45], [97, 31, 19], [121, 11, 26]] },
    { pos: ["PG", "SF"], g: [[0, 31, 7], [26, 35, 35], [48, 33, 37], [73, 25, 25], [96, 24, 6]] },
    { pos: ["PF"], g: [[49, 14, 7]] },
  ]);
  const old = check(t, undefined, LEG(true));
  assert.equal(old.rep.counts.L_held_stranded, 1, JSON.stringify(old.rep.examples));
  const r = check(t);
  assert.deepEqual(legal(r), [], JSON.stringify(r.rep.examples)); assert.equal(r.total, r.trackerTotal);
});

test("B1 accounting: the old engine counted a stranded score (93 reported, 48 legal); the fixed engine is legal", () => {
  // Saturday: P2 was locked into a C slot while P3 played in the other; P4 (C only, held 45) had no slot left, but the
  // old engine still counted his 45 at week end.
  const t = twH(["F", "F", "C", "C"], [
    { pos: ["PF", "C"], g: [[0, 36, 16], [48, 23, 13]] },
    { pos: ["SG"], g: [[0, 29, 37]] },
    { pos: ["PF", "C"], g: [[72, 23, 25], [122, 17, 10]] },
    { pos: ["PF", "C"], g: [[24, 16, 36], [120, 37, 10]] },
    { pos: ["C"], g: [[2, 23, 45]] },
  ]);
  const old = check(t, undefined, LEG(true));
  assert.equal(old.total, 93); assert.equal(old.trackerTotal, 48);
  assert.ok(old.rep.counts.L_count_forfeited === 1 && old.rep.counts.L_total_mismatch === 1, JSON.stringify(old.rep.counts));
  const r = check(t);
  assert.deepEqual(legal(r), [], JSON.stringify(r.rep.examples)); assert.equal(r.total, r.trackerTotal);
});

test("B2: a negative held final-game score is benched before week end (0), and valued that way", () => {
  const t = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: 10, actual: -3 }] }]);
  const old = check(t, undefined, LEG(["negEnd"]));
  assert.equal(old.total, -3); assert.equal(old.rep.counts.S_weekend_negative, 1);
  const r = check(t);
  assert.equal(r.total, 0); assert.equal(r.trackerTotal, 0); assert.deepEqual(legal(r), []);
  // a lone final game with a negative mean: worth E[max(X, 0)] > 0 (fixed) vs mu (legacy)
  const t2 = tw(["UTIL"], [{ pos: ["SF"], games: [{ tip: T0, mu: -2 }] }]);
  assert.ok(Math.abs(E.stopValue(t2, 0, 0, 1) - E.emax(-2, 8, 0)) < 1e-12);
  assert.equal(E.stopValue(t2, 0, 0, 1, LEG(["negEnd", "stop"])), -2);
});

test("B3: a lineup changed by start/sit simulation re-seats a held score in the slot it frees", () => {
  // two UTIL slots. A holds 20 (next game Friday, proj 40); B and C tip Tuesday. The rule seats B and C, A must yield
  // and is let go (his Friday is worth more than locking 20). A simulation-style hook then sits C: his slot is free.
  const t = tw(["UTIL", "UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 25, actual: 20 }, { tip: T0 + 96 * H, mu: 40 }] },
    { pos: ["PG"], games: [{ tip: T0 + 24 * H, mu: 25 }] },
    { pos: ["C"], games: [{ tip: T0 + 24 * H, mu: 24 }] },
  ]);
  const sitC: E.Hooks = { decideStarts: (_st, _t, _i, tipping, _p, _g, slotOf) => (tipping.includes(2) && slotOf.has(2) ? new Map([...slotOf].filter(([p]) => p !== 2)) : undefined) };
  assert.ok(Number.isNaN(runTo(t, LEG(["reseat"]), T0 + 24 * H, sitC).pendingX[0]), "old: A's 20 let go although C was sat");
  assert.equal(runTo(t, POL, T0 + 24 * H, sitC).pendingX[0], 20, "fixed: A keeps holding in C's slot");
  const r = check(t, sitC);
  assert.equal(r.rep.counts.F_yield_idle ?? 0, 0); assert.deepEqual(legal(r), []);
});

test("B4: on a crowded night the better held score keeps the slot (old: arbitrary, it kept a 0)", () => {
  // three UTIL slots; A holds 0 and B holds 14 (both play again Friday); C and D tip Tuesday: one held score must yield
  const t = tw(["UTIL", "UTIL", "UTIL"], [
    { pos: ["SF"], games: [{ tip: T0, mu: 20, actual: 0 }, { tip: T0 + 96 * H, mu: 30 }] },
    { pos: ["PF"], games: [{ tip: T0 + 1 * H, mu: 20, actual: 14 }, { tip: T0 + 97 * H, mu: 30 }] },
    { pos: ["PG"], games: [{ tip: T0 + 24 * H, mu: 25 }] },
    { pos: ["C"], games: [{ tip: T0 + 24 * H, mu: 24 }] },
  ]);
  const old = runTo(t, LEG(["heldTie"]), T0 + 24 * H);
  assert.equal(old.pendingX[0], 0, "old: the held 0 kept its slot"); assert.ok(Number.isNaN(old.pendingX[1]));
  const st = runTo(t, POL, T0 + 24 * H);
  assert.equal(st.pendingX[1], 14, "fixed: the held 14 keeps a slot"); assert.ok(Number.isNaN(st.pendingX[0]));
});

test("stopValue is the exact single-player DP under the DNP chain (vs brute force; legacy marginals differ)", () => {
  // empirical-residual model with 4 equally likely z values on the shape grid (so emaxShape is exact): the player's
  // problem is then discrete and the expectimax brute force over the real rules (one UTIL slot) is exact
  const zs = [-1.5, -0.5, 0.5, 2.0];
  const shape = E.makeResidualShape(Array.from({ length: 400 }, (_, i) => zs[i % 4]), 400);
  for (const [mus, lp0] of [[[18, 22, 30], 0], [[30, 25, 28], 1], [[12, 35], 0], [[40, 10, 20, 25], 1]] as [number[], number][]) {
    const t = tw(["UTIL"], [{ pos: ["SF"], games: mus.map((mu, k) => ({ tip: T0 + k * 24 * H, mu })) }]);
    t.dnp = { p1: 0.9, p0: 0.3 }; t.lastPlayed0 = [lp0]; t.resid = shape;
    const inst: L.LInstance = { ...L.fromTeamWeek(t) };
    inst.games = inst.games.map((g) => { const x = zs.map((z) => Math.max(-5, t.games[0].sd * z + mus[t.byPlayer[0].indexOf(inst.games.indexOf(g))])); return { ...g, dist: { kind: "discrete", x, w: [0.25, 0.25, 0.25, 0.25] } }; });
    const exact = bruteForce(inst);
    assert.ok(Math.abs(E.stopValue(t, 0, 0, lp0) - exact) < 1e-6, `exact DP ${E.stopValue(t, 0, 0, lp0)} vs brute force ${exact}`);
    const leg = E.stopValue(t, 0, 0, lp0, LEG(["stop"]));
    if (mus.length > 2 && !lp0) assert.ok(Math.abs(leg - exact) > 0.05, `legacy marginals ${leg} should differ from ${exact}`);
  }
});
