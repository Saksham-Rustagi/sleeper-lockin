// Task L (P10b acceptance fix): research probes on P10's races (observe only: own random streams, decisions untouched).
//  - tuneProbe: after every raced decision, the challenger the confirmation would look at (the race's switch, else its
//    best challenger by race gain), if the race switched or its race gain is > gate: its paired gain over P8's decision
//    on N fresh scenarios (per scenario, so confirmation rules can be replayed offline: research/l_tune.py).
//  - runnerUpProbe: task H's statistic (research/htrace.ts FRESH): the best challenger NOT chosen, re-scored against the
//    chosen decision on N fresh scenarios when the race scored it > minGap better (what one more step would gain).
import * as E from "./engine";
import { continuation, type RaceInfo, type Scen } from "../lib/engine/p10";

function fresh(tw: E.TeamWeek, events: E.Ev[], x: RaceInfo, a: number, b: number, n: number, r: () => number, realised: { actual: Float64Array; played: Uint8Array }) {
  const scratch = E.scratchState(); const d: number[] = [];
  for (let k = 0; k < n; k++) {
    const sc: Scen = E.sampleScenario(tw, x.st, x.t, r, realised);
    const va = continuation(tw, x.base, events, x.st, x.evIdx, x.cands[a].d, sc, scratch);
    const vb = continuation(tw, x.base, events, x.st, x.evIdx, x.cands[b].d, sc, scratch);
    d.push(Math.round(((x.score ? x.score(vb) - x.score(va) : vb - va)) * 100) / 100);
  }
  return d;
}
const best = (x: RaceInfo, skip = -1) => { let L = -1; for (let i = 1; i < x.res.per.length; i++) if (i !== skip && x.res.per[i].n > 1 && (L < 0 || x.res.per[i].m > x.res.per[L].m)) L = i; return L; };
const r2 = (v: number) => Math.round(v * 1000) / 1000;

export function tuneProbe(tw: E.TeamWeek, events: E.Ev[], sd: number, realised: { actual: Float64Array; played: Uint8Array }, n: number, gate: number, out: any[]) {
  return (x: RaceInfo) => {
    const L = x.res.pick || best(x); if (L < 1) return;
    const p = x.res.per[L]; if (!x.res.pick && !(p.m > gate)) return;
    const r = E.rng((sd * 7919 + x.evIdx * 104729) ^ 0x1b873593);
    out.push({ ev: x.evIdx, t: x.t, why: x.cands[L].why, acc: x.res.pick ? 1 : 0, k: x.res.k, nc: x.cands.length, n: p.n, m: r2(p.m), se: r2(p.se), d: fresh(tw, events, x, 0, L, n, r, realised) });
  };
}
export function runnerUpProbe(tw: E.TeamWeek, events: E.Ev[], sd: number, realised: { actual: Float64Array; played: Uint8Array }, n: number, minGap: number, out: any[]) {
  return (x: RaceInfo) => {
    const c = x.pick; const bj = best(x, c); if (bj < 1) return;
    const gap = x.res.per[bj].m - x.res.per[c].m; if (!(gap > minGap)) return;
    const r = E.rng((sd * 7919 + x.evIdx * 104729) ^ 0x5bd1e995);
    const d = fresh(tw, events, x, c, bj, n, r, realised); const m = d.reduce((s, v) => s + v, 0) / n;
    const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1) / n);
    out.push({ ev: x.evIdx, why: x.cands[bj].why, chosen: x.cands[c].why, gap: r2(gap), m: r2(m), se: r2(se), n });
  };
}
