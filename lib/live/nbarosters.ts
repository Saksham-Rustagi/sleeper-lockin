// Task R: current NBA team rosters (ESPN) as a check on Sleeper's player team. Sleeper keeps a waived player's team for
// days and drops his per-game projection rows, so buildWeek fell back to his season projection for every game of a team
// he can no longer play for (Kevin Porter Jr., waived by MIL Oct 19 2026: 21.3 fp planned for 3 MIL games). A player
// whose Sleeper team's current roster does not list him gets no games for that team; one listed by another team's roster
// gets that team's games (Sleeper lags signings too). Fail-safe: no fetch, a team missing or with fewer than MIN_ROSTER
// players listed, or a possible name variant on the roster (same last name) -> nothing changes for that team.
// Switch: "rosterCheck" (default on) in ~/.sleeper-lockin/config.json, env LOCKIN_ROSTER_CHECK (lib/live/override.ts).
import { espnTeams, espnRoster, type SleeperPlayer } from "./sources";
import { normName } from "./boxscores";
import { optionOn } from "./override";

export type TeamRosters = Map<string, { espnId: string; name: string }[]>;
// to = the team whose games he plays from now on (null: none until he signs)
export interface RosterFix { pid: string; from: string | null; to: string | null; label: string }
export const MIN_ROSTER = 13;

// one fetch of the 30 rosters per 10 min per process (sources.ts caches each response 1 h, on disk with LOCKIN_CACHE_DIR);
// a failed fetch is remembered for 5 min so a dead ESPN never slows every buildWeek
let memo: { at: number; v: TeamRosters | null } | null = null;
let inflight: Promise<TeamRosters | null> | null = null;
export function resetRosterMemo() { memo = null; inflight = null; }
export async function nbaRosters(): Promise<TeamRosters | null> {
  if (typeof window !== "undefined" || !optionOn("rosterCheck")) return null;
  if (memo && Date.now() - memo.at < (memo.v ? 10 : 5) * 60e3) return memo.v;
  if (!inflight) inflight = (async () => {
    let v: TeamRosters | null = null;
    try {
      const teams = await espnTeams();
      const rs = await Promise.all(teams.map((t) => espnRoster(t.id).then((r) => [t.team, r] as [string, { espnId: string; name: string }[]]).catch(() => null)));
      v = new Map(rs.filter((x): x is [string, { espnId: string; name: string }[]] => !!x));
      if (!v.size) v = null;
    } catch { v = null; }
    memo = { at: Date.now(), v }; inflight = null; return v;
  })();
  return inflight;
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const lastKey = (name: string) => { const t = name.trim().split(/\s+/).filter((x) => !SUFFIX.test(x)); return normName(t[t.length - 1] ?? ""); };
const fullName = (p: SleeperPlayer) => p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
// Sleeper players by normalised name (homonyms), built once per players object
const byNameMemo = new WeakMap<object, Map<string, { pid: string; team: string | null }[]>>();
function byName(players: Record<string, SleeperPlayer>) {
  let m = byNameMemo.get(players);
  if (!m) {
    m = new Map();
    for (const [pid, p] of Object.entries(players)) { const n = fullName(p); if (!n) continue; const k = normName(n); if (!m.has(k)) m.set(k, []); m.get(k)!.push({ pid, team: p.team }); }
    byNameMemo.set(players, m);
  }
  return m;
}

// Pure: the roster fixes of the given Sleeper players (only players whose games change are returned).
export function rosterCheck(players: Record<string, SleeperPlayer>, pids: Iterable<string>, rosters: TeamRosters | null): Record<string, RosterFix> {
  const out: Record<string, RosterFix> = {};
  if (!rosters?.size) return out;
  const where = new Map<string, string[]>(); const lasts = new Map<string, Set<string>>();
  for (const [team, r] of rosters) {
    const ls = new Set<string>(); lasts.set(team, ls);
    for (const a of r) { const k = normName(a.name); if (!where.has(k)) where.set(k, []); if (!where.get(k)!.includes(team)) where.get(k)!.push(team); ls.add(lastKey(a.name)); }
  }
  const names = byName(players);
  for (const pid of new Set(pids)) {
    const p = players[pid]; if (!p) continue;
    const n = fullName(p); if (!n) continue; const k = normName(n);
    const T = p.team || null;
    if (T) {
      const R = rosters.get(T);
      if (!R || R.length < MIN_ROSTER) continue; // roster unknown or incomplete: unchanged
      if (where.get(k)?.includes(T)) continue; // on his team's roster
      if (lasts.get(T)!.has(lastKey(n))) continue; // possible name variant (same last name): unchanged
    }
    // not on his Sleeper team's roster (or Sleeper lists no team): listed by exactly one other team, and not a homonym's?
    const others = (where.get(k) || []).filter((t) => t !== T);
    const homonyms = (names.get(k) || []).filter((x) => x.pid !== pid);
    const to = others.length === 1 && (T ? !homonyms.some((h) => h.team === others[0]) : !homonyms.length) ? others[0] : null;
    if (!T && !to) continue; // no Sleeper team and on no roster: no games already
    out[pid] = { pid, from: T, to, label: to ? `on ${to} roster (ESPN)${T ? `, Sleeper still lists ${T}` : ", Sleeper lists no team"} - using ${to}'s games`
      : `not on ${T} roster (waived/released) - no games until he signs` };
  }
  return out;
}
// the team whose future games a player plays (null: none)
export const effectiveTeam = (players: Record<string, SleeperPlayer>, fixes: Record<string, RosterFix>, pid: string): string | null =>
  fixes[pid] ? fixes[pid].to : players[pid]?.team ?? null;
