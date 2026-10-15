// Fit and validate the human opponent model (lib/engine/human.ts) on the 2025-26 human team-weeks.
// Each real team-week is replayed with the human model on its REAL game outcomes (randomness = only the manager's
// choices), and simulated moments are matched to the managers' real ones (method of simulated moments, Nelder-Mead,
// common random numbers):
//   weekly total: mean, sd; share of starting slots that end the week at 0; for slots whose score matches one of the
//   player's games: share of scores from his first game and from his last game (players with >= 2 games), mean z of the
//   kept score (z = (score - model mean) / model sd of that game).
// usage: node research/dist/humanfit.cjs [fit|eval] [out.json]   env FIT=a-b (weeks fitted, default 1-23), R (reps, 12),
//        PAR=engA,engB,c0,c1,c2,su,tf,pt,kd,sl (eval; or argv[4]); scan: argv[4] = 'p1;p2;...'
import fs from "fs";
import * as E from "../lib/engine/core";
import * as H from "../lib/engine/human";
import { S, fitModel, teamWeek } from "./btcommon";
import { realOppSnapshot } from "./oppreal";

const mode = process.argv[2] || "fit"; const out = process.argv[3];
const [w0, w1] = (process.env.FIT || "1-23").split("-").map(Number); const R = Number(process.env.R || 12);
const quant = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
interface TWD { week: number; rid: string; tw: E.TeamWeek; real: { actual: Float64Array; played: Uint8Array }; human: number; slots: number[]; starters: string[]; pids: string[] }
const data: TWD[] = [];
for (const W of S.weeks) {
  const model = fitModel(W.week);
  for (const rid of Object.keys(W.teams)) {
    const T = W.teams[rid]; const { tw, real } = teamWeek(W.week, rid, model);
    data.push({ week: W.week, rid, tw, real, human: T.human_points, slots: T.human_slot_points, starters: T.starters, pids: T.players });
  }
}
// slot statistics with the data's definition: the counted game is the player's first game whose score equals the slot's
function slotStats(tw: E.TeamWeek, real: { actual: Float64Array; played: Uint8Array }, slot: [number, number][]) {
  let zero = 0, m2 = 0, first = 0, last = 0, zs = 0, nz = 0;
  for (const [p, pts] of slot) {
    if (pts === 0) zero++;
    if (p < 0) continue;
    const gl = tw.byPlayer[p]; const k = gl.findIndex((gi) => Math.abs((real.played[gi] ? real.actual[gi] : 0) - pts) < 1e-6);
    if (k < 0) continue;
    if (gl.length >= 2) { m2++; if (k === 0) first++; if (k === gl.length - 1) last++; }
    if (pts !== 0) { const g = tw.games[gl[k]]; zs += (pts - g.mu) / g.sd; nz++; }
  }
  return { zero, m2, first, last, zs, nz };
}
function moments(tot: number[], acc: { zero: number; m2: number; first: number; last: number; zs: number; nz: number }, nSlots: number) {
  const n = tot.length; const m = tot.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(tot.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return [m, sd, acc.zero / nSlots, acc.first / acc.m2, acc.last / acc.m2, acc.zs / acc.nz, quant(tot, 0.1), quant(tot, 0.9)];
}
const NAMES = ["mean total", "sd total", "zero-slot share", "first-game share (n>=2)", "last-game share (n>=2)", "mean z of kept scores", "10% quantile", "90% quantile"];
const sub = data.filter((d) => d.week >= w0 && d.week <= w1);
function dataMoments(set: TWD[]) {
  const acc = { zero: 0, m2: 0, first: 0, last: 0, zs: 0, nz: 0 }; let nS = 0;
  for (const d of set) {
    const pidx = new Map(d.pids.map((p, i) => [p, i]));
    const st = slotStats(d.tw, d.real, d.starters.map((pid, s) => [pidx.has(pid) ? pidx.get(pid)! : -1, d.slots[s]] as [number, number]));
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += st[k]; nS += d.slots.length;
  }
  return moments(set.map((d) => d.human), acc, nS);
}
// note: teamWeek's players are the matchup's 'players' list in the same order as d.pids
function simMoments(set: TWD[], par: H.HumanParams, reps: number, seed: number, perTw?: number[][]) {
  const acc = { zero: 0, m2: 0, first: 0, last: 0, zs: 0, nz: 0 }; let nS = 0; const tot: number[] = [];
  set.forEach((d, i) => {
    const r = E.rng(seed + i * 7919);
    for (let k = 0; k < reps; k++) {
      const hs = H.initHuman(d.tw, par, r);
      const res = H.simulateHuman(d.tw, par, hs, d.real.actual, d.real.played, r);
      tot.push(res.total); perTw?.[i].push(res.total);
      const sl = H.humanSlots(hs).map(([pts], s) => [hs.occ[s], pts] as [number, number]);
      const st = slotStats(d.tw, d.real, sl);
      for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += st[key]; nS += sl.length;
    }
  });
  return { m: moments(tot, acc, nS), tot };
}
const target = dataMoments(sub);
const SE = [1.5, 76 / Math.sqrt(2 * sub.length), 0.012, 0.02, 0.02, 0.04, 10, 8]; // (the mean is weighted most: it matters most for win probabilities)
const toPar = (x: number[]): H.HumanParams => ({ engA: Math.exp(x[0]), engB: Math.exp(x[1]), c0: x[2], c1: x[3], c2: x[4], su: Math.abs(x[5]), tf: 1 / (1 + Math.exp(-x[6])), pt: 1 / (1 + Math.exp(-x[7])), kd: 1 / (1 + Math.exp(-x[8])), sl: 1 / (1 + Math.exp(-x[9])) });
const parOf = (x: number[]): H.HumanParams => ({ engA: x[0], engB: x[1], c0: x[2], c1: x[3], c2: x[4], su: x[5] ?? 0, tf: x[6] ?? 0, pt: x[7] ?? 0, kd: x[8] ?? 0, sl: x[9] ?? 1 });
const loss = (x: number[]) => { const m = simMoments(sub, toPar(x), R, 12345).m; return m.reduce((a, v, i) => a + ((v - target[i]) / SE[i]) ** 2, 0); };
function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters: number) {
  let P = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    P.sort((a, b) => a.f - b.f); const n = x0.length; const c = x0.map((_, j) => P.slice(0, n).reduce((a, p) => a + p.x[j], 0) / n);
    const w = P[n]; const xr = c.map((v, j) => v + (v - w.x[j])); const fr = f(xr);
    if (fr < P[0].f) { const xe = c.map((v, j) => v + 2 * (v - w.x[j])); const fe = f(xe); P[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr }; }
    else if (fr < P[n - 1].f) P[n] = { x: xr, f: fr };
    else { const xc = c.map((v, j) => v + 0.5 * (w.x[j] - v)); const fc = f(xc); if (fc < w.f) P[n] = { x: xc, f: fc }; else P = P.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => P[0].x[j] + 0.5 * (v - P[0].x[j])), f: f(p.x.map((v, j) => P[0].x[j] + 0.5 * (v - P[0].x[j]))) })); }
    if (it % 20 === 0) console.error(`it ${it} best ${P[0].f.toFixed(3)} x ${P[0].x.map((v) => v.toFixed(3)).join(",")}`);
  }
  P.sort((a, b) => a.f - b.f); return P[0];
}
function report(par: H.HumanParams, set: TWD[], label: string) {
  const perTw = set.map(() => [] as number[]);
  const sim = simMoments(set, par, 40, 999, perTw); const dm = dataMoments(set);
  const qs = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
  const means = perTw.map((v) => v.reduce((a, b) => a + b, 0) / v.length); const hum = set.map((d) => d.human);
  const mx = means.reduce((a, b) => a + b, 0) / means.length, my = hum.reduce((a, b) => a + b, 0) / hum.length;
  let sxy = 0, sxx = 0, syy = 0; means.forEach((x, i) => { sxy += (x - mx) * (hum[i] - my); sxx += (x - mx) ** 2; syy += (hum[i] - my) ** 2; });
  // PIT of the real total within its own team-week's simulated distribution (calibration: uniform if the model is right)
  const pit = set.map((d, i) => perTw[i].filter((x) => x < d.human).length / perTw[i].length + 0.5 * perTw[i].filter((x) => x === d.human).length / perTw[i].length);
  const pitHist = [0, 0, 0, 0, 0]; for (const u of pit) pitHist[Math.min(4, Math.floor(u * 5))]++;
  return { label, n: set.length, moments: NAMES.map((nm, i) => ({ nm, data: dm[i], sim: sim.m[i] })), quantiles: qs.map((q) => ({ q, data: quant(hum, q), sim: quant(sim.tot, q) })),
    corr: sxy / Math.sqrt(sxx * syy), pitHist, pitMean: pit.reduce((a, b) => a + b, 0) / pit.length };
}
if (mode === "fit") {
  const x0 = (process.env.X0 || "").split(",").filter(Boolean).map(Number);
  const best = nelderMead(loss, x0.length === 10 ? x0 : [0.243, -0.785, -2.67, 4.79, 2.10, 0.30, 3.25, 4.6, -5.6, -3.3], [0.5, 0.5, 0.8, 0.6, 0.6, 0.8, 1.5, 1.5, 1.5, 1.5], Number(process.env.ITERS || 300));
  const par = toPar(best.x);
  const rep = { fitWeeks: [w0, w1], par, loss: best.f, target, fitted: simMoments(sub, par, R, 12345).m, fitSet: report(par, sub, `weeks ${w0}-${w1}`),
    other: sub.length < data.length ? report(par, data.filter((d) => d.week < w0 || d.week > w1), "other weeks (out of sample)") : null, all: report(par, data, "all 230") };
  console.log(JSON.stringify(rep, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1));
} else if (mode === "calib") {
  // PIT of the real final total under the opponent distribution from the real-data snapshot at the start of every game
  // day (research/oppreal.ts), raw and with the residual N(delta, sigma^2 * rho) on a grid; pick the residual that
  // makes the PITs uniform (chi-square of PIT quintiles, summed over groups by game days left)
  const M = Number(process.env.M || 200); const rows: { dl: number; rho: number; s: Float64Array; y: number; t: number }[] = [];
  data.forEach((d, i) => {
    const r = E.rng(777 + i); const hw = H.humanWeek(d.tw);
    hw.moments.forEach((m) => {
      if (!m.first) return;
      const snap = realOppSnapshot(d.tw, d.real, { pids: d.pids, starters: d.starters, pts: d.slots }, m.t);
      const s = H.oppSamples(d.tw, H.HUMAN, snap.hs, snap.fromEv, m.t, d.real, M, r, { delta: 0, sigma: 0 });
      rows.push({ dl: hw.nDays - m.d, rho: H.remainingShare(d.tw, m.t), s, y: d.human, t: m.t });
    });
  });
  const pitOf = (row: (typeof rows)[0], de: number, sg: number) => { const sd = Math.sqrt(sg * sg * row.rho + 4); let f = 0; for (const x of row.s) f += E.normCdf((row.y - x - (row.rho > 0 ? de : 0)) / sd); return f / row.s.length; };
  const groupOf = (dl: number) => (dl >= 7 ? "7+" : String(dl));
  const evalGrid = (de: number, sg: number) => {
    const g = new Map<string, number[]>(); for (const row of rows) { const k = groupOf(row.dl); if (!g.has(k)) g.set(k, [0, 0, 0, 0, 0]); g.get(k)![Math.min(4, Math.floor(pitOf(row, de, sg) * 5))]++; }
    let chi = 0; for (const h of g.values()) { const n = h.reduce((a, b) => a + b, 0); for (const c of h) chi += (c - n / 5) ** 2 / (n / 5); }
    return { chi, g };
  };
  let best = { de: 0, sg: 0, chi: Infinity };
  for (let de = -14; de <= 10; de += 1) for (let sg = 0; sg <= 70; sg += 5) { const e = evalGrid(de, sg); if (e.chi < best.chi) best = { de, sg, chi: e.chi }; }
  const show = (de: number, sg: number) => { const e = evalGrid(de, sg); const out: any = { delta: de, sigma: sg, chi: e.chi, byDaysLeft: {} };
    for (const [k, h] of [...e.g.entries()].sort()) { const rs = rows.filter((x) => groupOf(x.dl) === k); const mean = rs.reduce((a, x) => a + x.s.reduce((p, q) => p + q, 0) / x.s.length + (x.rho > 0 ? de : 0), 0) / rs.length; const y = rs.reduce((a, x) => a + x.y, 0) / rs.length;
      out.byDaysLeft[k] = { n: rs.length, pitQuintiles: h, predMean: Math.round(mean * 10) / 10, realMean: Math.round(y * 10) / 10, rho: Math.round(rs.reduce((a, x) => a + x.rho, 0) / rs.length * 100) / 100 }; }
    return out; };
  const rep = { M, rows: rows.length, raw: show(0, 0), best: show(best.de, best.sg) };
  console.log(JSON.stringify(rep, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1));
} else if (mode === "scan") { // scan "a,b,c0,c1,c2;a,b,..." (argv[4]): moments on all weeks
  for (const ps of (process.argv[4] || "").split(";")) {
    const par = parOf(ps.split(",").map(Number));
    const r = report(par, data, ps);
    console.log(`${ps}  loss ${dataMoments(data).reduce((a, v, i) => a + ((r.moments[i].sim - v) / SE[i]) ** 2, 0).toFixed(1)}  ${r.moments.map((m) => m.sim.toFixed(3)).join(" ")}  q ${r.quantiles.map((q) => Math.round(q.sim)).join(",")}  pit ${r.pitHist.join(",")}`);
  }
  console.log(`data: ${dataMoments(data).map((v) => v.toFixed(3)).join(" ")}  q ${[0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95].map((q) => Math.round(quant(data.map((d) => d.human), q))).join(",")}`);
} else {
  const x = (process.env.PAR || process.argv[4] || "").split(",").filter(Boolean).map(Number); const par = x.length >= 5 ? parOf(x) : H.HUMAN;
  const rep = { par, all: report(par, data, "all 230"), h1: report(par, data.filter((d) => d.week <= 11), "weeks 1-11"), h2: report(par, data.filter((d) => d.week >= 12), "weeks 12-23") };
  console.log(JSON.stringify(rep, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1));
}
