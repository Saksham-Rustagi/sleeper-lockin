// Approximate policy iteration, step 1: at every real lock decision of the 2025-26 season (base policy played on
// real outcomes), measure the TRUE cut-off by paired simulation: E[total | let go] - E[total | lock at 0].
// usage: node lockdata.cjs <week> <out.json> [N] [coefFileForThisWeek]
import fs from "fs";
import * as E from "./engine";
import { S, fitModel, teamWeek } from "./btcommon";
const [wArg, out, nArg, coefFile] = process.argv.slice(2);
const week = Number(wArg), N = Number(nArg || 300);
const base: E.Policy = { name: "base", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, cutoff: coefFile ? JSON.parse(fs.readFileSync(coefFile, "utf8")).coef : undefined };
const W = S.weeks.find((x: any) => x.week === week); const model = fitModel(week); const rows: any[] = [];
for (const rid of Object.keys(W.teams)) {
  const { tw, real } = teamWeek(week, rid, model); const evs = E.buildEvents(tw, true);
  const recs: { st: E.State; p: number; t: number; evIdx: number; slot: number; f: number[]; X: number }[] = [];
  const hooks: E.Hooks = { decideLock: (st, p, t, evIdx, ev) => {
    if (Number.isFinite(ev.lockBest) && ev.lockSlot >= 0) recs.push({ st: E.cloneState(st), p, t, evIdx, slot: ev.lockSlot, f: E.lockFeatures(tw, base, st, p, t, ev), X: st.pendingX[p] });
    return undefined as any; } };
  E.simulate(tw, base, evs, real.actual, real.played, E.initState(tw), 0, hooks);
  recs.forEach((r, ri) => {
    let sum = 0, sum2 = 0;
    for (let k = 0; k < N; k++) {
      const rng = E.rng((week * 1009 + Number(rid)) * 100003 + ri * 7919 + k);
      const sc = E.sampleScenario(tw, r.st, r.t, rng, real);
      const a = E.cloneState(r.st); a.pendingX[r.p] = NaN;
      const wait = E.simulate(tw, base, evs, sc.actual, sc.played, a, r.evIdx + 1).total;
      const b = E.cloneState(r.st); b.pendingX[r.p] = 0; E.doLock(b, r.p, r.slot);
      const lock0 = E.simulate(tw, base, evs, sc.actual, sc.played, b, r.evIdx + 1).total;
      const d = wait - lock0; sum += d; sum2 += d * d;
    }
    const y = sum / N; rows.push({ week, rid, y, se: Math.sqrt(Math.max(0, sum2 / N - y * y) / N), X: r.X, f: r.f });
  });
}
fs.writeFileSync(out, JSON.stringify(rows));
