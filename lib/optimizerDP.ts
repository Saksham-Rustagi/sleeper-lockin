import { WeekData, LockedPlan, Position, GameProjection } from "@/types";
import { isEligible } from "./eligibility";

interface DPState {
  lockedSlotsMask: number; // Bitmask of locked slots
  lockedPlayerSet: Set<string>;
  eventIndex: number;
  total: number;
  assignments: Map<Position, { playerId: string; gameId: string; points: number }>;
}

/**
 * Exact DP solver assuming all actuals are known
 * Returns optimal locked plan with maximum total points
 */
export function solveExactDP(
  week: WeekData,
  timeoutMs: number = 200
): { total: number; plan: LockedPlan } {
  const startTime = Date.now();

  // Get all FINAL games with actuals
  const finalGames = week.games.filter(
    (g) => g.status === "FINAL" && g.actual !== undefined
  );

  if (finalGames.length === 0) {
    return {
      total: 0,
      plan: { assignments: new Map(), total: 0 },
    };
  }

  const slots = week.league.startingSlots;
  const slotCount = slots.length;

  // Memoization: key = (slotMask, playerIds joined)
  const memo = new Map<string, DPState>();

  function getMemoKey(slotMask: number, playerSet: Set<string>): string {
    return `${slotMask}:${Array.from(playerSet).sort().join(",")}`;
  }

  function dp(
    slotMask: number,
    lockedPlayers: Set<string>,
    availableGames: GameProjection[]
  ): DPState | null {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      return null; // Timeout
    }

    // Base case: all slots filled
    if (slotMask === (1 << slotCount) - 1) {
      return {
        lockedSlotsMask: slotMask,
        lockedPlayerSet: new Set(lockedPlayers),
        eventIndex: 0,
        total: 0,
        assignments: new Map(),
      };
    }

    const memoKey = getMemoKey(slotMask, lockedPlayers);
    if (memo.has(memoKey)) {
      return memo.get(memoKey)!;
    }

    let bestState: DPState | null = null;

    // Try assigning each available game to each open slot
    for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
      if ((slotMask & (1 << slotIdx)) !== 0) continue; // Slot already filled

      const slot = slots[slotIdx];

      for (const game of availableGames) {
        if (lockedPlayers.has(game.playerId)) continue;

        const player = week.players.find((p) => p.id === game.playerId);
        if (!player || !isEligible(player, slot, week.league.slotEligibility)) continue;

        const actual = game.actual!;
        const newSlotMask = slotMask | (1 << slotIdx);
        const newLockedPlayers = new Set(lockedPlayers);
        newLockedPlayers.add(game.playerId);

        // Remaining games from players not locked
        const newAvailableGames = availableGames.filter(
          (g) => !newLockedPlayers.has(g.playerId)
        );

        const nextState = dp(newSlotMask, newLockedPlayers, newAvailableGames);

        if (nextState) {
          const totalWithThis = actual + nextState.total;

          if (!bestState || totalWithThis > bestState.total) {
            const newAssignments = new Map(nextState.assignments);
            newAssignments.set(slot, {
              playerId: game.playerId,
              gameId: game.gameId,
              points: actual,
            });

            bestState = {
              lockedSlotsMask: newSlotMask,
              lockedPlayerSet: newLockedPlayers,
              eventIndex: 0,
              total: totalWithThis,
              assignments: newAssignments,
            };
          }
        }
      }
    }

    if (bestState) {
      memo.set(memoKey, bestState);
    }

    return bestState;
  }

  const result = dp(0, new Set(), finalGames);

  if (!result) {
    // Timeout or no solution - return empty
    return {
      total: 0,
      plan: { assignments: new Map(), total: 0 },
    };
  }

  return {
    total: result.total,
    plan: {
      assignments: result.assignments,
      total: result.total,
    },
  };
}

