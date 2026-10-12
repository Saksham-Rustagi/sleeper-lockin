// One simulation per team-state, shared by every view (This week, Matchups, notifier).
// Draws are fixed per (player, scenario k, week): the numbers only move when something about THAT team changes
// (a score, lock, lineup, injury tag or projection), and both tabs show identical totals and win probabilities.
import * as E from "../engine/core";
import { POLICY, type LiveTeam } from "./week";
import { cachedCompute, fingerprint } from "./cache";


function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// Scenario k for a team variant: per-player RNG stream keyed by (pid, k, week), so the same player gets the same
// draws in every variant (adding/dropping someone doesn't reshuffle everyone else's luck).
export function scenario(T: LiveTeam, k: number, salt: number, asOf: number) {
  const actual = T.real.actual.slice(); const played = T.real.played.slice();
  T.pids.forEach((pid, i) => {
    const r = E.rng(hashStr(pid) ^ Math.imul(k + 1, 2654435761) ^ salt);
    let last = T.st.lastPlayed[i];
    for (const gi of T.tw.byPlayer[i]) {
      const g = T.tw.games[gi];
      const u1 = r(), u2 = r(), u3 = r(); // fixed number of draws per game keeps streams aligned
      if (T.games[gi].status === "post" || g.end <= asOf) { last = played[gi]; continue; }
      let pk = last ? T.tw.dnp.p1 : T.tw.dnp.p0;
      if (T.tw.pNext?.[i] != null && T.tw.nextGameIdx?.[i] === gi) pk = T.tw.pNext[i]!;
      const pl = u1 < pk ? 1 : 0;
      const z = Math.sqrt(-2 * Math.log(Math.max(u2, 1e-12))) * Math.cos(2 * Math.PI * u3);
      played[gi] = pl; actual[gi] = pl ? Math.max(-5, g.mu + g.sd * z) : 0; last = pl;
    }
  });
  return { actual, played };
}

export function weekValues(T: LiveTeam, N: number, salt: number, asOf: number): Float64Array {
  const v = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const sc = scenario(T, k, salt, asOf);
    v[k] = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx).total;
  }
  return v;
}


export const TEAM_SIMS = 2000; // win-prob 95% margin about ±2 pts

// Everything that can change a team's outlook / the advice: roster, games (status/score/projection), lineup & lock
// state, injury overrides, which events have passed.
export function teamFingerprint(T: LiveTeam) {
  const st = T.st;
  return { pids: T.pids, injury: T.injury, lineup: T.lineup, evIdx: T.evIdx, pNext: T.tw.pNext ?? null,
    games: T.games.map((g) => [g.pid, g.tip, g.status, g.actual, Math.round(g.proj * 10) / 10, g.played]),
    st: [st.lockedBy, st.lockedPts, st.pinned, st.pendingX, st.inGame, st.lastPlayed] };
}

export async function teamSims(T: LiveTeam, week: number, asOf: number, K = TEAM_SIMS): Promise<Float64Array> {
  const fp = fingerprint({ v: 1, K, week, team: teamFingerprint(T) });
  const r = await cachedCompute(`team-${T.rosterId}-w${week}`, fp, () => Array.from(weekValues(T, K, week * 7919, asOf)));
  return Float64Array.from(r.value);
}

export function summarize(v: Float64Array) {
  const s = Array.from(v).sort((a, b) => a - b); const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p10: q(0.1), p90: q(0.9) };
}
export function winProb(a: Float64Array, b: Float64Array) {
  let w = 0; for (let k = 0; k < a.length; k++) w += a[k] > b[k] ? 1 : a[k] === b[k] ? 0.5 : 0; return w / a.length;
}
