// Task W (waiver backtest): every player's games (rostered and free agents, research/w_build.py), walk-forward
// projections, team-weeks for any roster, paired per-player scenarios (the Waivers page's draws), dynasty protection.
import fs from "fs";
import * as E from "./engine";
import { S, fitModel, type Model } from "./btcommon";

export const A = JSON.parse(fs.readFileSync(process.env.WALL || "research/data/w/all2025.json", "utf8"));
export { S, fitModel, type Model };
export type G = { pid: string; gid: string; date: string; tip: number; team: string; opp: string; actual: number; played: boolean; proj_sleeper: number | null; week: number; pre?: number };
export const all: G[] = [];
for (const [w, gs] of Object.entries<any[]>(A.games)) for (const g of gs) all.push({ ...g, week: Number(w) });
all.sort((a, b) => a.tip - b.tip);
export const byPid = new Map<string, G[]>();
for (const g of all) { if (!byPid.has(g.pid)) byPid.set(g.pid, []); byPid.get(g.pid)!.push(g); }
const byPidWeek = new Map<string, G[]>();
for (const g of all) { const k = g.pid + "|" + g.week; if (!byPidWeek.has(k)) byPidWeek.set(k, []); byPidWeek.get(k)!.push(g); }
export const gamesOf = (pid: string, week: number) => byPidWeek.get(pid + "|" + week) || [];
export const LAST_WEEK = Math.max(...all.map((g) => g.week));
// pre-game projection (btcommon.projPre over all players' histories): Sleeper's per-game projection, else his latest
// earlier projection, else the mean of his last <= 10 played games, else 12
for (const [, gs] of byPid) {
  let lastProj: number | null = null; const acts: number[] = [];
  for (const g of gs) {
    g.pre = g.proj_sleeper != null ? g.proj_sleeper : lastProj != null ? lastProj : acts.length ? acts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, acts.length) : 12;
    if (g.proj_sleeper != null) lastProj = g.proj_sleeper; if (g.played) acts.push(g.actual);
  }
}
// projection a manager sees at time T for a player without a game listed (his latest projection before T, ...)
export function projAt(pid: string, T: number): number {
  let lastProj: number | null = null; const acts: number[] = [];
  for (const g of byPid.get(pid) || []) { if (g.tip >= T) break; if (g.proj_sleeper != null) lastProj = g.proj_sleeper; if (g.played) acts.push(g.actual); }
  return lastProj ?? (acts.length ? acts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, acts.length) : 12);
}
export const weekStart = (w: number) => Math.min(...all.filter((g) => g.week === w).map((g) => g.tip)) - 3600e3;
export const before = (pid: string, T: number) => (byPid.get(pid) || []).filter((g) => g.tip < T);
export function lastPlayed(pid: string, T: number) { const h = before(pid, T); return h.length ? (h[h.length - 1].played ? 1 : 0) : 1; }
export function dnpStreak(pid: string, T: number) { const h = before(pid, T); let n = 0; for (let i = h.length - 1; i >= 0 && !h[i].played; i--) n++; return n; }
// share of his last <= 10 team games he played, shrunk toward 0.9 with 3 pseudo-games (long-term availability)
export function availability(pid: string, T: number) { const h = before(pid, T).slice(-10); return (h.filter((g) => g.played).length + 2.7) / (h.length + 3); }
// team schedule (known in advance): team -> games per week; a player's team as of T = team of his latest game before T
const teamWeekGames = new Map<string, number>();
{ const seen = new Set<string>(); for (const g of all) { const k = g.team + "|" + g.date; if (seen.has(k)) continue; seen.add(k); const kw = g.team + "|" + g.week; teamWeekGames.set(kw, (teamWeekGames.get(kw) || 0) + 1); } }
export function teamAt(pid: string, T: number): string | null { const h = before(pid, T); if (h.length) return h[h.length - 1].team; return (byPid.get(pid) || [])[0]?.team ?? null; }
export const teamGamesIn = (team: string | null, w: number) => (team ? teamWeekGames.get(team + "|" + w) || 0 : 0);

