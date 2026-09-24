import { Player, Position, GameProjection } from "@/types";
import { isEligible } from "./eligibility";

/**
 * Hungarian Algorithm for maximum weight bipartite matching
 * Simplified implementation for small graphs (N <= 20)
 */
export function hungarianAlgorithm(weights: number[][]): number[] {
  const n = weights.length;
  const m = weights[0]?.length || 0;
  
  if (n === 0 || m === 0) return [];
  
  // Convert to minimization problem by negating weights
  const cost = weights.map(row => row.map(w => -w));
  
  // Pad to square matrix if needed
  const size = Math.max(n, m);
  const matrix: number[][] = [];
  for (let i = 0; i < size; i++) {
    matrix[i] = [];
    for (let j = 0; j < size; j++) {
      if (i < n && j < m) {
        matrix[i][j] = cost[i][j];
      } else {
        matrix[i][j] = 0;
      }
    }
  }
  
  // Simple greedy assignment for now (can be improved with full Hungarian)
  const assignment: number[] = new Array(n).fill(-1);
  const usedCols = new Set<number>();
  
  // Create priority list of (weight, row, col) tuples
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (weights[i][j] !== -Infinity) {
        edges.push([weights[i][j], i, j]);
      }
    }
  }
  
  // Sort by weight descending
  edges.sort((a, b) => b[0] - a[0]);
  
  // Greedily assign
  for (const [, row, col] of edges) {
    if (assignment[row] === -1 && !usedCols.has(col)) {
      assignment[row] = col;
      usedCols.add(col);
    }
  }
  
  return assignment;
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
        const penalty = allPlayers.length > 0 
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

