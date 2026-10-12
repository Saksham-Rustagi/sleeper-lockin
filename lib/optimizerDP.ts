import { WeekData, LockedPlan, Position } from "@/types";
import { isEligible } from "./eligibility";
import { hungarianAlgorithm } from "./matching";

/**
 * Best possible locked lineup with hindsight (all actuals known): each player contributes his best
 * finished game; exact max-weight assignment of players to slots. Exact and instant (no timeout).
 */
export function solveExactDP(week: WeekData, _timeoutMs: number = 200): { total: number; plan: LockedPlan } {
  const best = new Map<string, { gameId: string; points: number }>();
  for (const g of week.games) {
    if (g.status !== "FINAL" || g.actual === undefined) continue;
    const b = best.get(g.playerId);
    if (!b || g.actual > b.points) best.set(g.playerId, { gameId: g.gameId, points: g.actual });
  }
  const players = week.players.filter((p) => best.has(p.id) && best.get(p.id)!.points > 0);
  const slots = week.league.startingSlots;
  const W = players.map((p) => slots.map((s) => (isEligible(p, s, week.league.slotEligibility) ? best.get(p.id)!.points : -Infinity)));
  const a = players.length ? hungarianAlgorithm(W) : [];
  const assignments = new Map<Position, { playerId: string; gameId: string; points: number }>();
  let total = 0;
  a.forEach((j, i) => { if (j >= 0) { const b = best.get(players[i].id)!; assignments.set(slots[j], { playerId: players[i].id, gameId: b.gameId, points: b.points }); total += b.points; } });
  return { total, plan: { assignments, total } };
}
