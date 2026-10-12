import {
  WeekData,
  Event,
  Assignment,
  LockedState,
  LockDecision,
  FinishedGame,
  Position,
  Player,
  GameProjection,
} from "@/types";
import { compareTimes } from "./time";
import { solveMaxWeightMatching } from "./matching";
import { isEligible } from "./eligibility";

/**
 * Build chronological timeline of events
 */
export function buildTimeline(week: WeekData): Event[] {
  const events: Event[] = [];

  for (const game of week.games) {
    // GAME_LOCK event at tip-off
    events.push({
      type: "GAME_LOCK",
      time: game.tipoffUtc,
      playerId: game.playerId,
      gameId: game.gameId,
      projection: game.projection,
    });

    // GAME_RESULT event when game is final
    if (game.status === "FINAL" && game.actual !== undefined) {
      events.push({
        type: "GAME_RESULT",
        time: game.tipoffUtc, // In real scenario, this would be end time
        playerId: game.playerId,
        gameId: game.gameId,
        actual: game.actual,
      });
    }
  }

  // Sort by time
  events.sort((a, b) => compareTimes(a.time, b.time));

  return events;
}

/**
 * Compute expected value with variance adjustment
 */
export function computeEV(projection: number, variance: number = 0, lambda: number = 0): number {
  return projection + lambda * variance;
}

/**
 * Get risk tolerance epsilon based on mode
 */
export function getRiskEpsilon(mode: "conservative" | "neutral" | "aggressive"): number {
  switch (mode) {
    case "conservative":
      return -2;
    case "neutral":
      return 0;
    case "aggressive":
      return 2;
  }
}

/**
 * Recommend which players to start at a given tip-off time
 */
export function recommendStartsAt(
  t: string,
  week: WeekData,
  locked: LockedState,
  varianceLambda: number = 0
): Assignment {
  // Get all players with games locking at time t
  const playersLockingNow = week.games
    .filter((g) => g.tipoffUtc === t)
    .map((g) => g.playerId);

  // Get all players already locked
  const alreadyLocked = locked.lockedPlayers;

  // Get open slots (not yet locked)
  const openSlots: Position[] = week.league.startingSlots.filter(
    (slot) => !locked.lockedSlots.has(slot)
  );

  // Get players locking now that aren't already locked
  const availablePlayers = week.players.filter(
    (p) => playersLockingNow.includes(p.id) && !alreadyLocked.has(p.id)
  );

  if (availablePlayers.length === 0 || openSlots.length === 0) {
    return new Map();
  }

  // Build weight map (expected value of this game)
  const weights = new Map<string, number>();
  for (const player of availablePlayers) {
    const game = week.games.find((g) => g.playerId === player.id && g.tipoffUtc === t);
    if (game) {
      const ev = computeEV(game.projection, game.variance, varianceLambda);
      weights.set(player.id, ev);
    }
  }

  // Get remaining games (after time t) for scarcity calculation
  const remainingGames = week.games.filter((g) => compareTimes(g.tipoffUtc, t) > 0);

  // Solve matching
  const assignment = solveMaxWeightMatching(
    availablePlayers,
    openSlots,
    weights,
    week.league.slotEligibility,
    remainingGames,
    week.players
  );

  return assignment;
}

/**
 * Compute best expected total for remaining slots without locking this player
 */
export function computeBestRemaining(
  openSlots: Position[],
  availablePlayers: Player[],
  futureGames: GameProjection[],
  slotEligibility: Record<Position, Position[]>,
  varianceLambda: number = 0
): number {
  if (openSlots.length === 0) return 0;

  // For each player, find their best future game
  const weights = new Map<string, number>();
  const playersWithGames = new Set<string>();

  for (const player of availablePlayers) {
    const playerGames = futureGames.filter((g) => g.playerId === player.id);
    if (playerGames.length > 0) {
      // Value of keeping this player unlocked = optimal-stopping value over his remaining games:
      // V_last = proj_last (final game counts automatically); V_k = E[max(X_k, V_{k+1})]
      const gs = [...playerGames].sort((a, b) => compareTimes(a.tipoffUtc, b.tipoffUtc));
      let v = gs[gs.length - 1].projection;
      for (let k = gs.length - 2; k >= 0; k--) {
        const mu = gs[k].projection, sd = Math.max(1e-6, gs[k].variance ?? 8);
        const z = (mu - v) / sd;
        const phi = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
        const Phi = 0.5 * (1 + erf(z / Math.SQRT2));
        v = v + (mu - v) * Phi + sd * phi;
      }
      weights.set(player.id, v);
      playersWithGames.add(player.id);
    }
  }

  const eligiblePlayers = availablePlayers.filter((p) => playersWithGames.has(p.id));

  if (eligiblePlayers.length === 0) return 0;

  // Solve matching to get best total
  const assignment = solveMaxWeightMatching(
    eligiblePlayers,
    openSlots,
    weights,
    slotEligibility
  );

  let total = 0;
  for (const [slot, playerId] of assignment) {
    total += weights.get(playerId) || 0;
  }

  return total;
}

