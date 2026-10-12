// League-wide week view: every team's projected Lock-In total for this week (assuming each plays it optimally,
// starting from their real locks / held scores / finished games), and win probability for each matchup.
import { buildWeek, resolveWeek, type LiveTeam } from "./week";
import { sleeper } from "./sources";
import * as E from "../engine/core";
import { POLICY } from "./week";
import { cachedCompute, fingerprint } from "./cache";

export interface LeagueTeam {
  rosterId: number; name: string; mine: boolean;
  current: number | null;          // Sleeper's live points so far
  locked: number;                  // points locked in slots
  mean: number; p10: number; p90: number;
  playerGames: number; gamesLeft: number; playersWithGames: number;
  out: string[];                   // Out/Doubtful players with games this week
  top: { name: string; games: number; proj: number }[];
}
export interface LeagueMatchup { id: number; a: LeagueTeam; b: LeagueTeam | null; winA: number | null; mine: boolean }
export interface LeagueWeek { season: string; week: number; dates: string[]; matchups: LeagueMatchup[]; sims: number; generatedAt: number; cached?: boolean }

const q = (v: Float64Array, p: number) => { const s = Array.from(v).sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };

function simulateTeam(T: LiveTeam, K: number, asOf: number, seed: number) {
  const r = E.rng(seed); const out = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const sc = E.sampleScenario(T.tw, T.st, asOf, r, T.real);
    out[k] = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx).total;
  }
  return out;
}

export async function leagueWeek(o: { leagueId: string; rosterId: number; week?: number; K?: number; asOf?: number }): Promise<LeagueWeek> {
  const asOf = o.asOf ?? Date.now(); const K = o.K ?? 1000;
  const league = await sleeper.league(o.leagueId);
  const week = o.week ?? (await resolveWeek(league.season, asOf));
  const [rosters, matchups] = await Promise.all([sleeper.rosters(o.leagueId), sleeper.matchups(o.leagueId, week).catch(() => [])]);
  const teams: LiveTeam[] = []; let dates: string[] = [];
  for (const r of rosters) { const c = await buildWeek({ leagueId: o.leagueId, rosterId: r.roster_id, week, asOf, skipOpp: true }); teams.push(c.me); dates = c.dates; }

  // recompute only if something that affects a projection changed (games, scores, locks, lineups, injuries, projections)
  const fp = fingerprint({ v: 1, K, week, teams: teams.map((t) => [t.rosterId, t.pids, t.injury, t.lineup, Array.from(t.st.lockedBy), Array.from(t.st.lockedPts), Array.from(t.st.pendingX).map((x) => (Number.isNaN(x) ? null : x)),
    t.games.map((g) => [g.tip, g.status, g.actual, Math.round(g.mu * 10)])]), mu: matchups.map((m) => [m.roster_id, m.matchup_id]) });
  const res = await cachedCompute(`league-${o.leagueId}-w${week}`, fp, (): LeagueWeek => {
    const sims = new Map<number, Float64Array>();
    const view = new Map<number, LeagueTeam>();
    for (const T of teams) {
      const v = simulateTeam(T, K, asOf, 1000 + T.rosterId * 7919 + week);
      sims.set(T.rosterId, v);
      const perPlayer = T.pids.map((_, i) => ({ name: T.names[i], games: T.tw.byPlayer[i].length, proj: T.tw.byPlayer[i].reduce((a, gi) => a + T.games[gi].proj, 0) / Math.max(1, T.tw.byPlayer[i].length) }));
      view.set(T.rosterId, {
        rosterId: T.rosterId, name: T.teamName, mine: T.rosterId === o.rosterId, current: T.sleeperPoints,
        locked: Array.from(T.st.lockedPts).reduce((a, x) => a + (x || 0), 0),
        mean: v.reduce((a, x) => a + x, 0) / K, p10: q(v, 0.1), p90: q(v, 0.9),
        playerGames: T.games.length, gamesLeft: T.games.filter((g) => g.status !== "post").length, playersWithGames: perPlayer.filter((p) => p.games > 0).length,
        out: T.pids.map((_, i) => i).filter((i) => ["out", "doubtful"].includes((T.injury[i] || "").toLowerCase()) && T.tw.byPlayer[i].length).map((i) => T.names[i]),
        top: perPlayer.filter((p) => p.games).sort((a, b) => b.proj - a.proj).slice(0, 3).map((p) => ({ ...p, proj: Math.round(p.proj * 10) / 10 })),
      });
    }
    const ids = [...new Set(matchups.map((m) => m.matchup_id).filter((x): x is number => x != null))].sort((a, b) => a - b);
    const out: LeagueMatchup[] = ids.map((id) => {
      const [ra, rb] = matchups.filter((m) => m.matchup_id === id).map((m) => m.roster_id);
      let A = view.get(ra)!, B = rb ? view.get(rb)! : null;
      if (B?.mine) [A, B] = [B, A]; // your team on the left
      let win: number | null = null;
      if (B) { const va = sims.get(A.rosterId)!, vb = sims.get(B.rosterId)!; let w = 0; for (let k = 0; k < K; k++) w += va[k] > vb[k] ? 1 : va[k] === vb[k] ? 0.5 : 0; win = w / K; }
      return { id, a: A, b: B, winA: win, mine: A.mine || !!B?.mine };
    }).sort((x, y) => Number(y.mine) - Number(x.mine) || x.id - y.id);
    return { season: league.season, week, dates, matchups: out, sims: K, generatedAt: Date.now() };
  });
  return { ...res.value, cached: res.cached };
}
