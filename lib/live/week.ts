// Build an engine TeamWeek (+ reconstructed State) for a Sleeper roster from live or historical data.
import * as E from "../engine/core";
import { gameDist, injuryPlayProb, fantasyPoints, MODEL } from "../engine/model";
import { sleeper, espnDay, type League, type GameRow, type SleeperPlayer, type Matchup } from "./sources";
import { minutesOverrides } from "./oppscan";
import type { Override } from "./opportunity";
import { nbaRosters, rosterCheck, type RosterFix } from "./nbarosters";

// holdYield: a held score never blocks a player tipping off - it must be locked or let go (backtest +2.2 pts/wk live;
// fixes "dropping a bench player gains points", which a sound rule can't do).
export const POLICY: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true,
  // engine-v2 phase-1 fixes on (strand, negEnd, reseat, exact stopValue); the held-score tie-break fix (B4) is a policy
  // choice that cost ~1.9 pts/wk in the live algorithm on the 2025-26 backtest, so keep the old tie-break.
  legacyBugs: ["heldTie"] };
const GAME_LEN = 2.5 * 3600e3;

export interface LiveGame {
  gi: number; pid: string; date: string; tip: number; end: number; team: string; opp: string;
  proj: number; mu: number; sd: number; status: "pre" | "in" | "post"; actual: number | null; played: boolean | null;
  projOverride?: string; // "projection override: based on last N games (...)" when the minutes override replaced Sleeper's projection
}
export interface LiveTeam {
  rosterId: number; ownerId: string; teamName: string; pids: string[]; names: string[]; positions: string[][];
  injury: (string | null)[]; tw: E.TeamWeek; games: LiveGame[]; real: { actual: Float64Array; played: Uint8Array };
  st: E.State; events: E.Ev[]; evIdx: number; lineup: (string | null)[]; lockSource: ("sleeper" | "override" | "final" | "sim" | null)[];
  sleeperPoints: number | null;
  overrides?: Record<string, Override>; // minutes-based projection overrides applied to this team's players (option "minutesOverride")
  rosterFix?: Record<string, RosterFix>; // task R: players whose Sleeper team's current NBA roster doesn't list them (live only)
}
export interface WeekContext {
  league: League; season: string; week: number; dates: string[]; asOf: number; mode: "live" | "replay";
  slotNames: string[]; me: LiveTeam; opp: LiveTeam | null; notes: string[];
}

