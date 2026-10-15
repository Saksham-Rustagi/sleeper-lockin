// The opponent for playing for the win (ENGINE_V2 Phase 5, objective "win"): his state as Sleeper shows it now - locked
// slots and points, held scores in his starting slots, players in a game, his lineup, finished games, injury tags (the
// play probabilities of his next games, tw.pNext) - turned into the human model's state (lib/engine/human.ts), and the
// distribution of his final total from M simulations of his rest of the week as a human. It does not depend on our
// decisions, so one distribution serves every decision of the plan (no later information about him exists yet).
import * as E from "../engine/core";
import * as H from "../engine/human";
import type { OppSource } from "../engine/p11";
import type { LiveTeam } from "./week";

export function humanSnapshot(T: LiveTeam): H.HState {
  const st = T.st; const nS = T.tw.slots.length, nP = T.pids.length;
  const hs: H.HState = {
    occ: new Int32Array(nS).fill(-1), locked: new Uint8Array(nS), pts: new Float64Array(nS), lockGame: new Int32Array(nS).fill(-1),
    held: new Float64Array(nP).fill(NaN), heldGame: new Int32Array(nP).fill(-1), inGame: new Int32Array(nP).fill(-1),
    isLocked: Uint8Array.from(st.isLocked), lastPlayed: Uint8Array.from(st.lastPlayed), e: 1, u: 0, mode: 0,
  };
  for (let s = 0; s < nS; s++) {
    if (st.lockedBy[s] >= 0) { hs.occ[s] = st.lockedBy[s]; hs.locked[s] = 1; hs.pts[s] = st.lockedPts[s]; continue; }
    if (st.pinned[s] >= 0) { const p = st.pinned[s]; hs.occ[s] = p; hs.inGame[p] = st.inGame[p]; continue; }
    const pid = T.lineup[s]; const p = pid ? T.pids.indexOf(pid) : -1;
    if (p < 0 || st.isLocked[p] || hs.occ.includes(p)) continue;
    hs.occ[s] = p; if (!Number.isNaN(st.pendingX[p])) hs.held[p] = st.pendingX[p];
  }
  return hs;
}
// the opponent's final-total distribution from his state at asOf (memoised: the snapshot is fixed for this view)
export function liveOppSource(T: LiveTeam | null, asOf: number, seed: number, M = 400): OppSource | null {
  if (!T) return null;
  let D: H.OppDist | null = null;
  return { dist: () => {
    if (!D) { const fromEv = H.firstEvAfter(T.tw, asOf); D = H.oppDist(H.oppSamples(T.tw, H.HUMAN, humanSnapshot(T), fromEv, asOf, T.real, M, E.rng(seed), H.HUMAN_RESID)); }
    return D;
  } };
}
