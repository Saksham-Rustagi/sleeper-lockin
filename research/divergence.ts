// With the player present but never started vs absent: classify the FIRST decision that differs.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { sleeper } from "../lib/live/sources";
const WHO = process.env.WHO || "Santi Aldama", N = Number(process.env.N || 600), W = Number(process.env.WEEK || 2);
(async () => {
  const L = "1344387394811490304", asOf = Date.now();
  const P = await sleeper.players(3600e3); const id = Object.keys(P).find((k) => (P as any)[k].full_name === WHO)!;
  const A = (await buildWeek({ leagueId: L, rosterId: 8, week: W, asOf, skipOpp: true })).me;
  const B = (await buildWeek({ leagueId: L, rosterId: 8, week: W, asOf, rosterEdit: { drop: [id] }, skipOpp: true })).me;
  const pa = A.pids.indexOf(id);
  const trace = (T: typeof A, k: number, hide: number) => {
    const sc = scenario(T, k, W * 7919, asOf); const log: string[] = []; const nm = (p: number) => T.names[p];
    const hooks: E.Hooks = {
      decideStarts: (st, t, _i, tip, pend, gameOf, slotOf) => { let m = slotOf; if (hide >= 0 && slotOf.has(hide)) { m = new Map(slotOf); m.delete(hide); }
        log.push(`${t}|START|${[...m.entries()].filter(([p]) => tip.includes(p)).map(([p, s]) => nm(p) + "@" + T.tw.slotNames[s]).sort().join(",")}|HELD-KEPT ${pend.filter((p) => m.has(p)).map(nm).sort().join(",")}`); return m === slotOf ? undefined : m; },
      decideLock: (st, p, t, _i, ev) => { const s = E.baseLockChoice(T.tw, POLICY, st, p, t, ev); log.push(`${t}|${s === null ? "LETGO" : "LOCK"}|${nm(p)} ${st.pendingX[p].toFixed(1)}|cut ${(ev.cont - (ev.lockBest - st.pendingX[p])).toFixed(1)}`); return undefined as any; },
    };
    const tot = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, hooks).total; return { log, tot };
  };
  const kinds: Record<string, { n: number; d: number }> = {}; const ex: string[] = [];
  for (let k = 0; k < N; k++) {
    const a = trace(A, k, pa), b = trace(B, k, -1); let i = 0; while (i < a.log.length && i < b.log.length && a.log[i] === b.log[i]) i++;
    if (i >= a.log.length && i >= b.log.length) continue;
    const ka = (a.log[i] || "END").split("|")[1], kb = (b.log[i] || "END").split("|")[1]; const key = ka === kb ? ka : `${ka}/${kb}`;
    kinds[key] = kinds[key] || { n: 0, d: 0 }; kinds[key].n++; kinds[key].d += a.tot - b.tot;
    if (ex.length < 5 && ka === kb && ka !== "START") ex.push(`with: ${a.log[i]}\n   without: ${b.log[i]}`);
  }
  for (const [k, v] of Object.entries(kinds).sort((x, y) => y[1].n - x[1].n)) console.log(`first difference = ${k.padEnd(14)} in ${String(v.n).padStart(4)} of ${N} weeks; total effect of having him there ${(v.d / N).toFixed(2)} pts/wk`);
  console.log(ex.join("\n"));
})();