/**
 * Decide whether to lock a finished game
 */
export function recommendLock(
  finished: FinishedGame,
  week: WeekData,
  locked: LockedState,
  riskMode: "conservative" | "neutral" | "aggressive" = "neutral",
  varianceLambda: number = 0
): LockDecision {
  const player = week.players.find((p) => p.id === finished.playerId);
  if (!player) {
    return {
      decision: "PASS",
      delta: 0,
      rationale: "Player not found",
    };
  }

  const epsilon = getRiskEpsilon(riskMode);

  // Get open slots
  const openSlots: Position[] = week.league.startingSlots.filter(
    (slot) => !locked.lockedSlots.has(slot)
  );

  // Find which slots this player is eligible for
  const eligibleSlots = openSlots.filter((slot) =>
    isEligible(player, slot, week.league.slotEligibility)
  );

  if (eligibleSlots.length === 0) {
    return {
      decision: "PASS",
      delta: 0,
      rationale: "No eligible open slots available",
    };
  }

  // Get this player's future games
  const currentGame = week.games.find((g) => g.gameId === finished.gameId);
  const futureGames = week.games.filter(
    (g) =>
      g.playerId === finished.playerId &&
      currentGame &&
      compareTimes(g.tipoffUtc, currentGame.tipoffUtc) > 0
  );

  // Get available players for future (excluding locked ones)
  const availablePlayers = week.players.filter((p) => !locked.lockedPlayers.has(p.id));

  // Remaining games after now
  const remainingGames = week.games.filter(
    (g) => currentGame && compareTimes(g.tipoffUtc, currentGame.tipoffUtc) > 0
  );

  // Compute best remaining without locking this player
  const bestRemainingWithoutLock = computeBestRemaining(
    openSlots,
    availablePlayers,
    remainingGames,
    week.league.slotEligibility,
    varianceLambda
  );

  // Compute best with locking this player to their best eligible slot
  let bestWithLock = -Infinity;
  let bestSlot: Position | undefined;

  for (const slot of eligibleSlots) {
    // Lock this player to this slot
    const remainingSlotsAfterLock = openSlots.filter((s) => s !== slot);
    const remainingPlayersAfterLock = availablePlayers.filter(
      (p) => p.id !== finished.playerId
    );

    const restTotal = computeBestRemaining(
      remainingSlotsAfterLock,
      remainingPlayersAfterLock,
      remainingGames,
      week.league.slotEligibility,
      varianceLambda
    );

    const totalWithLock = finished.actual + restTotal;

    if (totalWithLock > bestWithLock) {
      bestWithLock = totalWithLock;
      bestSlot = slot;
    }
  }

  const delta = bestWithLock - bestRemainingWithoutLock;

  if (delta >= epsilon && bestSlot) {
    const futureGameInfo =
      futureGames.length > 0
        ? `Future game proj: ${futureGames[0].projection.toFixed(1)}`
        : "no future games";

    return {
      decision: "LOCK",
      slot: bestSlot,
      delta,
      rationale: `Locking now (${finished.actual.toFixed(
        1
      )} pts) is better than waiting. Delta: +${delta.toFixed(
        1
      )}. ${futureGameInfo}`,
    };
  } else {
    const futureGameInfo =
      futureGames.length > 0
        ? `Wait for next game (proj: ${futureGames[0].projection.toFixed(1)})`
        : "No better future games";

    return {
      decision: "PASS",
      delta,
      rationale: `Keep options open. ${futureGameInfo}. Delta: ${delta.toFixed(1)}`,
    };
  }
}


function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
