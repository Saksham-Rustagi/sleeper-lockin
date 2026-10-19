// Live opportunity scan (task O, research/REPORT.md "Opportunity alerts"): ESPN box scores of this season (incl.
// preseason) + Sleeper's stats of last season -> minutes history; every rotation player tagged Out (injury tags are
// polled hourly, every 4 min near tip-off) -> his teammates ranked by the minutes they should absorb; minutes surges;
// the minutes-based projection overrides of the flagged players; alert texts for the notifier.
import crypto from "crypto";
import { sleeper, espnDay, type SleeperPlayer, type GameRow } from "./sources";
import { fantasyPoints, injuryPlayProb } from "../engine/model";
import { collectBoxScores, boxRows } from "./boxscores";
import * as O from "./opportunity";
import { optionOn, setOverrideHash } from "./override";

export interface OppCandidate extends O.Candidate { name: string; team: string | null; status: "fa" | "mine" | "rostered"; injury: string | null; sleeperProj: number | null; nextTip: number | null }
export interface OppAbsence { pid: string; name: string; team: string; injury: string | null; mpg: number; missedBefore: number; since: number | null; candidates: OppCandidate[] }
export interface OppReport {
  generatedAt: number; season: string; asOf: number; enabled: { minutesOverride: boolean; opportunityAlerts: boolean };
  absences: OppAbsence[]; surges: (O.Surge & { name: string; status: "fa" | "mine" | "rostered"; sleeperProj: number | null; nextTip: number | null })[];
  overrides: Record<string, O.Override>; alerts: O.OppAlert[];
  box: { games: number; preseasonGames: number; lastDate: string | null; fetched: number; pending: number; unmatched: number; prevSeasonRows: number };
  notes: string[];
}

const etDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const fmt = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
const OUT = (s: string | null | undefined) => { const p = injuryPlayProb(s); return p !== null && p <= 0.03; };

// last season's minutes (Sleeper weekly stat rows, fetched once per process; disk-cached 7 days by sources.ts)
const prevMemo = new Map<string, Promise<O.Hist>>();
function prevHist(season: string, S: Record<string, number>): Promise<O.Hist> {
  const prev = String(Number(season) - 1); const mk = prev + JSON.stringify(S);
  if (!prevMemo.has(mk)) prevMemo.set(mk, (async () => {
    const rows: (O.PGame & { pid: string })[] = [];
    for (let w = 1; w <= 25; w++) {
      const st: GameRow[] = await sleeper.pastWeekStats(prev, w).catch(() => []);
      for (const r of st) {
        if (!r.team || !/^\d+$/.test(r.player_id)) continue;
        const sp = Number(r.stats?.sp || 0);
        rows.push({ pid: r.player_id, key: r.game_id || `${r.date}|${r.team}`, date: r.date, tip: Date.parse(r.date + "T23:30:00Z"), team: r.team, pre: false, min: sp / 60, fp: sp > 0 ? fantasyPoints(r.stats, S) : 0, played: sp > 0 });
      }
    }
    return O.histFrom(rows);
  })().catch((e) => { prevMemo.delete(mk); throw e; }));
  return prevMemo.get(mk)!;
}

