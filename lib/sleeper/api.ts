// Sleeper API client with rate limiting

const BASE_URL = "https://api.sleeper.app/v1";
const RATE_LIMIT_MS = 60; // Max 1000 calls per minute = ~16 per second, so 60ms between calls

let lastCallTime = 0;

/**
 * Rate-limited fetch wrapper
 */
async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;

  if (timeSinceLastCall < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastCall)
    );
  }

  lastCallTime = Date.now();
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Resource not found");
    } else if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    } else if (response.status >= 500) {
      throw new Error("Sleeper server error");
    } else {
      throw new Error(`HTTP error ${response.status}`);
    }
  }

  return response;
}

export interface SleeperUser {
  username: string;
  user_id: string;
  display_name: string;
  avatar: string;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  sport: string;
  season: string;
  status: string;
  roster_positions: string[];
  settings: any;
  scoring_settings: any;
  total_rosters: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  starters: string[];
  reserve: string[];
  settings: any;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  fantasy_positions: string[];
  team: string;
  position: string;
  status: string;
}

export interface SleeperMatchup {
  roster_id: number;
  starters: string[];
  players: string[];
  matchup_id: number;
  points: number;
}

export interface NBAState {
  week: number;
  season: string;
  season_type: string;
  leg: number;
}

/**
 * Fetch user by username
 */
export async function fetchUser(username: string): Promise<SleeperUser> {
  const response = await rateLimitedFetch(`${BASE_URL}/user/${username}`);
  return response.json();
}

/**
 * Fetch all leagues for a user
 */
export async function fetchUserLeagues(
  userId: string,
  sport: string = "nba",
  season: string = String(new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1)
): Promise<SleeperLeague[]> {
  const response = await rateLimitedFetch(
    `${BASE_URL}/user/${userId}/leagues/${sport}/${season}`
  );
  return response.json();
}

/**
 * Fetch specific league details
 */
export async function fetchLeague(leagueId: string): Promise<SleeperLeague> {
  const response = await rateLimitedFetch(`${BASE_URL}/league/${leagueId}`);
  return response.json();
}

/**
 * Fetch all rosters in a league
 */
export async function fetchRosters(
  leagueId: string
): Promise<SleeperRoster[]> {
  const response = await rateLimitedFetch(
    `${BASE_URL}/league/${leagueId}/rosters`
  );
  return response.json();
}

/**
 * Fetch matchups for a specific week
 */
export async function fetchMatchups(
  leagueId: string,
  week: number
): Promise<SleeperMatchup[]> {
  const response = await rateLimitedFetch(
    `${BASE_URL}/league/${leagueId}/matchups/${week}`
  );
  return response.json();
}

/**
 * Fetch all NBA players (should be cached)
 */
export async function fetchNBAPlayers(): Promise<
  Record<string, SleeperPlayer>
> {
  // Check localStorage cache first
  const cached = localStorage.getItem("sleeper_nba_players");
  const cacheTime = localStorage.getItem("sleeper_nba_players_time");

  if (cached && cacheTime) {
    const age = Date.now() - parseInt(cacheTime);
    // Cache for 24 hours
    if (age < 24 * 60 * 60 * 1000) {
      return JSON.parse(cached);
    }
  }

  // Fetch fresh data
  const response = await rateLimitedFetch(`${BASE_URL}/players/nba`);
  const data = await response.json();

  // Cache it
  localStorage.setItem("sleeper_nba_players", JSON.stringify(data));
  localStorage.setItem("sleeper_nba_players_time", Date.now().toString());

  return data;
}

/**
 * Fetch NBA state (current week/season)
 */
export async function fetchNBAState(): Promise<NBAState> {
  const response = await rateLimitedFetch(`${BASE_URL}/state/nba`);
  return response.json();
}

/**
 * Clear player cache
 */
export function clearPlayerCache(): void {
  localStorage.removeItem("sleeper_nba_players");
  localStorage.removeItem("sleeper_nba_players_time");
}

