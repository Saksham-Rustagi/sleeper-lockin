import { WeekData, Position, GameStatus } from "@/types";
import { validateWeekData } from "./validation";

/**
 * Parse CSV file to WeekData
 * CSV Format: player,positions,tipoffUtc,opponent,projection,variance(optional),actual(optional),status
 */
export async function parseCSV(file: File): Promise<WeekData> {
  const text = await file.text();
  const lines = text.trim().split("\n");

  if (lines.length < 2) {
    throw new Error("CSV file must have header and at least one data row");
  }

  const header = lines[0].toLowerCase().split(",");
  const data = lines.slice(1);

  const playerMap = new Map<string, { name: string; positions: Position[] }>();
  const games: any[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i].split(",");
    const playerName = row[0]?.trim();
    const positions = row[1]
      ?.trim()
      .split("/")
      .map((p) => p.trim() as Position);
    const tipoffUtc = row[2]?.trim();
    const opponent = row[3]?.trim();
    const projection = parseFloat(row[4]?.trim() || "0");
    const variance = row[5]?.trim() ? parseFloat(row[5].trim()) : undefined;
    const actual = row[6]?.trim() ? parseFloat(row[6].trim()) : undefined;
    const status = (row[7]?.trim() || "UPCOMING") as GameStatus;

    if (!playerName || !positions || !tipoffUtc || !opponent) {
      throw new Error(`Invalid row ${i + 2}: missing required fields`);
    }

    // Add player
    if (!playerMap.has(playerName)) {
      playerMap.set(playerName, { name: playerName, positions });
    }

    // Add game
    games.push({
      gameId: `game_${i}`,
      playerId: playerName,
      tipoffUtc,
      opponent,
      projection,
      variance,
      actual,
      status,
    });
  }

  // Build default league settings
  const weekData: WeekData = {
    league: {
      weekStartUtc: games[0]?.tipoffUtc || new Date().toISOString(),
      weekEndUtc:
        games[games.length - 1]?.tipoffUtc || new Date().toISOString(),
      startingSlots: ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"],
      slotEligibility: {
        PG: ["PG"],
        SG: ["SG"],
        G: ["PG", "SG"],
        SF: ["SF"],
        PF: ["PF"],
        F: ["SF", "PF"],
        C: ["C"],
        UTIL: ["PG", "SG", "SF", "PF", "C"],
      },
    },
    players: Array.from(playerMap.entries()).map(([id, { name, positions }]) => ({
      id,
      name,
      eligible: positions,
    })),
    games,
    roster: {
      starters: Array.from(playerMap.keys()).slice(0, 9),
      bench: Array.from(playerMap.keys()).slice(9),
    },
  };

  const validation = validateWeekData(weekData);
  if (!validation.success) {
    throw new Error(`Invalid week data: ${validation.error.message}`);
  }

  return weekData;
}

/**
 * Parse JSON file to WeekData
 */
export async function parseJSON(file: File): Promise<WeekData> {
  const text = await file.text();
  const data = JSON.parse(text);

  const validation = validateWeekData(data);
  if (!validation.success) {
    throw new Error(`Invalid week data: ${validation.error.message}`);
  }

  return validation.data as WeekData;
}

/**
 * Export WeekData to JSON
 */
export function exportToJSON(weekData: WeekData): string {
  return JSON.stringify(weekData, null, 2);
}

/**
 * Export WeekData to CSV
 */
export function exportToCSV(weekData: WeekData): string {
  const lines: string[] = [
    "player,positions,tipoffUtc,opponent,projection,variance,actual,status",
  ];

  for (const game of weekData.games) {
    const player = weekData.players.find((p) => p.id === game.playerId);
    if (player) {
      lines.push(
        [
          player.name,
          player.eligible.join("/"),
          game.tipoffUtc,
          game.opponent,
          game.projection,
          game.variance || "",
          game.actual || "",
          game.status,
        ].join(",")
      );
    }
  }

  return lines.join("\n");
}

