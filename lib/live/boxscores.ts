// ESPN box scores for the current season (task O): per completed game, every listed player's minutes and stats
// (Sleeper stat keys, so lib/engine/model fantasyPoints scores them in the league's scoring). Preseason included and
// flagged (seasonType 1). Completed games never change, so each summary is fetched once and kept in a compact store
// (~1 kB per player-game instead of ESPN's ~450 kB summary): <LOCKIN_CACHE_DIR>/boxscores/<season>.json, or memory only
// when LOCKIN_CACHE_DIR is unset. A day is marked complete once all its games are final and the day is over (ET).
import { espnDay, type SleeperPlayer } from "./sources";
import { fantasyPoints } from "../engine/model";
import type { PGame } from "./opportunity";

export interface BoxPlayer { espnId: string; name: string; starter: boolean; dnp: boolean; reason: string | null; min: number; stats: Record<string, number> }
export interface BoxGame { id: string; date: string; tip: number; seasonType: number; preseason: boolean; teams: string[]; box: Record<string, BoxPlayer[]> }
export interface BoxStore { v: 1; season: string; games: Record<string, BoxGame>; days: Record<string, number> }

const ESPN_FIX: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=";

// ESPN box cells -> Sleeper stat keys (incl. the derived dd / td / bonus keys the league scores)
export function espnStats(keys: string[], cells: string[]): Record<string, number> {
  const v: Record<string, string> = {}; keys.forEach((k, i) => (v[k] = cells[i] ?? ""));
  const num = (s: string | undefined) => { const x = Number(String(s ?? "").replace("+", "")); return Number.isFinite(x) ? x : 0; };
  const pair = (s: string | undefined) => { const [a, b] = String(s ?? "0-0").split("-").map(Number); return [a || 0, b || 0]; };
  const [fgm, fga] = pair(v["fieldGoalsMade-fieldGoalsAttempted"]), [tpm, tpa] = pair(v["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]), [ftm, fta] = pair(v["freeThrowsMade-freeThrowsAttempted"]);
  const s: Record<string, number> = {
    sp: Math.round(num(v.minutes) * 60), pts: num(v.points), reb: num(v.rebounds), ast: num(v.assists), stl: num(v.steals), blk: num(v.blocks), to: num(v.turnovers),
    oreb: num(v.offensiveRebounds), dreb: num(v.defensiveRebounds), pf: num(v.fouls), fgm, fga, fgmi: fga - fgm, tpm, tpa, tpmi: tpa - tpm, ftm, fta, ftmi: fta - ftm,
  };
  const tens = [s.pts, s.reb, s.ast, s.stl, s.blk].filter((x) => x >= 10).length;
  if (tens >= 2) s.dd = 1; if (tens >= 3) s.td = 1;
  if (s.pts >= 40) s.bonus_pt_40p = 1; if (s.pts >= 50) s.bonus_pt_50p = 1; if (s.reb >= 20) s.bonus_reb_20p = 1; if (s.ast >= 15) s.bonus_ast_15p = 1;
  if (s.sp > 0) s.gp = 1;
  return Object.fromEntries(Object.entries(s).filter(([, x]) => x !== 0));
}

export function parseSummary(j: any, g: { id: string; date: string; tip: number; seasonType: number }): BoxGame {
  const box: Record<string, BoxPlayer[]> = {};
  for (const t of j?.boxscore?.players || []) {
    const team = ESPN_FIX[t.team?.abbreviation] ?? t.team?.abbreviation; const st = t.statistics?.[0]; if (!team || !st) continue;
    box[team] = (st.athletes || []).map((a: any) => {
      const stats = a.didNotPlay || !a.stats?.length ? {} : espnStats(st.keys || [], a.stats);
      return { espnId: String(a.athlete?.id ?? ""), name: a.athlete?.displayName ?? "", starter: !!a.starter, dnp: !!a.didNotPlay || !stats.sp, reason: a.reason ?? null, min: (stats.sp || 0) / 60, stats };
    });
  }
  return { ...g, preseason: g.seasonType === 1, teams: Object.keys(box), box };
}

const memStore = new Map<string, BoxStore>();
async function storeIO(season: string, dir?: string | null) {
  const d = dir ?? (typeof window === "undefined" ? process.env.LOCKIN_CACHE_DIR : undefined);
  if (!d) return { load: () => memStore.get(season) ?? null, save: (s: BoxStore) => { memStore.set(season, s); } };
  const fs = await import("fs"); const path = await import("path");
  const f = path.join(d, "boxscores", `${season}.json`);
  return {
    load: (): BoxStore | null => { const m = memStore.get(season); if (m) return m; try { const s = JSON.parse(fs.readFileSync(f, "utf8")); memStore.set(season, s); return s; } catch { return null; } },
    save: (s: BoxStore) => { memStore.set(season, s); fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, f); },
  };
}
const etDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

// Bring the store up to date for dates from..to (YYYY-MM-DD, ET). At most maxSummaries new summaries per call (a
// cold start backfills over a few notifier runs).
export async function collectBoxScores(o: { season: string; from: string; to: string; dir?: string | null; now?: number; maxSummaries?: number; fetchJson?: (url: string) => Promise<any> }):
  Promise<{ store: BoxStore; fetched: number; pending: number }> {
  const now = o.now ?? Date.now(); const io = await storeIO(o.season, o.dir);
  const store: BoxStore = io.load() ?? { v: 1, season: o.season, games: {}, days: {} };
  const get = o.fetchJson ?? (async (url: string) => { const r = await fetch(url, { headers: { "User-Agent": "sleeper-lockin/2.0" }, cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.json(); });
  let fetched = 0, pending = 0; const max = o.maxSummaries ?? 60; const today = etDate(now);
  for (let t = Date.parse(o.from + "T12:00:00Z"); etDate(t) <= o.to; t += 86400e3) {
    const d = etDate(t); if (store.days[d]) continue;
    const games = await espnDay(d).catch(() => null); if (!games) { pending++; continue; }
    let complete = d < today;
    for (const g of games) {
      if (g.state !== "post") { complete = false; continue; }
      if (store.games[g.id]) continue;
      if (fetched >= max) { complete = false; pending++; continue; }
      try { store.games[g.id] = parseSummary(await get(SUMMARY + g.id), { id: g.id, date: d, tip: g.tip, seasonType: g.seasonType ?? 2 }); fetched++; }
      catch { complete = false; pending++; }
    }
    if (complete) store.days[d] = now;
  }
  if (fetched || Object.keys(store.days).length) io.save(store);
  return { store, fetched, pending };
}

// ---------- ESPN player -> Sleeper player id ----------
export function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s-]+/).filter((t) => !/^(jr|sr|ii|iii|iv|v)\.?$/.test(t)).join("").replace(/[^a-z]/g, "");
}
export function pidMatcher(players: Record<string, SleeperPlayer>) {
  const idx = new Map<string, { pid: string; team: string | null }[]>();
  for (const [pid, p] of Object.entries(players)) {
    const n = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`; if (!n.trim() || !/^\d+$/.test(pid)) continue;
    const k = normName(n); if (!idx.has(k)) idx.set(k, []); idx.get(k)!.push({ pid, team: p.team });
  }
  return (name: string, team: string): string | null => {
    const c = idx.get(normName(name)); if (!c?.length) return null;
    if (c.length === 1) return c[0].pid;
    return c.find((x) => x.team === team)?.pid ?? null;
  };
}

// box store -> minutes history rows (lib/live/opportunity.ts Hist). Unmatched ESPN names are reported, not guessed.
export function boxRows(store: BoxStore, players: Record<string, SleeperPlayer>, scoring: Record<string, number>): { rows: (PGame & { pid: string })[]; unmatched: string[] } {
  const match = pidMatcher(players); const rows: (PGame & { pid: string })[] = []; const unmatched = new Set<string>();
  for (const g of Object.values(store.games)) for (const [team, ps] of Object.entries(g.box)) for (const p of ps) {
    const pid = match(p.name, team); if (!pid) { unmatched.add(`${p.name} (${team})`); continue; }
    rows.push({ pid, key: g.id, date: g.date, tip: g.tip, team, pre: g.preseason, min: p.min, fp: p.dnp ? 0 : fantasyPoints(p.stats, scoring), played: !p.dnp });
  }
  return { rows, unmatched: [...unmatched].sort() };
}
