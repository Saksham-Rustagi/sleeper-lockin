// One simulation per team-state, shared by every view (This week, Matchups, notifier).
// Draws are fixed per (player, scenario k, week): the numbers only move when something about THAT team changes
// (a score, lock, lineup, injury tag or projection), and both tabs show identical totals and win probabilities.
import * as E from "../engine/core";
import { POLICY, type LiveTeam } from "./week";
import { cachedCompute, fingerprint } from "./cache";

// Spread K scenarios over worker threads (scenario k is keyed by its index, so the result is identical however it's
// split). Falls back to the current thread in the browser, in tests, or if the worker bundle is missing.
let pool: { run: (T: LiveTeam, N: number, salt: number, asOf: number, k0: number) => Promise<Float64Array>; runTask: (task: any) => Promise<Float64Array>; size: number } | null | undefined;
async function getPool() {
  if (pool !== undefined) return pool;
  pool = null;
  try {
    if (typeof window !== "undefined" || process.env.LOCKIN_NO_WORKERS) return pool;
    const { Worker } = await import("worker_threads"); const os = await import("os"); const fs = await import("fs"); const path = await import("path");
    const file = [process.env.LOCKIN_SIMWORKER, path.join(process.cwd(), "scripts/dist/simworker.cjs"), typeof __dirname !== "undefined" ? path.join(__dirname, "simworker.cjs") : undefined]
      .find((f) => f && fs.existsSync(f));
    if (!file) { console.log(`[teamsim] no simworker.cjs found (cwd ${process.cwd()}), simulating on one core`); return pool; }
    const size = Math.max(1, Math.min(12, os.cpus().length - 2));
    const workers = Array.from({ length: size }, () => { const w = new Worker(file); w.unref(); return w; });
    let next = 0, id = 0; const waiting = new Map<number, (v: Float64Array) => void>();
    workers.forEach((w) => w.on("message", (m: { id: number; v: Float64Array }) => { waiting.get(m.id)?.(m.v); waiting.delete(m.id); }));
    const runTask = (task: any) => new Promise<Float64Array>((res) => { const i = ++id; waiting.set(i, res); workers[next++ % size].postMessage({ id: i, ...task }); });
    pool = { size, runTask, run: (T, N, salt, asOf, k0) => runTask({ kind: "week", T, N, salt, asOf, k0 }) };
    console.log(`[teamsim] ${size} simulation workers from ${file}`);
  } catch (e) { console.log("[teamsim] workers unavailable, simulating on one core:", e); pool = null; }
  return pool;
}
export async function parallelWeekValues(T: LiveTeam, K: number, salt: number, asOf: number): Promise<Float64Array> {
  const p = await getPool();
  if (!p || K < 4000) return weekValues(T, K, salt, asOf);
  const chunk = Math.ceil(K / p.size); const parts: Promise<Float64Array>[] = [];
  for (let k0 = 0; k0 < K; k0 += chunk) parts.push(p.run(T, Math.min(chunk, K - k0), salt, asOf, k0));
  const out = new Float64Array(K); let o = 0; for (const v of await Promise.all(parts)) { out.set(v, o); o += v.length; }
  return out;
}


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

export function weekValues(T: LiveTeam, N: number, salt: number, asOf: number, k0 = 0): Float64Array {
  const v = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const sc = scenario(T, k0 + k, salt, asOf);
    v[k] = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx).total;
  }
  return v;
}


// simulated weeks per team. Monte-Carlo error ≈ sd/√K: at 20k, ±0.35 pts on a total and ±0.7% on a win prob (95%).
export const TEAM_SIMS = Number(process.env.LOCKIN_SIMS || 20000);

