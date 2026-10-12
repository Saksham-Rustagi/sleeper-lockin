// Build an engine TeamWeek (+ reconstructed State) for a Sleeper roster from live or historical data.
import * as E from "../engine/core";
import { gameDist, injuryPlayProb, fantasyPoints, MODEL } from "../engine/model";
import { sleeper, espnDay, type League, type GameRow, type SleeperPlayer, type Matchup } from "./sources";

export const POLICY: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true };
const GAME_LEN = 2.5 * 3600e3;

export interface LiveGame {
  gi: number; pid: string; date: string; tip: number; end: number; team: string; opp: string;
  proj: number; mu: number; sd: number; status: "pre" | "in" | "post"; actual: number | null; played: boolean | null;
}
export interface LiveTeam {
  rosterId: number; ownerId: string; teamName: string; pids: string[]; names: string[]; positions: string[][];
  injury: (string | null)[]; tw: E.TeamWeek; games: LiveGame[]; real: { actual: Float64Array; played: Uint8Array };
  st: E.State; events: E.Ev[]; evIdx: number; lineup: (string | null)[]; lockSource: ("sleeper" | "override" | "sim" | null)[];
  sleeperPoints: number | null;
}
export interface WeekContext {
  league: League; season: string; week: number; dates: string[]; asOf: number; mode: "live" | "replay";
  slotNames: string[]; me: LiveTeam; opp: LiveTeam | null; notes: string[];
}

