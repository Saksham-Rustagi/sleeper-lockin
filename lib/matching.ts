import { Player, Position, GameProjection } from "@/types";
import { isEligible } from "./eligibility";

// Exact max-weight assignment (rows = players, cols = slots). Leaves rows/cols unmatched
// when that is better. DP over slot bitmask: O(rows * 2^cols * cols) — trivial for 9 slots.
function exactAssignment(weights: number[][]): number[] {
  const n = weights.length;
  const m = weights[0]?.length || 0;
  const full = 1 << m;
  // best[i][mask] = best total using rows i.. with slots in mask already taken
  const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(full));
  const choice: Int16Array[] = Array.from({ length: n + 1 }, () => new Int16Array(full).fill(-1));
  for (let i = n - 1; i >= 0; i--) {
    for (let mask = 0; mask < full; mask++) {
      let b = best[i + 1][mask];
      let c = -1;
      for (let j = 0; j < m; j++) {
        if (mask & (1 << j)) continue;
        const w = weights[i][j];
        if (w === -Infinity || !Number.isFinite(w)) continue;
        const v = w + best[i + 1][mask | (1 << j)];
        if (v > b + 1e-9) { b = v; c = j; }
      }
      best[i][mask] = b;
      choice[i][mask] = c;
    }
  }
  const out = new Array(n).fill(-1);
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const c = choice[i][mask];
    out[i] = c;
    if (c >= 0) mask |= 1 << c;
  }
  return out;
}

/**
 * Maximum-weight assignment (rows = players, cols = slots). Exact (DP over slot bitmask), slots may stay empty.
 * (The previous version was a greedy approximation despite its name.)
 */
export function hungarianAlgorithm(weights: number[][]): number[] {
  return exactAssignment(weights);
}

/**
 * Find maximum matching using DFS (for feasibility check)
 */
export function findMaxMatching(graph: boolean[][]): number[] {
  const n = graph.length;
  const m = graph[0]?.length || 0;
  const match: number[] = new Array(n).fill(-1);
  const used = new Array(m).fill(false);
  
  function dfs(u: number): boolean {
    for (let v = 0; v < m; v++) {
      if (graph[u][v] && !used[v]) {
        used[v] = true;
        if (match[u] === -1 || dfs(match[u])) {
          match[u] = v;
          return true;
        }
      }
    }
    return false;
  }
  
  for (let u = 0; u < n; u++) {
    used.fill(false);
    dfs(u);
  }
  
  return match;
}

/**
 * Calculate scarcity penalty for a slot
 * Returns a small penalty value to subtract from weight (incentive to save scarce slots)
 */
export function scarcityPenalty(
  slot: Position,
  remainingGames: GameProjection[],
  players: Player[],
  slotEligibility: Record<Position, Position[]>
): number {
  // Count how many future eligible player-game combinations exist for this slot
  let eligibleGameCount = 0;
  
  for (const game of remainingGames) {
    const player = players.find(p => p.id === game.playerId);
    if (player && isEligible(player, slot, slotEligibility)) {
      eligibleGameCount++;
    }
  }
  
  // More scarce = higher penalty
  // Use log to smooth the penalty curve
  const scarcity = Math.max(0, Math.log(eligibleGameCount + 1));
  return scarcity * 0.1; // Small penalty coefficient
}

/**
 * Build bipartite graph for matching
 * Returns weight matrix where rows = players, cols = slots
 */
export function buildWeightMatrix(
  players: Player[],
  slots: Position[],
  weights: Map<string, number>, // playerId -> weight
  slotEligibility: Record<Position, Position[]>,
  remainingGames: GameProjection[] = [],
  allPlayers: Player[] = []
): number[][] {
  const matrix: number[][] = [];
  
  for (const player of players) {
    const row: number[] = [];
    for (const slot of slots) {
      if (isEligible(player, slot, slotEligibility)) {
        const baseWeight = weights.get(player.id) || 0;
        const penalty = 0 && allPlayers.length > 0 
          ? scarcityPenalty(slot, remainingGames, allPlayers, slotEligibility)
          : 0;
        row.push(baseWeight - penalty);
      } else {
        row.push(-Infinity); // Not eligible
      }
    }
    matrix.push(row);
  }
  
  return matrix;
}

/**
 * Solve maximum weight matching problem
 */
export function solveMaxWeightMatching(
  players: Player[],
  slots: Position[],
  weights: Map<string, number>,
  slotEligibility: Record<Position, Position[]>,
  remainingGames: GameProjection[] = [],
  allPlayers: Player[] = []
): Map<Position, string> {
  const matrix = buildWeightMatrix(players, slots, weights, slotEligibility, remainingGames, allPlayers);
  const assignment = hungarianAlgorithm(matrix);
  
  const result = new Map<Position, string>();
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] !== -1 && assignment[i] < slots.length) {
      result.set(slots[assignment[i]], players[i].id);
    }
  }
  
  return result;
}