// Everything that can change a team's outlook / the advice: roster, games (status/score/projection), lineup & lock
// state, injury overrides, which events have passed.
export function teamFingerprint(T: LiveTeam) {
  const st = T.st;
  return { pids: T.pids, injury: T.injury, lineup: T.lineup, evIdx: T.evIdx, pNext: T.tw.pNext ?? null,
    games: T.games.map((g) => [g.pid, g.tip, g.status, g.actual, Math.round(g.proj * 10) / 10, g.played]),
    st: [st.lockedBy, st.lockedPts, st.pinned, st.pendingX, st.inGame, st.lastPlayed] };
}

export async function teamSims(T: LiveTeam, week: number, asOf: number, K = TEAM_SIMS): Promise<Float64Array> {
  const fp = fingerprint({ v: 2, K, week, team: teamFingerprint(T) });
  const r = await cachedCompute(`team-${T.rosterId}-w${week}`, fp, async () => Array.from(await parallelWeekValues(T, K, week * 7919, asOf), (x) => Math.round(x * 100) / 100));
  return Float64Array.from(r.value);
}

export function summarize(v: Float64Array) {
  const s = Array.from(v).sort((a, b) => a - b); const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p10: q(0.1), p90: q(0.9) };
}
export function winProb(a: Float64Array, b: Float64Array) {
  let w = 0; for (let k = 0; k < a.length; k++) w += a[k] > b[k] ? 1 : a[k] === b[k] ? 0.5 : 0; return w / a.length;
}

// ---- lock cut-offs by simulation ----
// Player p's game g scores X. At his first lock decision (whenever his slot is next needed, or his next tip-off),
// "lock" locks him, "wait" lets him go and plays on; everything else follows the app's strategy.
// Locking adds exactly X to the rest of the week, so: cut-off = E[total | wait] - E[total | lock at 0].
export function lockWaitTotals(T: LiveTeam, st0: E.State, ev0: number, p: number, g: number, X: number, mode: "lock" | "wait", N: number, salt: number, asOf: number, k0 = 0): Float64Array {
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const sc = scenario(T, k0 + k, salt, asOf); sc.actual[g] = X; sc.played[g] = 1;
    let first = true;
    const hooks: E.Hooks = { decideLock: (_st, q, _t, _i, ev) => { if (q !== p || !first) return undefined as any; first = false; return mode === "lock" ? ev.lockSlot : null; } };
    out[k] = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(st0), ev0, hooks).total;
  }
  return out;
}
async function parallelLockWait(T: LiveTeam, st0: E.State, ev0: number, p: number, g: number, X: number, mode: "lock" | "wait", N: number, salt: number, asOf: number) {
  const pl = await getPool();
  if (!pl) return lockWaitTotals(T, st0, ev0, p, g, X, mode, N, salt, asOf);
  const chunk = Math.ceil(N / pl.size); const parts: Promise<Float64Array>[] = [];
  for (let k0 = 0; k0 < N; k0 += chunk) parts.push(pl.runTask({ kind: "lockwait", T, st0, ev0, p, g, X, mode, N: Math.min(chunk, N - k0), salt, asOf, k0 }));
  const out = new Float64Array(N); let o = 0; for (const v of await Promise.all(parts)) { out.set(v, o); o += v.length; } return out;
}
export const CUTOFF_SIMS = Number(process.env.LOCKIN_CUTOFF_SIMS || 6000);
export async function simCutoff(T: LiveTeam, st0: E.State, ev0: number, p: number, g: number, guess: number, asOf: number, N = CUTOFF_SIMS): Promise<number> {
  const salt = 31337;
  const mean = (v: Float64Array) => v.reduce((a, b) => a + b, 0) / v.length;
  const lock0 = mean(await parallelLockWait(T, st0, ev0, p, g, 0, "lock", N, salt, asOf));
  // E[wait] depends only slightly on X (his held score can sway the starts before the decision): two passes
  let x = guess;
  for (let i = 0; i < 2; i++) x = mean(await parallelLockWait(T, st0, ev0, p, g, x, "wait", N, salt, asOf)) - lock0;
  return x;
}
