import { z } from "zod";

// Zod schemas for runtime validation

export const PositionSchema = z.enum(["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"]);

export const LeagueSettingsSchema = z.object({
  weekStartUtc: z.string().datetime(),
  weekEndUtc: z.string().datetime(),
  startingSlots: z.array(z.string().regex(/^(PG|SG|SF|PF|C|G|F|UTIL)(_\d+)?$/)),
  slotEligibility: z.record(PositionSchema, z.array(PositionSchema)),
});

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  eligible: z.array(PositionSchema),
});

export const GameStatusSchema = z.enum(["UPCOMING", "IN_PROGRESS", "FINAL"]);

export const GameProjectionSchema = z.object({
  gameId: z.string(),
  playerId: z.string(),
  tipoffUtc: z.string().datetime(),
  opponent: z.string(),
  projection: z.number(),
  variance: z.number().optional(),
  actual: z.number().optional(),
  status: GameStatusSchema,
});

export const RosterSchema = z.object({
  starters: z.array(z.string()),
  bench: z.array(z.string()),
});

export const WeekDataSchema = z.object({
  league: LeagueSettingsSchema,
  players: z.array(PlayerSchema),
  games: z.array(GameProjectionSchema),
  roster: RosterSchema,
});

export function validateWeekData(data: unknown): ReturnType<typeof WeekDataSchema.safeParse> {
  return WeekDataSchema.safeParse(data);
}

