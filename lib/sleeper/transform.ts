import { WeekData, Player, Position, GameProjection, Roster } from "@/types";
import {
  SleeperLeague,
  SleeperRoster,
  SleeperPlayer,
  fetchNBAPlayers,
} from "./api";

/**
 * Map Sleeper position to our Position type
 */
function mapSleeperPosition(pos: string): Position | null {
  const mapping: Record<string, Position> = {
    PG: "PG",
    SG: "SG",
    SF: "SF",
    PF: "PF",
    C: "C",
    G: "G",
    F: "F",
    UTIL: "UTIL",
    FLEX: "UTIL", // FLEX maps to UTIL
  };
  return mapping[pos] || null;
}

/**
 * Build slot eligibility from roster positions
 */
function buildSlotEligibility(
  rosterPositions: string[]
): Record<Position, Position[]> {
  // Default mapping
  const eligibility: Record<Position, Position[]> = {
    PG: ["PG"],
    SG: ["SG"],
    G: ["PG", "SG"],
    SF: ["SF"],
    PF: ["PF"],
    F: ["SF", "PF"],
    C: ["C"],
    UTIL: ["PG", "SG", "SF", "PF", "C"],
  };

  // Could be enhanced based on league-specific roster_positions
  return eligibility;
}

/**
 * Transform Sleeper league to our LeagueSettings
 */
export function transformLeague(
  league: SleeperLeague,
  weekStartUtc: string,
  weekEndUtc: string
) {
  // Map all roster positions from Sleeper, excluding BN (bench)
  const startingSlots: Position[] = [];
  const positionCounts: Record<string, number> = {};
  
  for (const pos of league.roster_positions) {
    if (pos === "BN") continue; // Skip bench
    const mapped = mapSleeperPosition(pos);
    if (mapped) {
      // Track count for duplicate positions (e.g., UTIL, UTIL)
      positionCounts[mapped] = (positionCounts[mapped] || 0) + 1;
      
      // If this is a duplicate, append number to make it unique
      if (positionCounts[mapped] > 1) {
        startingSlots.push(`${mapped}_${positionCounts[mapped]}` as Position);
      } else {
        startingSlots.push(mapped);
      }
    }
  }

  return {
    weekStartUtc,
    weekEndUtc,
    startingSlots, // Use all starting slots from league (not limited to 9)
    slotEligibility: buildSlotEligibility(league.roster_positions),
  };
}

/**
 * Transform Sleeper players to our Player type
 */
export async function transformPlayers(
  playerIds: string[]
): Promise<Player[]> {
  const sleeperPlayers = await fetchNBAPlayers();
  const players: Player[] = [];

  for (const playerId of playerIds) {
    const sleeperPlayer = sleeperPlayers[playerId];
    if (sleeperPlayer) {
      const eligible = (sleeperPlayer.fantasy_positions || [])
        .map(mapSleeperPosition)
        .filter((p): p is Position => p !== null);

      players.push({
        id: playerId,
        name: `${sleeperPlayer.first_name} ${sleeperPlayer.last_name}`,
        eligible: eligible.length > 0 ? eligible : ["UTIL"],
      });
    }
  }

  return players;
}

/**
 * Transform Sleeper roster to our Roster type
 */
export function transformRoster(roster: SleeperRoster): Roster {
  return {
    starters: roster.starters || [],
    bench: (roster.players || []).filter((p) => !roster.starters.includes(p)),
  };
}

/**
 * Create mock game projections for a week
 * In a real implementation, this would fetch from a projections API
 */
export function createMockGameProjections(
  playerIds: string[],
  weekStartUtc: string,
  weekEndUtc: string
): GameProjection[] {
  const games: GameProjection[] = [];
  const startDate = new Date(weekStartUtc);
  const endDate = new Date(weekEndUtc);
  const daysInWeek = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Mock: each player gets 3-4 games during the week
  for (const playerId of playerIds) {
    const numGames = 3 + Math.floor(Math.random() * 2); // 3-4 games

    for (let i = 0; i < numGames; i++) {
      const dayOffset = Math.floor((i / numGames) * daysInWeek);
      const gameDate = new Date(startDate);
      gameDate.setDate(gameDate.getDate() + dayOffset);
      gameDate.setHours(19 + Math.floor(Math.random() * 4), 0, 0, 0); // 7pm-11pm

      games.push({
        gameId: `${playerId}_game_${i}`,
        playerId,
        tipoffUtc: gameDate.toISOString(),
        opponent: ["LAL", "BOS", "GSW", "MIA", "PHX", "DAL", "DEN"][
          Math.floor(Math.random() * 7)
        ],
        projection: 15 + Math.random() * 30, // 15-45 points
        variance: 5 + Math.random() * 10, // 5-15 variance
        status: "UPCOMING",
      });
    }
  }

  // Sort by tipoff
  games.sort(
    (a, b) => new Date(a.tipoffUtc).getTime() - new Date(b.tipoffUtc).getTime()
  );

  return games;
}

/**
 * Main transformation: Sleeper league + roster -> WeekData
 */
export async function transformToWeekData(
  league: SleeperLeague,
  roster: SleeperRoster,
  weekStartUtc: string,
  weekEndUtc: string
): Promise<WeekData> {
  const allPlayerIds = [...(roster.players || [])];
  const players = await transformPlayers(allPlayerIds);
  const leagueSettings = transformLeague(league, weekStartUtc, weekEndUtc);
  const rosterData = transformRoster(roster);

  // Create mock projections
  // In production, integrate with a real projections source
  const games = createMockGameProjections(allPlayerIds, weekStartUtc, weekEndUtc);

  return {
    league: leagueSettings,
    players,
    games,
    roster: rosterData,
  };
}

