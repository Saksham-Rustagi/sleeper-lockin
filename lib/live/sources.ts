// Live data sources: Sleeper (league, rosters, matchups, players, schedule, per-game projections & stats)
// and ESPN (tip-off times, live game status). Works server-side (API routes, notifier) and in the browser.
const SLEEPER = "https://api.sleeper.app";
const cache = new Map<string, { t: number; v: unknown }>();

// Optional on-disk cache for the background notifier (a fresh process every few minutes would otherwise
// re-download the 2.5 MB players file each run). Enabled when LOCKIN_CACHE_DIR is set (server-side only).
async function diskCache() {
  if (typeof window !== "undefined" || !process.env.LOCKIN_CACHE_DIR) return null;
  const fs = await import("fs"); const path = await import("path"); const crypto = await import("crypto");
  const dir = process.env.LOCKIN_CACHE_DIR; fs.mkdirSync(dir, { recursive: true });
  const file = (url: string) => path.join(dir, crypto.createHash("sha1").update(url).digest("hex") + ".json");
  return {
    get(url: string, ttl: number) { try { const f = file(url); if (Date.now() - fs.statSync(f).mtimeMs < ttl) return JSON.parse(fs.readFileSync(f, "utf8")); } catch {} return undefined; },
    set(url: string, v: unknown) { try { fs.writeFileSync(file(url), JSON.stringify(v)); } catch {} },
  };
}

async function getJSON<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v as T;
  const dc = ttlMs >= 10 * 60e3 ? await diskCache() : null;
  const dv = dc?.get(url, ttlMs);
  if (dv !== undefined) { cache.set(url, { t: Date.now(), v: dv }); return dv as T; }
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "sleeper-lockin/2.0" }, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const v = (await r.json()) as T;
      cache.set(url, { t: Date.now(), v });
      dc?.set(url, v);
      return v;
    } catch (e) { lastErr = e; await new Promise((res) => setTimeout(res, 400 * (i + 1))); }
  }
  throw lastErr;
}

const MIN = 60e3, HOUR = 3600e3;
export interface NbaState { week: number; season: string; season_type: string; league_season: string; previous_season: string; season_start_date: string }
export interface League { league_id: string; name: string; season: string; status: string; roster_positions: string[]; scoring_settings: Record<string, number>; settings: Record<string, number>; previous_league_id?: string; total_rosters: number }
export interface Roster { roster_id: number; owner_id: string; players: string[] | null; starters: string[] | null; reserve: string[] | null; taxi: string[] | null }
export interface Matchup { roster_id: number; matchup_id: number | null; starters: string[]; starters_points: number[]; players: string[]; players_points: Record<string, number>; points: number }
export interface SleeperPlayer { player_id: string; full_name?: string; first_name?: string; last_name?: string; team: string | null; fantasy_positions: string[] | null; injury_status: string | null; injury_body_part?: string | null; status?: string }
export interface SchedGame { game_id: string; date: string; week: number; status: string; home: { team: string }; away: { team: string } }
export interface GameRow { player_id: string; date: string; team: string; opponent: string; game_id: string; stats: Record<string, number> }

export const sleeper = {
  state: () => getJSON<NbaState>(`${SLEEPER}/v1/state/nba`, 10 * MIN),
  user: (u: string) => getJSON<{ user_id: string; username: string; display_name: string }>(`${SLEEPER}/v1/user/${encodeURIComponent(u)}`, HOUR),
  leagues: (uid: string, season: string) => getJSON<League[]>(`${SLEEPER}/v1/user/${uid}/leagues/nba/${season}`, 10 * MIN),
  league: (id: string) => getJSON<League>(`${SLEEPER}/v1/league/${id}`, 10 * MIN),
  users: (id: string) => getJSON<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(`${SLEEPER}/v1/league/${id}/users`, HOUR),
  rosters: (id: string) => getJSON<Roster[]>(`${SLEEPER}/v1/league/${id}/rosters`, 2 * MIN),
  matchups: (id: string, week: number) => getJSON<Matchup[]>(`${SLEEPER}/v1/league/${id}/matchups/${week}`, 1 * MIN),
  players: (ttlMs = 6 * HOUR) => getJSON<Record<string, SleeperPlayer>>(`${SLEEPER}/v1/players/nba`, ttlMs),
  transactions: (id: string, week: number) => getJSON<{ transaction_id: string; type: string; status: string; created: number; roster_ids: number[]; adds: Record<string, number> | null; drops: Record<string, number> | null; settings?: Record<string, number> }[]>(`${SLEEPER}/v1/league/${id}/transactions/${week}`, 5 * MIN),
  schedule: (season: string) => getJSON<SchedGame[]>(`${SLEEPER}/schedule/nba/regular/${season}`, 6 * HOUR),
  weekProjections: (season: string, week: number) => getJSON<GameRow[]>(`${SLEEPER}/projections/nba/${season}/${week}?season_type=regular`, 30 * MIN),
  weekStats: (season: string, week: number) => getJSON<GameRow[]>(`${SLEEPER}/stats/nba/${season}/${week}?season_type=regular`, 1 * MIN),
  seasonProjections: (season: string) => getJSON<Record<string, Record<string, number>>>(`${SLEEPER}/v1/projections/nba/regular/${season}`, 6 * HOUR),
};

// ---------- ESPN ----------
const ESPN_FIX: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
export interface EspnGame { id: string; tip: number; state: "pre" | "in" | "post"; detail: string; teams: string[]; scores: number[] }
export async function espnDay(date: string): Promise<EspnGame[]> {
  const d = date.replace(/-/g, "");
  const isPast = Date.parse(date + "T12:00:00Z") < Date.now() - 36 * HOUR;
  const j = await getJSON<{ events?: { id: string; date: string; status: { type: { state: string; shortDetail: string } }; competitions: { competitors: { score?: string; team: { abbreviation: string } }[] }[] }[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d}`, isPast ? 24 * HOUR : 1 * MIN);
  return (j.events || []).map((e) => ({
    id: e.id, tip: Date.parse(e.date), state: e.status.type.state as EspnGame["state"], detail: e.status.type.shortDetail,
    teams: e.competitions[0].competitors.map((c) => ESPN_FIX[c.team.abbreviation] ?? c.team.abbreviation),
    scores: e.competitions[0].competitors.map((c) => Number(c.score ?? 0)),
  }));
}
