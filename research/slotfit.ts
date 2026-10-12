// Slot-by-slot effect of a roster move: expected locked points per slot and how often the slot ends empty.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY, type LiveTeam } from "../lib/live/week";

const LID = "1344387394811490304", RID = 8, N = 400;
const ADD = process.argv[2] || "", DROP = process.argv[3] || "";

function perSlot(T: LiveTeam, k: number) {
  const r = E.rng(1000 + k);
  const sc = E.sampleScenario(T.tw, T.st, 0, r, T.real);
  const res = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx);
  const st = res.st; const pts = new Float64Array(T.tw.slots.length).fill(NaN); const who: (string | null)[] = T.tw.slots.map(() => null);
  for (let s = 0; s < T.tw.slots.length; s++) if (st.lockedBy[s] >= 0) { pts[s] = st.lockedPts[s]; who[s] = T.names[st.lockedBy[s]]; }
  // week-end auto counts (same rule as the engine)
  const pend: number[] = []; const w = new Float64Array(T.pids.length);
  for (let p = 0; p < T.pids.length; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) { pend.push(p); w[p] = st.pendingX[p] + 1000; }
  const open = st.lockedBy.reduce((m, p, s) => (p < 0 ? m | (1 << s) : m), 0);
  const a = E.assignExact(T.tw.slots, open, pend, T.tw.pmask, w);
  for (const [p, s] of a.slotOf) { pts[s] = st.pendingX[p]; who[s] = T.names[p]; }
  return { pts, who };
}

async function run(label: string, edit?: { add?: string[]; drop?: string[] }) {
  const out: { mean: number[]; empty: number[]; top: Map<string, number>[] } = { mean: [], empty: [], top: [] };
  let slots: string[] = [];
  const sums: number[] = []; const empties: number[] = []; const tops: Map<string, number>[] = [];
  let total = 0;
  for (const week of [1, 2]) {
    const ctx = await buildWeek({ leagueId: LID, rosterId: RID, week, asOf: Date.parse("2026-10-19T12:00:00Z"), rosterEdit: edit, skipOpp: true });
    const T = ctx.me; slots = ctx.slotNames;
    for (let k = 0; k < N; k++) {
      const { pts, who } = perSlot(T, k + week * 100000);
      pts.forEach((v, s) => {
        sums[s] = (sums[s] || 0) + (Number.isNaN(v) ? 0 : v); empties[s] = (empties[s] || 0) + (Number.isNaN(v) ? 1 : 0);
        tops[s] ??= new Map(); if (who[s]) tops[s].set(who[s]!, (tops[s].get(who[s]!) || 0) + 1);
        total += Number.isNaN(v) ? 0 : v;
      });
    }
  }
  console.log(`\n${label}: total ${(total / (2 * N)).toFixed(1)} pts/week`);
  slots.forEach((s, i) => {
    const top = [...tops[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n} ${Math.round((100 * c) / (2 * N))}%`).join(", ");
    console.log(`  ${s.padEnd(5)} ${(sums[i] / (2 * N)).toFixed(1).padStart(5)} pts  empty ${((100 * empties[i]) / (2 * N)).toFixed(0)}%   ${top}`);
  });
  return total / (2 * N);
}

(async () => {
  const ctx = await buildWeek({ leagueId: LID, rosterId: RID, week: 1, skipOpp: true });
  const T = ctx.me;
  const elig = (bit: number) => T.names.filter((_, i) => T.tw.pmask[i] & bit);
  console.log("forward-eligible (SF/PF):", elig(12).length, "-", elig(12).join(", "));
  console.log("center-eligible:", elig(16).length, "-", elig(16).join(", "));
  console.log("C-only:", T.names.filter((_, i) => T.tw.pmask[i] === 16).join(", "));
  const base = await run("CURRENT ROSTER");
  if (ADD || DROP) { const v = await run(`ADD ${ADD} / DROP ${DROP}`, { add: ADD ? [ADD] : [], drop: DROP ? [DROP] : [] }); console.log(`\nchange: ${(v - base >= 0 ? "+" : "") + (v - base).toFixed(1)} pts/week`); }
})();
