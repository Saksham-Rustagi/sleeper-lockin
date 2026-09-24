// Core type definitions for Sleeper Lock-In Optimizer

export type Position = "PG" | "SG" | "SF" | "PF" | "C" | "G" | "F" | "UTIL";

export interface LeagueSettings {
  weekStartUtc: string;   // ISO, Monday 00:00:00 UTC
  weekEndUtc: string;     // ISO, next Monday 00:00:00 UTC
  startingSlots: Position[]; // e.g., ["PG","SG","G","SF","PF","F","C","UTIL","UTIL"]
  slotEligibility: Record<Position, Position[]>; // e.g., { G:["PG","SG"], F:["SF","PF"], UTIL:["PG","SG","SF","PF","C"] }
}

export interface Player {
  id: string;
  name: string;
  eligible: Position[]; // player's eligible positions, e.g., ["SF","PF"]
}

export type GameStatus = "UPCOMING" | "IN_PROGRESS" | "FINAL";

export interface GameProjection {
  gameId: string;
  playerId: string;
  tipoffUtc: string;         // ISO tip‑off time
  opponent: string;
  projection: number;        // projected fantasy points
  variance?: number;         // optional std‑dev for risk modes
  actual?: number;           // filled post‑game
  status: GameStatus;
}

export interface Roster {
  starters: string[]; // playerIds initially intended as starters
  bench: string[];    // playerIds not intended to score
}

export interface WeekData {
  league: LeagueSettings;
  players: Player[];
  games: GameProjection[]; // all games for all players this week
  roster: Roster;
}

// Event types for timeline
export type EventType = "GAME_LOCK" | "GAME_RESULT";

export interface Event {
  type: EventType;
  time: string; // ISO timestamp
  playerId: string;
  gameId: string;
  projection?: number;
  actual?: number;
}

// Assignment types
export type Assignment = Map<Position, string>; // slot -> playerId

export interface LockedSlot {
  playerId: string;
  gameId: string;
  points: number;
}

export interface LockedState {
  lockedSlots: Map<Position, LockedSlot>;
  lockedPlayers: Set<string>;
}

export interface LockedPlan {
  assignments: Map<Position, { playerId: string; gameId: string; points: number }>;
  total: number;
}

// Lock decision types
export interface FinishedGame {
  playerId: string;
  gameId: string;
  actual: number;
}

export type LockDecision = {
  decision: "LOCK" | "PASS";
  slot?: Position;
  delta: number;
  rationale: string;
};

// Risk modes
export type RiskMode = "conservative" | "neutral" | "aggressive";

