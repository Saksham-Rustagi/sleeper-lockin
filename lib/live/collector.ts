// League data logger: append-only, timestamped JSONL snapshots for later accuracy analysis.
// Why: Sleeper rewrites projection history after games (missing projections for DNPs disappear), so the
// only fair test of projections is one we recorded ourselves *before* tip-off.
//
// Files (one folder per season, outside iCloud): ~/.sleeper-lockin/data/season-YYYY/
//   projections.jsonl  every change to a per-game projection, recorded only while the game is still "pre"
//   injuries.jsonl     every change to a tracked player's injury designation
//   stats.jsonl        final box scores (and later stat corrections); played=false rows for DNPs
//   games.jsonl        ESPN game state changes (pre -> in -> post) with scores and tip time
//   matchups.jsonl     every change to any team's starters / per-slot points (locks) / points
//   rosters.jsonl      roster changes (players, starters, taxi, IR)
//   transactions.jsonl new league transactions (adds/drops/trades/waivers)
//   advice.jsonl       this app's recommendations & win probability when they change (written by the notifier)
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { sleeper, espnDay, type GameRow } from "./sources";
import { fantasyPoints, MODEL } from "../engine/model";
import { resolveWeek } from "./week";

const h = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const compact = (s: Record<string, number> | undefined) => Object.fromEntries(Object.entries(s || {}).filter(([, v]) => typeof v === "number" && v !== 0));

export interface CollectResult { dir: string; written: Record<string, number>; week: number }