export function etDate(ms: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export async function resolveWeek(season: string, asOf: number): Promise<number> {
  const sched = await sleeper.schedule(season);
  const today = etDate(asOf);
  const weeks = new Map<number, string[]>();
  for (const g of sched) { if (!weeks.has(g.week)) weeks.set(g.week, []); weeks.get(g.week)!.push(g.date); }
  const ordered = [...weeks.entries()].map(([w, ds]) => ({ w, first: ds.sort()[0], last: ds.sort()[ds.length - 1] })).sort((a, b) => a.w - b.w);
  for (const x of ordered) if (today <= x.last) return x.w; // current or next upcoming week (Mon-Sun)
  return ordered[ordered.length - 1].w;
}

export interface BuildOpts { leagueId: string; rosterId: number; week?: number; asOf?: number; mode?: "live" | "replay"; lockOverrides?: Record<number, string | null>;
  rosterEdit?: { add?: string[]; drop?: string[] }; skipOpp?: boolean }

export async function buildWeek(o: BuildOpts): Promise<WeekContext> {
  const mode = o.mode ?? "live";
  const league = await sleeper.league(o.leagueId);
  const season = league.season;
  const asOf0 = o.asOf ?? Date.now();
  const week = o.week ?? (await resolveWeek(season, asOf0));
  const [sched, users, rosters, wproj, wstats, sproj] = await Promise.all([
    sleeper.schedule(season), sleeper.users(o.leagueId), sleeper.rosters(o.leagueId),
    sleeper.weekProjections(season, week).catch(() => [] as GameRow[]), sleeper.weekStats(season, week).catch(() => [] as GameRow[]),
    sleeper.seasonProjections(season).catch(() => ({} as Record<string, Record<string, number>>)),
  ]);
  const matchups: Matchup[] = await sleeper.matchups(o.leagueId, week).catch(() => []);
  const prevStats = week > 1 ? await sleeper.weekStats(season, week - 1).catch(() => [] as GameRow[]) : [];
  const prevProj = week > 1 ? await sleeper.weekProjections(season, week - 1).catch(() => [] as GameRow[]) : [];
  const weekGames = sched.filter((g) => g.week === week);
  const dates = [...new Set(weekGames.map((g) => g.date))].sort();
  const espn = new Map<string, { tip: number; state: "pre" | "in" | "post" }>();
  await Promise.all(dates.map(async (d) => {
    for (const g of await espnDay(d).catch(() => [])) for (const t of g.teams) espn.set(`${d}|${t}`, { tip: g.tip, state: g.state });
  }));
  // Injury tags: refresh every 4 min when any game tips within 2h (late scratches), otherwise hourly.
  const soon = [...espn.values()].some((g) => g.state !== "post" && g.tip - asOf0 < 2 * 3600e3 && g.tip - asOf0 > -30 * 60e3);
  const players = await sleeper.players(mode === "live" && soon ? 4 * 60e3 : 60 * 60e3);
  // replay mode defaults to "end of week"
  const asOf = mode === "replay" && o.asOf === undefined ? Date.parse(dates[dates.length - 1] + "T23:59:00Z") + 12 * 3600e3 : asOf0;
  const slotNames = league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const notes: string[] = [];
  const S = league.scoring_settings;
  const projRow = new Map(wproj.map((r) => [`${r.player_id}|${r.date}`, r]));
  const statRow = new Map(wstats.map((r) => [`${r.player_id}|${r.date}`, r]));

  const build = (rosterId: number): LiveTeam => {
    const roster = rosters.find((r) => r.roster_id === rosterId)!;
    const mu = matchups.find((m) => m.roster_id === rosterId);
    let pids: string[];
    if (mode === "replay" && mu?.players?.length) pids = mu.players.filter((p) => p !== "0");
    else pids = (roster.players || []).filter((p) => !(roster.taxi || []).includes(p) && !(roster.reserve || []).includes(p));
    if (rosterId === o.rosterId && o.rosterEdit) {
      pids = pids.filter((p) => !(o.rosterEdit!.drop || []).includes(p));
      for (const a of o.rosterEdit.add || []) if (!pids.includes(a)) pids.push(a);
    }
    const pl = (p: string): SleeperPlayer => players[p] || ({ player_id: p, team: null, fantasy_positions: ["UTIL"], injury_status: null } as SleeperPlayer);
    const games: LiveGame[] = [];
    pids.forEach((pid) => {
      const rows = [...wproj, ...wstats].filter((r) => r.player_id === pid);
      const teamByDate = new Map(rows.map((r) => [r.date, r.team]));
      const fallbackTeam = (() => { const c = new Map<string, number>(); rows.forEach((r) => c.set(r.team, (c.get(r.team) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? pl(pid).team; })();
      // fallback projection: last projection seen (this week, then last week), last week's average, season projection
      const pp = prevProj.filter((r) => r.player_id === pid && r.stats && Object.keys(r.stats).length).sort((a, b) => a.date.localeCompare(b.date));
      const ps = prevStats.filter((r) => r.player_id === pid && (r.stats?.gp || r.stats?.sp));
      const seasonPer = pp.length ? fantasyPoints(pp[pp.length - 1].stats, S)
        : ps.length ? ps.reduce((a, r) => a + fantasyPoints(r.stats, S), 0) / ps.length
        : sproj[pid]?.gp ? fantasyPoints(sproj[pid], S) / (sproj[pid].gp > 1 ? sproj[pid].gp : 1) : 12;
      let lastProj: number | null = null;
      for (const g of weekGames.sort((a, b) => a.date.localeCompare(b.date))) {
        const team = teamByDate.get(g.date) ?? fallbackTeam;
        if (!team || ![g.home.team, g.away.team].includes(team)) continue;
        const pr = projRow.get(`${pid}|${g.date}`); const srow = statRow.get(`${pid}|${g.date}`);
        let proj: number;
        if (pr?.stats && Object.keys(pr.stats).length) { proj = fantasyPoints(pr.stats, S); lastProj = proj; }
        else proj = lastProj ?? seasonPer; // replay: never treat a missing projection as a DNP signal (it leaks)
        const ek = espn.get(`${g.date}|${team}`);
        const tip = ek?.tip ?? Date.parse(g.date + "T23:30:00Z");
        let status: LiveGame["status"] = ek?.state ?? "pre";
        if (mode === "replay") status = tip + GAME_LEN <= asOf ? "post" : tip <= asOf ? "in" : "pre";
        const played = srow?.stats ? !!(srow.stats.gp || srow.stats.sp) : status === "post" ? false : null;
        const actual = status === "post" ? (played ? fantasyPoints(srow!.stats, S) : 0) : null;
        let end = tip + GAME_LEN;
        if (status === "post" && end > asOf) end = asOf - 1;
        if (status === "in" && end <= asOf) end = asOf + 15 * 60e3;
        const d = gameDist(proj);
        games.push({ gi: -1, pid, date: g.date, tip, end, team, opp: g.home.team === team ? g.away.team : g.home.team, proj, mu: d.mu, sd: d.sd, status, actual, played });
      }
    });
    games.sort((a, b) => a.tip - b.tip); games.forEach((g, i) => (g.gi = i));
    const pidx = new Map(pids.map((p, i) => [p, i]));
    const byPlayer: number[][] = pids.map(() => []); games.forEach((g) => byPlayer[pidx.get(g.pid)!].push(g.gi));
    const lastPlayed0 = pids.map((p) => {
      if (mode === "live" && injuryPlayProb(pl(p).injury_status) !== null && (injuryPlayProb(pl(p).injury_status) as number) < 0.5) return 0;
      const prev = prevStats.filter((r) => r.player_id === p).sort((a, b) => a.date.localeCompare(b.date));
      return prev.length ? (prev[prev.length - 1].stats?.gp || prev[prev.length - 1].stats?.sp ? 1 : 0) : 1;
    });
    const tw: E.TeamWeek = {
      slots: slotNames.map((s) => E.SLOT_MASK[s] ?? 31), slotNames,
      pmask: pids.map((p) => E.posMask(pl(p).fantasy_positions || ["UTIL"])), names: pids.map((p) => pl(p).full_name || `${pl(p).first_name} ${pl(p).last_name}`),
      games: games.map((g) => ({ p: pidx.get(g.pid)!, tip: g.tip, end: g.end, mu: g.mu, sd: g.sd, projRaw: g.proj, actual: g.actual ?? 0, played: !!g.played })),
      byPlayer, lastPlayed0, dnp: { p1: MODEL.P1, p0: MODEL.P0 },
    };
    if (mode === "live") {
      tw.nextGameIdx = pids.map((_, i) => { const g = byPlayer[i].find((gi) => games[gi].status === "pre"); return g ?? -1; });
      tw.pNext = pids.map((p) => injuryPlayProb(pl(p).injury_status));
    }
    const real = { actual: Float64Array.from(games.map((g) => g.actual ?? 0)), played: Uint8Array.from(games.map((g) => (g.played ? 1 : 0))) };
    const events = E.buildEvents(tw, true);
    let evIdx = events.findIndex((e) => e.t > asOf); if (evIdx < 0) evIdx = events.length;
    const st = E.initState(tw);
    const lineup: (string | null)[] = slotNames.map((_, i) => { const s = mu?.starters?.[i]; return s && s !== "0" ? s : null; });
    const lockSource: LiveTeam["lockSource"] = slotNames.map(() => null);
    if (mode === "live") {
      // last-known play state
      pids.forEach((p, i) => { const done = byPlayer[i].filter((gi) => games[gi].status === "post"); if (done.length) st.lastPlayed[i] = games[done[done.length - 1]].played ? 1 : 0; });
      slotNames.forEach((_, s) => {
        const pid = lineup[s]; const ov = o.lockOverrides?.[s];
        const pts = mu?.starters_points?.[s] ?? 0;
        const lockedPid = ov !== undefined ? ov : pid && pts !== 0 ? pid : null;
        if (lockedPid && pidx.has(lockedPid)) {
          const i = pidx.get(lockedPid)!; st.lockedBy[s] = i; st.isLocked[i] = 1;
          st.lockedPts[s] = ov !== undefined ? (mu?.players_points?.[lockedPid] ?? pts) : pts; lockSource[s] = ov !== undefined ? "override" : "sleeper";
          return;
        }
        if (!pid || !pidx.has(pid)) return;
        const i = pidx.get(pid)!;
        const live = byPlayer[i].find((gi) => games[gi].status === "in");
        if (live !== undefined) { st.inGame[i] = live; st.pinned[s] = i; st.pinnedUntil[s] = games[live].end; st.started[live] = 1; return; }
        const done = byPlayer[i].filter((gi) => games[gi].status === "post");
        const nextPre = byPlayer[i].find((gi) => games[gi].status === "pre");
        if (done.length && (nextPre === undefined || games[nextPre].tip > asOf)) {
          const last = games[done[done.length - 1]]; st.pendingX[i] = last.actual ?? 0; st.started[last.gi] = 1;
        }
      });
      if (rosterId !== o.rosterId) { /* notes only for my team */ }
      else if (!mu) notes.push("Sleeper has no matchup for this week yet (preseason) - starting from an empty lineup.");
      else if (rosterId === o.rosterId) notes.push("Locks are read from Sleeper's per-slot points (a slot with points = locked). Use the lock toggles if that's wrong.");
    }
    const owner = users.find((u) => u.user_id === roster.owner_id);
    return {
      rosterId, ownerId: roster.owner_id, teamName: owner?.metadata?.team_name || owner?.display_name || `Team ${rosterId}`, pids,
      names: tw.names, positions: pids.map((p) => pl(p).fantasy_positions || []), injury: pids.map((p) => pl(p).injury_status ?? null),
      tw, games, real, st, events, evIdx, lineup, lockSource, sleeperPoints: mu?.points ?? null,
    };
  };

  const me = build(o.rosterId);
  const myMu = matchups.find((m) => m.roster_id === o.rosterId);
  const oppMu = !o.skipOpp && myMu?.matchup_id ? matchups.find((m) => m.matchup_id === myMu.matchup_id && m.roster_id !== o.rosterId) : undefined;
  const opp = oppMu ? build(oppMu.roster_id) : null;
  if (!opp && !o.skipOpp) notes.push("No opponent found for this week; win probability unavailable.");
  return { league, season, week, dates, asOf, mode, slotNames, me, opp, notes };
}
