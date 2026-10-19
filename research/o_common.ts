// Task O (opportunity alerts): minutes histories for the validation, from Sleeper's per-game stat rows (seconds played
// `sp`; one row per rostered NBA player per team game, DNPs included) and per-game projections (projected `sp`).
//   2025-26: research/data/o/stats2025_w*.json, proj2025_w*.json, pre2025_w*.json (research/o_fetch.py)
//   2024-25: research/data/raw2024/stats_w*.json, proj_w*.json
// Tip-off times and Sleeper's pre-game projections per game (proj_sleeper) come from research/data/w/all20xx.json.
import fs from "fs";
import { fantasyPoints } from "../lib/engine/model";
import { histFrom, type Hist, type PGame } from "../lib/live/opportunity";

export const LEAGUE = JSON.parse(fs.readFileSync("research/data/w/league.json", "utf8"));
export const SCORING: Record<string, number> = LEAGUE.scoring_settings;
export const PLAYERS: Record<string, any> = JSON.parse(fs.readFileSync("research/data/w/players_nba.json", "utf8"));

type Row = { player_id: string; date: string; team: string; game_id: string; stats: Record<string, number> | null };
const read = (f: string): Row[] => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []);

export interface SeasonData {
  year: "2025" | "2024"; hist: Hist; A: any;
  tipOf: Map<string, number>;                 // team|date -> tip
  projFp: Map<string, number>;                // pid|date -> Sleeper pre-game projection (all20xx proj_sleeper)
  projMin: Map<string, number>;               // pid|date -> Sleeper projected minutes (projection rows)
  names: Record<string, string>; positions: Record<string, string[]>;
  weekOfDate: (d: string) => number | null;
}

export function loadSeason(year: "2025" | "2024", withPre = true): SeasonData {
  const A = JSON.parse(fs.readFileSync(`research/data/w/all${year}.json`, "utf8"));
  const tipOf = new Map<string, number>(); const projFp = new Map<string, number>();
  const dateWeek = new Map<string, number>();
  for (const [w, gs] of Object.entries<any[]>(A.games)) for (const g of gs) {
    tipOf.set(`${g.team}|${g.date}`, g.tip); dateWeek.set(g.date, Number(w));
    if (g.proj_sleeper != null) projFp.set(`${g.pid}|${g.date}`, g.proj_sleeper);
  }
  const rows: (PGame & { pid: string })[] = [];
  const add = (r: Row, pre: boolean) => {
    if (!r.team || !r.player_id || !/^\d+$/.test(r.player_id)) return;
    const s = r.stats || {}; const sp = Number(s.sp || 0); const played = sp > 0 || !!s.gp;
    rows.push({ pid: r.player_id, key: r.game_id || `${r.date}|${r.team}`, date: r.date, tip: tipOf.get(`${r.team}|${r.date}`) ?? Date.parse(r.date + "T23:30:00Z"),
      team: r.team, pre, min: sp / 60, fp: played ? fantasyPoints(s, SCORING) : 0, played });
  };
  const projMin = new Map<string, number>();
  for (let w = 1; w <= 25; w++) {
    const st = year === "2025" ? read(`research/data/o/stats2025_w${w}.json`) : read(`research/data/raw2024/stats_w${w}.json`);
    for (const r of st) add(r, false);
    const pr = year === "2025" ? read(`research/data/o/proj2025_w${w}.json`) : read(`research/data/raw2024/proj_w${w}.json`);
    for (const r of pr) if (r.stats?.sp) projMin.set(`${r.player_id}|${r.date}`, r.stats.sp / 60);
  }
  if (withPre && year === "2025") for (let w = 1; w <= 4; w++) for (const r of read(`research/data/o/pre2025_w${w}.json`)) add(r, true);
  // one row per player per game (a stat correction can duplicate)
  const seen = new Set<string>(); const uniq = rows.filter((r) => { const k = r.pid + "|" + r.key; if (seen.has(k)) return false; seen.add(k); return true; });
  const names: Record<string, string> = {}; const positions: Record<string, string[]> = {};
  for (const [pid, p] of Object.entries(PLAYERS)) { names[pid] = p.full_name || pid; positions[pid] = p.fantasy_positions || []; }
  for (const [pid, n] of Object.entries<string>(A.names || {})) names[pid] = n;
  for (const [pid, ps] of Object.entries<string[]>(A.pos || {})) positions[pid] = ps;
  return { year, hist: histFrom(uniq), A, tipOf, projFp, projMin, names, positions, weekOfDate: (d) => dateWeek.get(d) ?? null };
}
