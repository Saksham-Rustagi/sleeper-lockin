// Micro-benchmarks for task C (single process): the Lagrangian price solve and the rule's simulated week.
// usage: node research/dist/perfbench.cjs solve <iters> <week:rid,...>   -> µs per bound evaluation, bound bits
//        node research/dist/perfbench.cjs sim <policy> <nsc> <week:rid,...> -> µs per simulated week, totals hash
import * as E from "./engine";
import * as L from "../lib/engine/lagrange";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";

const [mode, a1, a2, a3] = process.argv.slice(2);
const hash = (xs: Float64Array) => { let h = 0x811c9dc5; for (const b of new Uint8Array(xs.buffer)) h = Math.imul(h ^ b, 16777619) >>> 0; return h.toString(16); };
const tws = (s: string) => s.split(",").map((x) => { const [w, r] = x.split(":"); return teamWeek(Number(w), r, fitModel(Number(w))); });
if (mode === "export" || mode === "adam") {
  // export: write the week-start bound instance of a team-week as plain numbers for the native kernel
  //         (research/kernel/bound.c); adam: run the same minimisation in TS and print bound + µs per evaluation
  // usage: export <week:rid> <out.txt> | adam <week:rid> <iters>
  const { tw } = tws(a1)[0]; const inst = L.fromTeamWeek(tw); const P = L.prepare(inst);
  if (mode === "export") {
    const o: (number | string)[] = [P.nS, P.nP, P.B, P.masks.length];
    for (const el of P.eligOfMask) o.push(el.length, ...el);
    o.push(...P.maskOf, ...inst.lastPlayed0.map((x) => (x ? 1 : 0)), inst.dnp.p1, inst.dnp.p0, inst.games.length);
    inst.games.forEach((g, i) => { if (g.dist.kind !== "normal") throw new Error("normal dists only"); o.push(g.p, P.gA[i], P.gE[i], g.dist.mu, g.dist.sd, g.dist.floor, g.pPlay ?? -1); });
    for (const l of P.gl) o.push(l.length, ...l);
    require("fs").writeFileSync(a2, o.map(String).join(" ") + "\n");
    console.log(JSON.stringify({ wrote: a2, nS: P.nS, nP: P.nP, B: P.B, nM: P.masks.length, games: inst.games.length }));
  } else {
    const iters = Number(a2); const t0 = performance.now();
    const r = L.minimizeBound(inst, { method: "adam", lr: 0.3, iters }); const ms = performance.now() - t0;
    console.log(JSON.stringify({ mode, iters, bound: r.bound, usPerEval: (ms * 1000) / (r.iters + 1), ms }));
  }
} else if (mode === "solve") {
  const iters = Number(a1); const list = tws(a2); const out = new Float64Array(list.length); let evals = 0; let ms = 0;
  list.forEach(({ tw }, i) => {
    const inst = L.fromTeamWeek(tw); const t0 = performance.now();
    const r = L.tightBound(inst, iters); ms += performance.now() - t0; evals += r.iters + 2; out[i] = r.bound;
  });
  console.log(JSON.stringify({ mode, iters, n: list.length, usPerEval: (ms * 1000) / evals, ms, hash: hash(out), bound0: out[0] }));
} else {
  const pn = a1, nsc = Number(a2); const list = tws(a3); const tot: number[] = []; let ms = 0;
  list.forEach(({ tw }, i) => {
    const sc = PL.scenarios(tw, nsc, 1000 + i); const t0 = performance.now();
    sc.forEach((s, k) => { const ru = PL.runner(pn, tw, 7919 * (k + 1), s); tot.push(E.simulate(tw, ru.pol, ru.events, s.actual, s.played, E.initState(tw), 0, ru.hooks).total); });
    ms += performance.now() - t0;
  });
  console.log(JSON.stringify({ mode, pn, n: tot.length, usPerWeek: (ms * 1000) / tot.length, ms, hash: hash(Float64Array.from(tot)) }));
}