// Lock state of one starting slot, inferred from evidence (live mode; task "held vs locked"). Sleeper's API has no
// lock flag: starters_points[s] is the score the slot counts NOW, which is the same number whether the player locked it
// or only holds it (Lock-In: a finished game is held until his next tip-off; the manager may lock it, keep holding,
// or let it go). Rule, in order:
//  (a) a user lock override wins (pid = locked at Sleeper's score; null = never treated as locked);
//  (b) his game is in progress -> "inGame", unless the slot still shows an EARLIER finished game's nonzero score while
//      the live game's own points differ (or aren't known yet) -> "locked" (a locked player's later games don't count);
//  (c) his last game is finished and his next game hasn't tipped -> "held" at Sleeper's slot score (the engine decides
//      lock / hold / let go); if he has no game left the held score is final -> "locked" (source "final");
//  (d) "locked" (source "sleeper") only with evidence: a LATER game of his has finished but the slot still shows an
//      earlier game's score.
// Edge cases: slot score 0 is never inferred locked (a 0 is held or nothing, and locking a 0 is dominated - use the
// toggle); a nonzero score equal to both the last and an earlier game -> held (the reversible reading, noted);
// a nonzero score that matches no game (stat correction / lag) -> held at Sleeper's number if a game is left (noted);
// slot score 0 after a nonzero game -> he wasn't in the lineup at that tip-off, so he holds nothing ("idle").
export interface SlotGame { gi: number; tip: number; status: "pre" | "in" | "post"; actual: number | null; livePts?: number | null }
export type SlotState = { kind: "empty" | "idle" } | { kind: "inGame"; gi: number } | { kind: "held"; pts: number; gi: number; deadline: number | null }
  | { kind: "locked"; pts: number; source: "override" | "sleeper" | "final" };
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
// why: the reading, for the UI; note: unusual reading worth telling the manager (shown in the notes)
export function inferSlot(a: { pts: number; override?: string | null; pid: string | null; overridePts?: number | null; games: SlotGame[] }): SlotState & { why: string; note?: boolean } {
  if (a.override) return { kind: "locked", pts: a.overridePts ?? a.pts, source: "override", why: "marked locked by you" };
  if (!a.pid) return { kind: "empty", why: "" };
  const lockOk = a.override !== null; // "mark unlocked": evidence never makes it locked
  const gs = [...a.games].sort((x, y) => x.tip - y.tip);
  const done = gs.filter((g) => g.status === "post"); const live = gs.find((g) => g.status === "in");
  const next = gs.find((g) => g.status === "pre");
  const earlierMatch = (before: number) => done.some((g) => g.tip < before && same(g.actual ?? 0, a.pts));
  const held = (gi: number, why: string, note?: boolean) => ({ kind: "held" as const, pts: a.pts, gi, deadline: next?.tip ?? null, why, ...(note ? { note } : {}) });
  if (live) {
    if (lockOk && a.pts !== 0 && earlierMatch(live.tip) && !(live.livePts != null && same(live.livePts, a.pts)))
      return { kind: "locked", pts: a.pts, source: "sleeper", why: `his next game is live but the slot still shows the earlier ${a.pts}`, note: true };
    return { kind: "inGame", gi: live.gi, why: "game in progress" };
  }
  if (!done.length) return a.pts !== 0 ? { kind: "idle", why: `slot shows ${a.pts} but no finished game of his this week`, note: true } : { kind: "idle", why: "" };
  const last = done[done.length - 1]; const la = last.actual ?? 0;
  if (a.pts === 0) return la === 0 ? held(last.gi, "held 0") : { kind: "idle", why: `scored ${la} but the slot shows 0 (not in the lineup at that tip-off): holds nothing`, note: true };
  if (same(a.pts, la)) {
    if (!next && lockOk && a.pts > 0) return { kind: "locked", pts: a.pts, source: "final", why: "no game left: the held score is final" };
    return earlierMatch(last.tip) ? held(last.gi, "same score as an earlier game: read as held (reversible); use the toggle if it's locked", true) : held(last.gi, "finished, next game not tipped");
  }
  if (lockOk && earlierMatch(last.tip)) return { kind: "locked", pts: a.pts, source: "sleeper", why: `a later game finished (${la}) but the slot still shows ${a.pts}`, note: true };
  if (!next && lockOk && a.pts > 0) return { kind: "locked", pts: a.pts, source: "final", why: `no game left; slot shows ${a.pts} (last game ${la})`, note: true };
  return held(last.gi, `slot shows ${a.pts}, last game ${la} (stat correction?): held at Sleeper's number`, true);
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
  // task O: flagged players' minutes-based projections (live only; null unless "minutesOverride" is on)
  const ovAll = mode === "live" ? await minutesOverrides(o.leagueId, asOf0) : null;
  const statRow = new Map(wstats.map((r) => [`${r.player_id}|${r.date}`, r]));
  // task R: current NBA rosters (ESPN; live only, null when the fetch fails or "rosterCheck" is off)
  const nbaR = mode === "live" ? await nbaRosters() : null;

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
    const rfix = rosterCheck(players, pids, nbaR);
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
        let team: string | null = teamByDate.get(g.date) ?? fallbackTeam;
        // task R: a not-yet-started game of a team whose roster doesn't list him -> his new team's game that day, or none
        const fx = rfix[pid];
        if (fx && (team ?? null) === fx.from && (espn.get(`${g.date}|${team}`)?.state ?? "pre") === "pre") team = fx.to;
        if (!team || ![g.home.team, g.away.team].includes(team)) continue;
        const pr = projRow.get(`${pid}|${g.date}`); const srow = statRow.get(`${pid}|${g.date}`);
        let proj: number;
        if (pr?.stats && Object.keys(pr.stats).length) { proj = fantasyPoints(pr.stats, S); lastProj = proj; }
        else proj = lastProj ?? seasonPer; // replay: never treat a missing projection as a DNP signal (it leaks)
        const ek = espn.get(`${g.date}|${team}`);
        const tip = ek?.tip ?? Date.parse(g.date + "T23:30:00Z");
        let status: LiveGame["status"] = ek?.state ?? "pre";
        if (mode === "replay") status = tip + GAME_LEN <= asOf ? "post" : tip <= asOf ? "in" : "pre";
        // the override only ever raises a game's projection (Sleeper may already have reacted to the news); a
        // no-projection override (task O2) only replaces the fallback of a game without a Sleeper projection row
        const ov = status === "pre" && ovAll?.[pid] && ovAll[pid].perGame > proj && (ovAll[pid].source !== "noProjection" || !(pr?.stats && Object.keys(pr.stats).length)) ? ovAll[pid] : undefined;
        if (ov) proj = ov.perGame;
        const played = srow?.stats ? !!(srow.stats.gp || srow.stats.sp) : status === "post" ? false : null;
        const actual = status === "post" ? (played ? fantasyPoints(srow!.stats, S) : 0) : null;
        let end = tip + GAME_LEN;
        if (status === "post" && end > asOf) end = asOf - 1;
        if (status === "in" && end <= asOf) end = asOf + 15 * 60e3;
        const d = gameDist(proj);
        games.push({ gi: -1, pid, date: g.date, tip, end, team, opp: g.home.team === team ? g.away.team : g.home.team, proj, mu: d.mu, sd: d.sd, status, actual, played, ...(ov ? { projOverride: ov.label } : {}) });
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
      // lock / held / in-game per slot from evidence (inferSlot above), for both teams
      slotNames.forEach((_, s) => {
        const ov = o.lockOverrides?.[s];
        const pid = ov ? ov : lineup[s];
        if (pid && !pidx.has(pid)) return;
        const i = pid ? pidx.get(pid)! : -1;
        const pts = mu?.starters_points?.[s] ?? 0;
        const gs: SlotGame[] = i < 0 ? [] : byPlayer[i].map((gi) => {
          const g = games[gi]; const sr = g.status === "in" ? statRow.get(`${g.pid}|${g.date}`) : undefined;
          return { gi, tip: g.tip, status: g.status, actual: g.actual, livePts: sr?.stats ? fantasyPoints(sr.stats, S) : null };
        });
        const x = inferSlot({ pts, override: ov, pid, overridePts: ov ? mu?.players_points?.[ov] ?? null : null, games: gs });
        if (x.note && i >= 0) notes.push(`${rosterId === o.rosterId ? "" : "Opponent's "}${tw.names[i]} (${slotNames[s]}): ${x.kind} - ${x.why}.`);
        if (x.kind === "locked") { st.lockedBy[s] = i; st.isLocked[i] = 1; st.lockedPts[s] = x.pts; lockSource[s] = x.source; }
        else if (x.kind === "inGame") { st.inGame[i] = x.gi; st.pinned[s] = i; st.pinnedUntil[s] = games[x.gi].end; st.started[x.gi] = 1; }
        else if (x.kind === "held") { st.pendingX[i] = x.pts; st.started[x.gi] = 1; }
      });
      if (rosterId !== o.rosterId) { /* notes only for my team */ }
      else if (!mu) notes.push("Sleeper has no matchup for this week yet (preseason) - starting from an empty lineup.");
      else notes.push("Lock state is inferred per slot (Sleeper has no lock flag): a finished game whose next game hasn't tipped is HELD (lock or let go before the next tip-off); a slot counts as locked only when a later game of his has started or finished but the slot still shows the earlier score, or he has no game left. Use the lock toggles if that's wrong.");
    }
    const owner = users.find((u) => u.user_id === roster.owner_id);
    return {
      rosterId, ownerId: roster.owner_id, teamName: owner?.metadata?.team_name || owner?.display_name || `Team ${rosterId}`, pids,
      names: tw.names, positions: pids.map((p) => pl(p).fantasy_positions || []), injury: pids.map((p) => pl(p).injury_status ?? null),
      tw, games, real, st, events, evIdx, lineup, lockSource, sleeperPoints: mu?.points ?? null,
      ...(Object.keys(rfix).length ? { rosterFix: rfix } : {}),
      ...(games.some((g) => g.projOverride) ? { overrides: Object.fromEntries([...new Set(games.filter((g) => g.projOverride).map((g) => g.pid))].map((p) => [p, ovAll![p]])) } : {}),
    };
  };

  const me = build(o.rosterId);
  const rosterNotes = (T: LiveTeam, who: string) => Object.values(T.rosterFix || {}).forEach((f) => notes.push(`${who}${T.names[T.pids.indexOf(f.pid)]}: ${f.label}.`));
  rosterNotes(me, "");
  const myMu = matchups.find((m) => m.roster_id === o.rosterId);
  const oppMu = !o.skipOpp && myMu?.matchup_id ? matchups.find((m) => m.matchup_id === myMu.matchup_id && m.roster_id !== o.rosterId) : undefined;
  const opp = oppMu ? build(oppMu.roster_id) : null;
  if (opp) rosterNotes(opp, "Opponent's ");
  if (!opp && !o.skipOpp) notes.push("No opponent found for this week; win probability unavailable.");
  return { league, season, week, dates, asOf, mode, slotNames, me, opp, notes };
}