export async function collect(o: { leagueId: string; baseDir: string; now?: number; minFaProjection?: number }): Promise<CollectResult> {
  const now = o.now ?? Date.now();
  const league = await sleeper.league(o.leagueId);
  const season = league.season; const S = league.scoring_settings;
  const dir = path.join(o.baseDir, `season-${season}`); fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, "_state.json");
  const state: Record<string, Record<string, string>> = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  for (const k of ["proj", "inj", "stat", "game", "mu", "ros", "tx"]) state[k] ??= {};
  const written: Record<string, number> = {};
  const out = (file: string, row: Record<string, unknown>) => {
    fs.appendFileSync(path.join(dir, `${file}.jsonl`), JSON.stringify({ ts: now, ...row }) + "\n");
    written[file] = (written[file] || 0) + 1;
  };
  if (!fs.existsSync(path.join(dir, "_meta.json")))
    fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify({ leagueId: o.leagueId, season, scoring: S, roster_positions: league.roster_positions, model: MODEL, started: now }, null, 1));

  const week = await resolveWeek(season, now);
  const weeks = [week - 1, week, week + 1].filter((w) => w >= 1);
  const [sched, rosters] = await Promise.all([sleeper.schedule(season), sleeper.rosters(o.leagueId)]);
  const owner = new Map<string, number>(); rosters.forEach((r) => (r.players || []).forEach((p) => owner.set(p, r.roster_id)));

  // ESPN game states for every date in the tracked weeks
  const dates = [...new Set(sched.filter((g) => weeks.includes(g.week)).map((g) => g.date))].sort();
  const espn = new Map<string, { id: string; tip: number; state: string }>();
  for (const d of dates) {
    if (Date.parse(d + "T12:00:00Z") > now + 9 * 86400e3) continue;
    for (const g of await espnDay(d).catch(() => [])) {
      g.teams.forEach((t) => espn.set(`${d}|${t}`, { id: g.id, tip: g.tip, state: g.state }));
      const key = `${g.state}|${g.scores.join("-")}|${g.tip}`;
      if (state.game[g.id] !== key && (g.state !== "in" || state.game[g.id]?.split("|")[0] !== "in")) {
        out("games", { espn_id: g.id, date: d, tip: g.tip, state: g.state, detail: g.detail, teams: g.teams, scores: g.scores });
        state.game[g.id] = key;
      }
    }
  }
  const soon = [...espn.values()].some((g) => g.state !== "post" && g.tip - now < 2 * 3600e3 && g.tip - now > -30 * 60e3);
  const players = await sleeper.players(soon ? 4 * 60e3 : 60 * 60e3);
  const tracked = new Set<string>(owner.keys());

  // projections: only while the game hasn't started
  for (const w of weeks) {
    const rows: GameRow[] = await sleeper.weekProjections(season, w).catch(() => []);
    for (const r of rows) {
      if (!r.stats || !Object.keys(r.stats).length) continue;
      const fp = fantasyPoints(r.stats, S);
      if (!owner.has(r.player_id) && fp < (o.minFaProjection ?? 15)) continue;
      tracked.add(r.player_id);
      const g = espn.get(`${r.date}|${r.team}`);
      if (g && g.state !== "pre") continue;
      if (!g && Date.parse(r.date + "T23:00:00Z") < now) continue;
      const key = `${r.player_id}|${r.game_id}`; const hv = h(r.stats);
      if (state.proj[key] === hv) continue;
      state.proj[key] = hv;
      out("projections", { season, week: w, pid: r.player_id, game_id: r.game_id, date: r.date, team: r.team, opp: r.opponent, tip: g?.tip ?? null,
        fp, stats: compact(r.stats), injury: players[r.player_id]?.injury_status ?? null, roster_id: owner.get(r.player_id) ?? null });
    }
  }

  // injuries for tracked players
  for (const pid of tracked) {
    const p = players[pid]; if (!p) continue;
    const v = `${p.injury_status ?? ""}|${p.injury_body_part ?? ""}|${p.team ?? ""}`;
    if (state.inj[pid] === v) continue;
    const first = state.inj[pid] === undefined; state.inj[pid] = v;
    out("injuries", { pid, name: p.full_name, team: p.team, status: p.injury_status ?? null, body_part: p.injury_body_part ?? null, initial: first });
  }

  // final stats (incl. DNP) once the game is over; re-logged if corrected later
  for (const w of weeks.filter((x) => x <= week)) {
    const rows: GameRow[] = await sleeper.weekStats(season, w).catch(() => []);
    for (const r of rows) {
      if (!tracked.has(r.player_id)) continue;
      const g = espn.get(`${r.date}|${r.team}`);
      if (!g || g.state !== "post") continue;
      const played = !!(r.stats?.gp || r.stats?.sp);
      const key = `${r.player_id}|${r.game_id}`; const hv = h(r.stats || {});
      if (state.stat[key] === hv) continue;
      const correction = state.stat[key] !== undefined; state.stat[key] = hv;
      out("stats", { season, week: w, pid: r.player_id, game_id: r.game_id, date: r.date, team: r.team, opp: r.opponent, played,
        fp: played ? fantasyPoints(r.stats, S) : 0, stats: compact(r.stats), roster_id: owner.get(r.player_id) ?? null, correction });
    }
  }

  // league: matchups (lineups, per-slot points = locks), rosters, transactions
  for (const w of weeks.filter((x) => x <= week)) {
    const mus = await sleeper.matchups(o.leagueId, w).catch(() => []);
    for (const m of mus) {
      const v = { starters: m.starters, starters_points: m.starters_points, players_points: m.players_points, points: m.points, matchup_id: m.matchup_id };
      const key = `${w}|${m.roster_id}`; const hv = h(v);
      if (state.mu[key] === hv) continue; state.mu[key] = hv;
      out("matchups", { season, week: w, roster_id: m.roster_id, ...v });
    }
    for (const t of await sleeper.transactions(o.leagueId, w).catch(() => [])) {
      if (state.tx[t.transaction_id]) continue; state.tx[t.transaction_id] = t.status;
      out("transactions", { season, week: w, ...t });
    }
  }
  for (const r of rosters) {
    const v = { players: r.players, starters: r.starters, taxi: r.taxi, reserve: r.reserve, owner_id: r.owner_id };
    const hv = h(v); if (state.ros[r.roster_id] === hv) continue; state.ros[r.roster_id] = hv;
    out("rosters", { season, roster_id: r.roster_id, ...v });
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return { dir, written, week };
}

export function logAdvice(baseDir: string, season: string, a: { week: number; outlook: unknown; decisions: unknown[]; plan: unknown[]; me: { lockedTotal: number }; opp: { lockedTotal: number } | null }) {
  const dir = path.join(baseDir, `season-${season}`); fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, "_advice_state.txt");
  const o = a.outlook as { winProb: number | null; myMean: number; oppMean: number | null };
  const row = { week: a.week, winProb: o.winProb, myMean: o.myMean, oppMean: o.oppMean, myLocked: a.me.lockedTotal, oppLocked: a.opp?.lockedTotal ?? null, decisions: a.decisions, nextTip: a.plan[0] ?? null };
  const hv = h({ ...row, myMean: Math.round(o.myMean), oppMean: o.oppMean === null ? null : Math.round(o.oppMean) });
  if (fs.existsSync(stateFile) && fs.readFileSync(stateFile, "utf8") === hv) return false;
  fs.writeFileSync(stateFile, hv);
  fs.appendFileSync(path.join(dir, "advice.jsonl"), JSON.stringify({ ts: Date.now(), ...row }) + "\n");
  return true;
}
