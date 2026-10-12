// Is "lock Hartenstein at >= 22.9" right? Monte-Carlo: he scores X in his Tuesday game; at his decision point
// compare LOCK vs WAIT (release, play on), everything else played by the app's strategy. 20k scenarios, paired.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario, weekValues } from "../lib/live/teamsim";
const NAME = process.env.WHO || "Isaiah Hartenstein", K = Number(process.env.K || 20000);
(async () => {
  const c = await buildWeek({ leagueId: "1344387394811490304", rosterId: 8, mode: "live" });
  const T = c.me, tw = T.tw; const p = T.names.indexOf(NAME); const gis = tw.byPlayer[p]; const g0 = gis[0];
  const fmt = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  console.log(`${NAME}: ${gis.length} games this week:`, gis.map((gi) => `${fmt(tw.games[gi].tip)} proj ${T.games[gi].proj.toFixed(1)} (sd ${tw.games[gi].sd.toFixed(1)})`).join(" | "));
  const C = T.names.filter((_, i) => tw.pmask[i] & 16); console.log("C-eligible on roster:", C.join(", "));
  const opp = weekValues(c.opp!, K, 104729, c.asOf);
  const run = (X: number, mode: "app" | "lock" | "wait") => {
    let sum = 0, win = 0, decidedAt: number[] = [];
    for (let k = 0; k < K; k++) {
      const sc = scenario(T, k, 1 * 7919, c.asOf); sc.actual[g0] = X; sc.played[g0] = 1;
      let first = true;
      const hooks: E.Hooks = { decideLock: (st, q, t, _i, ev) => { if (q !== p || !first) return undefined as any; first = false; decidedAt.push(t); return mode === "lock" ? ev.lockSlot : mode === "wait" ? null : (undefined as any); } };
      const tot = E.simulate(tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, hooks).total;
      sum += tot; win += tot > opp[k] ? 1 : tot === opp[k] ? 0.5 : 0;
    }
    return { mean: sum / K, win: win / K, at: decidedAt };
  };
  console.log("\nHartenstein scores X on Tuesday | lock him | wait for better | difference (lock − wait) | win% lock / wait");
  for (const X of [16, 19, 21, 22, 23, 24, 26, 30, 35]) {
    const L = run(X, "lock"), W = run(X, "wait");
    console.log(`  X=${String(X).padStart(2)}  ${L.mean.toFixed(1)}  ${W.mean.toFixed(1)}  ${(L.mean - W.mean >= 0 ? "+" : "") + (L.mean - W.mean).toFixed(2)}   ${(100 * L.win).toFixed(1)}% / ${(100 * W.win).toFixed(1)}%`);
    if (X === 23) { const at = L.at; const counts: Record<string, number> = {}; at.forEach((t) => { const s = fmt(t + 1); counts[s] = (counts[s] || 0) + 1; }); console.log("     (decision point: " + Object.entries(counts).map(([s, n]) => `${s} ${(100 * n / at.length).toFixed(0)}%`).join(", ") + ")"); }
  }
})();