export async function opportunityScan(o: { leagueId: string; rosterId?: number; asOf?: number; since?: Record<string, number>; maxSummaries?: number }): Promise<OppReport> {
  const asOf = o.asOf ?? Date.now();
  const league = await sleeper.league(o.leagueId); const season = league.season; const S = league.scoring_settings;
  const [players, rosters, sched] = await Promise.all([sleeper.players(60 * 60e3), sleeper.rosters(o.leagueId), sleeper.schedule(season)]);
  const notes: string[] = [];
  const bx = await collectBoxScores({ season, from: `${season}-10-01`, to: etDate(asOf), now: asOf, maxSummaries: o.maxSummaries });
  const { rows, unmatched } = boxRows(bx.store, players, S);
  const hist = O.histFrom(rows.filter((r) => r.tip < asOf));
  const prev = await prevHist(season, S).catch(() => { notes.push("last season's minutes unavailable (with/without history from this season only)"); return null; });
  if (unmatched.length) notes.push(`${unmatched.length} ESPN name(s) not matched to a Sleeper player: ${unmatched.slice(0, 12).join(", ")}`);
  if (bx.pending) notes.push(`${bx.pending} box score(s) not loaded yet (fetched ${bx.fetched} this run)`);

  const rostered = new Set(rosters.flatMap((r) => [...(r.players || []), ...(r.taxi || []), ...(r.reserve || [])]));
  const me = rosters.find((r) => r.roster_id === o.rosterId);
  const mine = new Set(me ? [...(me.players || []), ...(me.taxi || []), ...(me.reserve || [])] : []);
  const status = (pid: string): "fa" | "mine" | "rostered" => (mine.has(pid) ? "mine" : rostered.has(pid) ? "rostered" : "fa");
  const name = (pid: string) => players[pid]?.full_name || pid;

  // Sleeper's projection for each player's next game (this week and the next 7 days)
  const today = etDate(asOf);
  const weeks = [...new Set(sched.filter((g) => g.date >= today && g.date <= etDate(asOf + 7 * 86400e3)).map((g) => g.week))];
  const proj: GameRow[] = (await Promise.all(weeks.map((w) => sleeper.weekProjections(season, w).catch(() => [] as GameRow[])))).flat();
  const nextProj = new Map<string, { fp: number; min: number | null; date: string }>();
  for (const r of proj.sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.date < today || nextProj.has(r.player_id) || !r.stats || !Object.keys(r.stats).length) continue;
    nextProj.set(r.player_id, { fp: fantasyPoints(r.stats, S), min: r.stats.sp ? r.stats.sp / 60 : null, date: r.date });
  }
  // next tip-off of a team (ESPN, the next 7 days)
  const tipMemo = new Map<string, Promise<{ teams: string[]; tip: number; state: string }[]>>();
  const dayGames = (d: string) => { if (!tipMemo.has(d)) tipMemo.set(d, espnDay(d).catch(() => [])); return tipMemo.get(d)!; };
  const nextTip = async (team: string | null) => {
    if (!team) return null;
    for (const g of sched.filter((x) => x.date >= today && [x.home.team, x.away.team].includes(team)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2)) {
      const e = (await dayGames(g.date)).find((x) => x.teams.includes(team) && x.state === "pre"); if (e) return e.tip;
    }
    return null;
  };

  const meta: O.Meta = { positions: {}, depth: {} };
  for (const [pid, p] of Object.entries(players)) { meta.positions[pid] = p.fantasy_positions; const q = p as SleeperPlayer & { depth_chart_position?: string | null; depth_chart_order?: number | null }; meta.depth![pid] = { pos: q.depth_chart_position ?? null, order: q.depth_chart_order ?? null }; }

  const absences: OppAbsence[] = [];
  for (const [pid, p] of Object.entries(players)) {
    if (!p.team || !OUT(p.injury_status) || !hist.byPid.has(pid)) continue;
    if (O.teamAt(hist, pid, asOf) !== p.team || O.playedMpg(hist, pid, asOf) < O.OPP.rotationMpg) continue;
    const a = O.replacementCandidates(hist, pid, asOf, meta, prev); if (!a) continue;
    const cands: OppCandidate[] = [];
    for (const c of a.candidates.slice(0, 5)) cands.push({ ...c, name: name(c.pid), team: players[c.pid]?.team ?? a.team, status: status(c.pid), injury: players[c.pid]?.injury_status ?? null, sleeperProj: nextProj.get(c.pid)?.fp ?? null, nextTip: await nextTip(players[c.pid]?.team ?? a.team) });
    absences.push({ pid, name: name(pid), team: a.team, injury: p.injury_status, mpg: a.mpg, missedBefore: a.missedBefore, since: o.since?.[pid] ?? null, candidates: cands });
  }
  absences.sort((x, y) => y.mpg - x.mpg);

  const surges: OppReport["surges"] = [];
  for (const pid of hist.byPid.keys()) {
    const p = players[pid]; if (!p?.team || OUT(p.injury_status)) continue;
    const np = nextProj.get(pid);
    const s = O.surge(hist, pid, asOf, { min: np?.min ?? null, fp: np?.fp ?? null }, prev);
    if (s?.flagged && s.team === p.team) surges.push({ ...s, name: name(pid), status: status(pid), sleeperProj: np?.fp ?? null, nextTip: await nextTip(p.team) });
  }
  surges.sort((x, y) => y.est - x.est);

  const names = Object.fromEntries([...absences.flatMap((a) => [[a.pid, a.name], ...a.candidates.map((c) => [c.pid, c.name])]), ...surges.map((s) => [s.pid, s.name])]);
  const overrides = O.buildOverrides(absences, surges, names, O.OPP, (pid) => nextProj.get(pid)?.fp ?? null);
  const alerts = reportAlerts({ absences, surges });
  const games = Object.values(bx.store.games);
  if (!games.some((g) => !g.preseason)) notes.push("no regular-season box scores yet: minutes come from the preseason (flagged)");
  return {
    generatedAt: Date.now(), season, asOf, enabled: { minutesOverride: optionOn("minutesOverride"), opportunityAlerts: optionOn("opportunityAlerts") },
    absences, surges, overrides, alerts,
    box: { games: games.length, preseasonGames: games.filter((g) => g.preseason).length, lastDate: games.map((g) => g.date).sort().pop() ?? null, fetched: bx.fetched, pending: bx.pending, unmatched: unmatched.length, prevSeasonRows: prev?.rows ?? 0 },
    notes,
  };
}

