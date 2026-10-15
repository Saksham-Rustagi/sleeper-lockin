// Opponent snapshots from the real 2025-26 data (ENGINE_V2 Phase 5, validation a), without look-ahead.
// Sleeper's matchup files give only the final lineup: per starting slot the player and the points it counted. Each
// slot's points are matched to the player's game that produced them (his first game with exactly that score). What we
// let our policy see at time t (what Sleeper's matchup view shows, restricted to what the data can prove):
//  - that game in progress (t between its tip and end): the player is in that slot, playing;
//  - that game over but its lock not certain yet (before the player's next tip-off): he holds that score in that slot;
//  - from the player's next tip-off on (the last moment he could lock it), or from week end for his final game: locked.
// Slots with 0 points or no matching game, and every other player, are unknown until week end: the human model fills
// them (standing lineup) and plays them. Scores the human held and later let go are not in the data, so we never see
// them (less information than the live app has; conservative).
import * as E from "../lib/engine/core";
import * as H from "../lib/engine/human";

export interface RealSlots { pids: string[]; starters: string[]; pts: number[] }
interface SlotFact { s: number; p: number; g: number; pts: number; lockAt: number }
const FACTS = new WeakMap<E.TeamWeek, SlotFact[]>();
export function slotFacts(tw: E.TeamWeek, real: { actual: Float64Array; played: Uint8Array }, rs: RealSlots): SlotFact[] {
  let f = FACTS.get(tw); if (f) return f;
  f = []; const pidx = new Map(rs.pids.map((p, i) => [p, i]));
  rs.starters.forEach((pid, s) => {
    const pts = rs.pts[s]; const p = pidx.get(pid); if (p === undefined || pts === 0) return;
    const gl = tw.byPlayer[p]; const k = gl.findIndex((gi) => real.played[gi] && Math.abs(real.actual[gi] - pts) < 1e-6);
    if (k < 0) return;
    f!.push({ s, p, g: gl[k], pts, lockAt: k + 1 < gl.length ? tw.games[gl[k + 1]].tip : Infinity });
  });
  FACTS.set(tw, f); return f;
}
// the human state we can know at time t (before the events at t), plus the human-model event index to continue from
export function realOppSnapshot(tw: E.TeamWeek, real: { actual: Float64Array; played: Uint8Array }, rs: RealSlots, t: number): { hs: H.HState; fromEv: number } {
  const nS = tw.slots.length, nP = tw.pmask.length;
  const hs: H.HState = {
    occ: new Int32Array(nS).fill(-1), locked: new Uint8Array(nS), pts: new Float64Array(nS), lockGame: new Int32Array(nS).fill(-1),
    held: new Float64Array(nP).fill(NaN), heldGame: new Int32Array(nP).fill(-1), inGame: new Int32Array(nP).fill(-1),
    isLocked: new Uint8Array(nP), lastPlayed: Uint8Array.from(tw.lastPlayed0), e: 1, u: 0, mode: 0,
  };
  for (const gi of tw.games.map((_, i) => i).sort((a, b) => tw.games[a].end - tw.games[b].end)) if (tw.games[gi].end < t) hs.lastPlayed[tw.games[gi].p] = real.played[gi];
  for (const f of slotFacts(tw, real, rs)) {
    const g = tw.games[f.g];
    if (t > f.lockAt) { hs.occ[f.s] = f.p; hs.locked[f.s] = 1; hs.pts[f.s] = f.pts; hs.lockGame[f.s] = f.g; hs.isLocked[f.p] = 1; }
    else if (t > g.end) { hs.occ[f.s] = f.p; hs.held[f.p] = f.pts; hs.heldGame[f.p] = f.g; }
    else if (t > g.tip) { hs.occ[f.s] = f.p; hs.inGame[f.p] = f.g; }
  }
  H.standingLineup(tw, hs, t);
  return { hs, fromEv: H.firstEvAfter(tw, t) };
}
// the opponent's locked points visible at t (for logs)
export function realOppLocked(tw: E.TeamWeek, real: { actual: Float64Array; played: Uint8Array }, rs: RealSlots, t: number) {
  let x = 0; for (const f of slotFacts(tw, real, rs)) if (t > f.lockAt) x += f.pts; return x;
}
