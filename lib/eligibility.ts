import { Player, Position } from "@/types";

// Default NBA slot eligibility mapping
export const DEFAULT_SLOT_ELIGIBILITY: Record<Position, Position[]> = {
  PG: ["PG"],
  SG: ["SG"],
  G: ["PG", "SG"],
  SF: ["SF"],
  PF: ["PF"],
  F: ["SF", "PF"],
  C: ["C"],
  UTIL: ["PG", "SG", "SF", "PF", "C"],
};

/**
 * Check if a player is eligible for a specific slot
 */
export function isEligible(
  player: Player,
  slot: Position,
  slotEligibility: Record<Position, Position[]>
): boolean {
  // Strip number suffix for duplicate slots (e.g., "UTIL_2" -> "UTIL")
  const baseSlot = slot.replace(/_\d+$/, '') as Position;
  const acceptedPositions = slotEligibility[baseSlot] || slotEligibility[slot] || [];
  return player.eligible.some((pos) => acceptedPositions.includes(pos));
}

/**
 * Get all slots a player is eligible for
 */
export function getEligibleSlots(
  player: Player,
  slotEligibility: Record<Position, Position[]>
): Position[] {
  const slots: Position[] = [];
  for (const [slot, acceptedPositions] of Object.entries(slotEligibility)) {
    if (player.eligible.some((pos) => acceptedPositions.includes(pos))) {
      slots.push(slot as Position);
    }
  }
  return slots;
}

/**
 * Get scarcity score for a slot based on remaining games
 * Lower score = more scarce position
 */
export function getSlotScarcity(
  slot: Position,
  remainingPlayers: Player[],
  slotEligibility: Record<Position, Position[]>
): number {
  const eligibleCount = remainingPlayers.filter((p) =>
    isEligible(p, slot, slotEligibility)
  ).length;
  return eligibleCount;
}