// Alert texts of a scan. fresh: only absences whose `since` passes it (the notifier: newly out); default every absence.
export function reportAlerts(r: Pick<OppReport, "absences" | "surges">, fresh?: (a: OppAbsence) => boolean): O.OppAlert[] {
  const abs = r.absences.filter((a) => !fresh || fresh(a));
  const cands = [...abs.flatMap((a) => a.candidates), ...r.surges.map((s) => ({ ...s, injury: null as string | null }))];
  const by = new Map(cands.map((c) => [c.pid, c]));
  const names = Object.fromEntries([...abs.map((a) => [a.pid, a.name]), ...cands.map((c) => [c.pid, c.name])]);
  return O.opportunityAlerts(abs.map((a) => ({ ...a, since: a.since ?? undefined })), r.surges, {
    names, teams: Object.fromEntries(cands.map((c) => [c.pid, c.team])),
    freeAgents: new Set(cands.filter((c) => c.status === "fa" && !OUT(c.injury)).map((c) => c.pid)), mine: new Set(cands.filter((c) => c.status === "mine").map((c) => c.pid)),
    nextTip: (pid) => by.get(pid)?.nextTip ?? null, sleeperProj: (pid) => by.get(pid)?.sleeperProj ?? null, fmtTime: fmt,
  });
}

// The overrides in force for the live simulations: null unless "minutesOverride" is on. One scan per league per 10 min
// (the box-score store is incremental). A failed scan never breaks a simulation: no overrides (logged).
const ovMemo = new Map<string, { at: number; v: Promise<Record<string, O.Override> | null> }>();
export function overrideHashOf(ov: Record<string, O.Override> | null): string | null {
  if (!ov) return null;
  return crypto.createHash("sha1").update(JSON.stringify(Object.entries(ov).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Math.round(v.perGame * 10) / 10]))).digest("hex").slice(0, 16);
}
export async function minutesOverrides(leagueId: string, asOf = Date.now()): Promise<Record<string, O.Override> | null> {
  if (!optionOn("minutesOverride")) { setOverrideHash(null); return null; }
  const m = ovMemo.get(leagueId);
  if (!m || Date.now() - m.at > 10 * 60e3) {
    const v = opportunityScan({ leagueId, asOf }).then((r) => r.overrides).catch((e) => { console.warn("[opportunity] scan failed, no overrides:", e?.message || e); return null; });
    ovMemo.set(leagueId, { at: Date.now(), v });
  }
  const ov = await ovMemo.get(leagueId)!.v;
  setOverrideHash(overrideHashOf(ov));
  return ov;
}
export function resetOverrideMemo() { ovMemo.clear(); }