// dynasty protection as on the Waivers page: age <= 23 (exact, from the birth date, at the decision date) or dynasty
// ADP <= 120 (current Sleeper value: no history)
export function ageAt(pid: string, date: string): number | null {
  const b = A.birth[pid]; if (!b) return null;
  const [y, m, d] = b.split("-").map(Number); const [Y, M, D] = date.split("-").map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}
export function isProtected(pid: string, w: number) { const age = ageAt(pid, A.weekStart[String(w)]); return (age ?? 99) <= 23 || (A.adp[pid] ?? 999) <= 120; }

export const ACTIVE = 19; // 9 starting slots + 10 bench; IR (2 spots) doesn't count
// team-week for any roster (games of week w, model fitted before the decision week)
export function teamWeekFor(pids: string[], w: number, model: Model, lastPlayedT: number): { tw: E.TeamWeek; real: { actual: Float64Array; played: Uint8Array } } {
  const pidx = new Map(pids.map((p, i) => [p, i]));
  const wg = pids.flatMap((p) => gamesOf(p, w)).sort((a, b) => a.tip - b.tip);
  const games: E.Game[] = wg.map((g) => {
    const pr = g.pre!; const mu = model.a + model.b * pr; const sd = Math.sqrt(Math.max(9, model.c + model.d * mu));
    return { p: pidx.get(g.pid)!, tip: g.tip, end: g.tip + 2.5 * 3600e3, mu, sd, projRaw: pr, actual: g.actual, played: g.played };
  });
  const byPlayer: number[][] = pids.map(() => []); games.forEach((g, i) => byPlayer[g.p].push(i));
  const slotNames: string[] = S.slots;
  const tw: E.TeamWeek = {
    slots: slotNames.map((s) => E.SLOT_MASK[s]), slotNames, pmask: pids.map((p) => E.posMask(A.pos[p] || ["UTIL"])),
    names: pids.map((p) => A.names[p] || p), games, byPlayer, lastPlayed0: pids.map((p) => lastPlayed(p, lastPlayedT)), dnp: model.dnp, resid: model.resid,
  };
  return { tw, real: { actual: Float64Array.from(games.map((g) => g.actual)), played: Uint8Array.from(games.map((g) => (g.played ? 1 : 0))) } };
}

// Scenario k: per-player stream keyed by (pid, k, salt) exactly like lib/live/teamsim.ts, so a player has the same
// draws in every roster variant (add / drop differences are paired).
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function scenario(tw: E.TeamWeek, pids: string[], k: number, salt: number) {
  const actual = new Float64Array(tw.games.length), played = new Uint8Array(tw.games.length);
  pids.forEach((pid, i) => {
    const r = E.rng(hashStr(pid) ^ Math.imul(k + 1, 2654435761) ^ salt);
    let last = tw.lastPlayed0[i];
    for (const gi of tw.byPlayer[i]) {
      const g = tw.games[gi]; const u1 = r(), u2 = r(), u3 = r();
      const pl = u1 < (last ? tw.dnp.p1 : tw.dnp.p0) ? 1 : 0;
      const z = Math.sqrt(-2 * Math.log(Math.max(u2, 1e-12))) * Math.cos(2 * Math.PI * u3);
      played[gi] = pl; actual[gi] = pl ? Math.max(-5, g.mu + g.sd * z) : 0; last = pl;
    }
  });
  return { actual, played };
}
export function simValues(tw: E.TeamWeek, pids: string[], pol: E.Policy, N: number, salt: number): Float64Array {
  const ev = E.buildEvents(tw, pol.chain); const v = new Float64Array(N);
  for (let k = 0; k < N; k++) { const sc = scenario(tw, pids, k, salt); v[k] = E.simulate(tw, pol, ev, sc.actual, sc.played, E.initState(tw), 0).total; }
  return v;
}
