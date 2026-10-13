// Trace a simulated week where dropping a player RAISES the total: what does the app do differently with him?
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { sleeper } from "../lib/live/sources";
const WHO = process.env.WHO || "Santi Aldama", WEEK = Number(process.env.WEEK || 1), N = Number(process.env.N || 2000);
const fmt = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
(async () => {
  const L = "1344387394811490304", asOf = Date.now();
  const P = await sleeper.players(3600e3); const id = Object.keys(P).find((k) => (P as any)[k].full_name === WHO)!;
  const A = (await buildWeek({ leagueId: L, rosterId: 8, week: WEEK, asOf, skipOpp: true })).me;
  const B = (await buildWeek({ leagueId: L, rosterId: 8, week: WEEK, asOf, rosterEdit: { drop: [id] }, skipOpp: true })).me;
  // scenario draws are keyed by player id, so the shared players get identical games in A and B
  const run = (T: typeof A, k: number, trace?: string[]) => {
    const sc = scenario(T, k, WEEK * 7919, asOf); let st = E.cloneState(T.st); let ev = T.evIdx;
    const times = [...new Set(T.events.slice(ev).map((e) => e.t))];
    for (const t of times) {
      const before = E.cloneState(st); const r = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, st, ev, undefined, t); st = r.st; ev = r.evIdx;
      if (!trace) continue;
      for (let s = 0; s < T.tw.slots.length; s++) {
        if (st.pinned[s] >= 0 && before.pinned[s] !== st.pinned[s]) { const p = st.pinned[s]; const g = st.inGame[p]; trace.push(`${fmt(t)}  START ${T.names[p]} in ${T.tw.slotNames[s]} (proj ${T.games[g].proj.toFixed(0)}, scores ${sc.played[g] ? sc.actual[g].toFixed(1) : "DNP"})`); }
        if (before.lockedBy[s] < 0 && st.lockedBy[s] >= 0) trace.push(`${fmt(t)}  LOCK ${T.names[st.lockedBy[s]]} ${st.lockedPts[s].toFixed(1)} in ${T.tw.slotNames[s]}`);
      }
      for (let p = 0; p < T.pids.length; p++) if (!Number.isNaN(before.pendingX[p]) && Number.isNaN(st.pendingX[p]) && !st.isLocked[p] && st.inGame[p] < 0) trace.push(`${fmt(t)}  LET GO ${T.names[p]}'s ${before.pendingX[p].toFixed(1)}`);
    }
    const fin = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, st, ev);
    return fin.total;
  };
  const d: { k: number; diff: number }[] = [];
  for (let k = 0; k < N; k++) d.push({ k, diff: run(B, k) - run(A, k) });
  const pos = d.filter((x) => x.diff > 0.01), neg = d.filter((x) => x.diff < -0.01);
  const mean = d.reduce((a, x) => a + x.diff, 0) / N;
  console.log(`Week ${WEEK}, ${N} simulated weeks: dropping ${WHO} changes the total by ${mean >= 0 ? "+" : ""}${mean.toFixed(2)} on average; helps in ${pos.length}, hurts in ${neg.length}, no change in ${N - pos.length - neg.length}`);
  console.log(`  average when it helps +${(pos.reduce((a, x) => a + x.diff, 0) / Math.max(1, pos.length)).toFixed(1)}, when it hurts ${(neg.reduce((a, x) => a + x.diff, 0) / Math.max(1, neg.length)).toFixed(1)}`);
  // a typical "helps" case (median of positive diffs), with both traces
  pos.sort((a, b) => a.diff - b.diff); const ex = pos[Math.floor(pos.length * 0.75)];
  const ta: string[] = [], tb: string[] = []; const a = run(A, ex.k, ta), b = run(B, ex.k, tb);
  console.log(`\nExample simulated week #${ex.k}: WITH ${WHO} ${a.toFixed(1)}, WITHOUT ${b.toFixed(1)} (+${(b - a).toFixed(1)})`);
  // print from the first divergence
  let i = 0; while (i < ta.length && i < tb.length && ta[i] === tb[i]) i++;
  console.log(`--- identical until ${ta[i]?.slice(0, 16)}; then WITH ${WHO}:`); console.log(ta.slice(i, i + 14).map((x) => "   " + x).join("\n"));
  console.log(`--- WITHOUT ${WHO}:`); console.log(tb.slice(i, i + 14).map((x) => "   " + x).join("\n"));
})();
