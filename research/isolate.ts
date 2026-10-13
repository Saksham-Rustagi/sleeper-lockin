// Why does having a player on the roster LOWER the simulated total? Same simulated weeks, the player present but
// restricted in different ways, each compared with the roster WITHOUT him.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { sleeper } from "../lib/live/sources";
const WHO = process.env.WHO || "Santi Aldama", N = Number(process.env.N || 2000), WEEKS = (process.env.WEEKS || "1,2").split(",").map(Number);
(async () => {
  const L = "1344387394811490304", asOf = Date.now();
  const P = await sleeper.players(3600e3); const id = Object.keys(P).find((k) => (P as any)[k].full_name === WHO)!;
  const res: Record<string, number[]> = { normal: [], neverStart: [], neverLock: [], neverHoldPastSlotNeed: [] };
  for (const w of WEEKS) {
    const A = (await buildWeek({ leagueId: L, rosterId: 8, week: w, asOf, skipOpp: true })).me;
    const B = (await buildWeek({ leagueId: L, rosterId: 8, week: w, asOf, rosterEdit: { drop: [id] }, skipOpp: true })).me;
    const p = A.pids.indexOf(id);
    const play = (T: typeof A, k: number, hooks?: E.Hooks) => { const sc = scenario(T, k, w * 7919, asOf); return E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, hooks).total; };
    const neverStart: E.Hooks = { decideStarts: (_st, _t, _i, _tip, _pend, _g, slotOf) => { if (!slotOf.has(p)) return undefined; const m = new Map(slotOf); m.delete(p); return m; } };
    const neverLock: E.Hooks = { decideLock: (_st, q) => (q === p ? null : (undefined as any)) };
    for (let k = 0; k < N; k++) {
      const without = play(B, k);
      const i = w === WEEKS[0] ? k : k; // accumulate per scenario across weeks
      const add = (key: string, v: number) => { if (w === WEEKS[0]) res[key][k] = 0; res[key][k] += v - without; };
      add("normal", play(A, k)); add("neverStart", play(A, k, neverStart)); add("neverLock", play(A, k, neverLock));
    }
  }
  for (const [key, v] of Object.entries(res)) { if (!v.length) continue; const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    console.log(`${WHO} on the roster, ${key.padEnd(11)}: ${m >= 0 ? "+" : ""}${m.toFixed(2)} ± ${(1.96 * sd / Math.sqrt(v.length)).toFixed(2)} pts vs not having him   (identical weeks: ${v.filter((x) => Math.abs(x) < 1e-9).length}/${v.length})`); }
})();
