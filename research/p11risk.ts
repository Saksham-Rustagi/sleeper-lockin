// ENGINE_V2 Phase 5, validation c: monotone risk response. At a real 2025-26 decision state (our team played by P10 on
// the real outcomes up to the first tip-off of the third-last game day), P11 (beta 300) decides that tip-off against
// opponents placed at a range of margins: his final ~ our projected final (P8's decision, pilot) - margin, spread 25 pts.
// Recorded per margin: the risk dial gamma, whether P8's decision was replaced, and the risk taken: sd of our final under
// the chosen decision minus under P8's (96 common scenarios, continuations by the untilted base), plus the change in our
// expected points and in win probability.
// usage: node research/dist/p11risk.cjs <week> <rid> <out.json>   (env MARGINS, default -150,-50,-20,0,20,50,150)
import fs from "fs";
import * as E from "../lib/engine/core";
import * as H from "../lib/engine/human";
import { indexContext, seedPrices, applyIndexDecision, savePrices, restorePrices } from "../lib/engine/p8";
import { p10Hooks } from "../lib/engine/p10";
import { p11Hooks, phaseStart } from "../lib/engine/p11";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const margins = (process.env.MARGINS || "-150,-50,-20,0,20,50,150").split(",").map(Number);
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const top = PL.P11_TOP, base = PL.p11Base(false); const events = E.buildEvents(tw, true);
const tB = phaseStart(tw, { beta: 300 });
const st = E.initState(tw);
E.simulate(tw, top, events, real.actual, real.played, st, 0, p10Hooks(tw, base, events, seed, real), tB - 0.5);
const evIdx = events.findIndex((e) => e.kind === 2 && e.t === tB); const e = events[evIdx];
const ctx = indexContext(tw, top, st, e);
const row: any = { week, rid, tB, res: [] };
if (ctx) {
  const saved = savePrices(tw, "top");
  const evalD = (d: any, K: number, rs: number) => { // our finals under decision d (common scenarios by seed rs)
    const r = E.rng(rs); const x = new Float64Array(K);
    for (let k = 0; k < K; k++) { const sc = E.sampleScenario(tw, st, tB, r, real); const s2 = E.cloneState(st); applyIndexDecision(tw, s2, e, d); seedPrices(tw, "roll"); x[k] = E.simulate(tw, base, events, sc.actual, sc.played, s2, evIdx + 1).total; }
    return x;
  };
  const p0 = evalD(ctx.best, 64, seed * 7 + 1); const mu = p0.reduce((a, b) => a + b, 0) / p0.length;
  const ms = (x: Float64Array) => { const m = x.reduce((a, b) => a + b, 0) / x.length; return [m, Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1))]; };
  const base96 = evalD(ctx.best, 96, seed * 7 + 2); const [m0, s0] = ms(base96);
  for (const m of margins) {
    restorePrices(tw, saved, "top");
    const r0 = E.rng(seed * 13 + 5); const D = H.oppDist(Array.from({ length: 400 }, () => mu - m + 25 * Math.sqrt(-2 * Math.log(r0() || 1e-12)) * Math.cos(2 * Math.PI * r0())));
    const hk = p11Hooks(tw, top, base, events, seed, real, { dist: () => D }, { beta: 300, sched: "const" });
    const c2 = indexContext(tw, top, st, e)!;
    const d = hk.decideIndex!(st, tB, evIdx, c2);
    const log = hk.stats.win.log[hk.stats.win.log.length - 1];
    const x = d ? evalD(d, 96, seed * 7 + 2) : base96; const [m1, s1] = ms(x);
    const pw = (v: Float64Array) => v.reduce((a, b) => a + D.F(b), 0) / v.length;
    row.res.push({ margin: m, gamma: log?.[7] ?? 0, pwin: log?.[6] ?? null, changed: d ? 1 : 0, why: d ? hk.stats.why : null, dSd: s1 - s0, dMean: m1 - m0, dWin: pw(x) - pw(base96) });
  }
}
fs.writeFileSync(out, JSON.stringify(row));
