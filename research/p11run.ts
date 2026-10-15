// ENGINE_V2 Phase 5 validation runs, one team-week per process (research/runtasks.mjs).
// usage: node research/dist/p11run.cjs <week> <rid> <out.json> [real|sim]
//  real (validation a): 2025-26, our team plays every policy in env POLS (';'-separated, e.g. "P10;P11:beta=300") on the
//       REAL outcomes through the invariant checker; the opponent is the real human: P11 sees what the data proves he
//       had at t (research/oppreal.ts) and simulates his rest of the week with the human model; every final total is
//       compared with his ACTUAL final score.
//  sim  (validation b): NS model weeks per team-week (env SEASON picks the season file): our games and the opponent's
//       drawn from the model, the opponent played by the human model (lib/engine/human.ts; his traits drawn per week);
//       P11 sees his exact state at t (as the live app does) and simulates him with the same model. All arms share the
//       identical early week: it is played once (P10's decisions, which every arm makes while beta = 0) up to the first
//       moment any arm's beta > 0, then each arm continues from that state (same random streams and prices as a run from
//       scratch; env CHECKBRANCH=1 verifies this against from-scratch runs). Arms must share one base (P10 + P11:...,
//       or P10b + P11b:...).
// env: M (opponent simulations per distribution, default 400), NS (sim weeks per team-week, 1), S0 (first sim index, 0),
//      KC (completions of close weeks, 1), CLOSE (lo,hi of P10's win probability at the branch, 0.02,0.98), MR (400)
import fs from "fs";
import * as E from "../lib/engine/core";
import * as H from "../lib/engine/human";
import { p10Hooks, newStats } from "../lib/engine/p10";
import { p11Hooks, phaseStart, type P11Opts, type OppSource } from "../lib/engine/p11";
import { savePrices, restorePrices, seedPrices } from "../lib/engine/p8";
import { S, fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { runChecked } from "./invariants";
import { realOppSnapshot, realOppLocked } from "./oppreal";

const [week, rid, out, mode = "real"] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]];
const pols = (process.env.POLS || "P10;P11:beta=300").split(";"); const M = Number(process.env.M || 400);
const W = S.weeks.find((x: any) => x.week === week); const model = fitModel(week);
const pair = (W.matchups as number[][]).find((m) => m.map(String).includes(rid))!; const orid = String(pair.find((x) => String(x) !== rid));
const { tw, real } = teamWeek(week, rid, model); const seed = week * 1000 + Number(rid);
const { tw: otw, real: oreal } = teamWeek(week, orid, model);
const T = W.teams[orid];
const summ = (st: any) => st ? { decisions: st.decisions, raced: st.raced, switched: st.switched, why: st.why, sims: st.sims, ms: Math.round(st.ms), win: st.win ? { ...st.win, log: st.win.log } : undefined } : undefined;
const winOf = (a: number, b: number) => (a > b ? 1 : a === b ? 0.5 : 0);

if (mode === "real") {
  const rs = { pids: T.players as string[], starters: T.starters as string[], pts: T.human_slot_points as number[] };
  const memo = new Map<number, H.OppDist>();
  const opp: OppSource = { dist: (t) => {
    const snap = realOppSnapshot(otw, oreal, rs, t);
    let D = memo.get(snap.fromEv);
    if (!D) { D = H.oppDist(H.oppSamples(otw, H.HUMAN, snap.hs, snap.fromEv, t, oreal, M, E.rng(seed * 7919 + snap.fromEv))); memo.set(snap.fromEv, D); }
    return D;
  } };
  const row: any = { week, rid, orid, oppActual: T.human_points, pols: {} };
  for (const pn of pols) {
    const t0 = performance.now(); const ru = PL.runner(pn, tw, seed, real, opp);
    const r = runChecked(tw, ru.pol, ru.events, real.actual, real.played, ru.hooks, { label: `w${week} r${rid} ${pn} real` });
    row.pols[pn] = { total: r.total, recount: r.trackerTotal, win: winOf(r.total, T.human_points), viol: Object.entries(r.rep.counts ?? {}).filter(([k]) => k.startsWith("L_")).reduce((a, [, v]) => a + (v as number), 0),
      rep: r.rep, ms: performance.now() - t0, stats: summ((ru.hooks as any)?.stats) };
  }
  // the opponent model's view along the week (calibration): at each of our tip-offs, his visible locks and F_opp(actual)
  row.calib = [...new Set(tw.games.map((g) => g.tip))].sort((a, b) => a - b).map((t) => { const D = opp.dist(t)!; return [t, realOppLocked(otw, oreal, rs, t), Math.round(D.mean * 10) / 10, Math.round(D.sd * 10) / 10, Math.round(D.F(T.human_points) * 1000) / 1000]; });
  fs.writeFileSync(out, JSON.stringify(row));
} else {
  // KC late-week completions for "close" model weeks (P10's win probability at the branch moment within CLOSE): the
  // outcomes after the branch (ours and the opponent's, his decisions included; his traits kept) are redrawn and every
  // arm continues from the same branch state. The choice of K uses only what is known at the branch, so the mean over a
  // week's completions is an unbiased estimate of its arms' outcomes. Win is reported twice: binary against his final,
  // and Rao-Blackwellized: P(his final < ours | his state at our last tip-off, his true traits), MR simulations.
  const NS = Number(process.env.NS || 1), S0 = Number(process.env.S0 || 0), KC = Number(process.env.KC || 1), MR = Number(process.env.MR || 400);
  const [cLo, cHi] = (process.env.CLOSE || "0.02,0.98").split(",").map(Number);
  const b8 = pols.some((p) => /^P1[01]b/.test(p)); if (pols.some((p) => /^P1[01]b/.test(p) !== b8)) throw new Error("arms must share one base");
  const base = PL.p11Base(b8); const top = PL.P11_TOP; const events = E.buildEvents(tw, true);
  const opts = pols.map((p) => (/^P11/.test(p) ? PL.optsOf(p.match(/^P11b?:(.*)$/)?.[1] ?? "") as P11Opts : null));
  const tB = Math.min(...opts.map((o) => (o ? phaseStart(tw, o) : Infinity)));
  const tLast = Math.max(...tw.games.map((g) => g.tip)); const nEv = H.humanWeek(otw).ev.length;
  const rows: any[] = [];
  type Sc = { actual: Float64Array; played: Uint8Array };
  // the opponent's world from event k0 on (state saved before every event), on his scenario
  const worldFrom = (snaps: H.HState[], k0: number, hs0: H.HState, osc: Sc, rw: () => number) => {
    const hs = H.cloneH(hs0); const out = snaps.slice(0, k0);
    for (let k = k0; k < nEv; k++) { out.push(H.cloneH(hs)); H.simulateHuman(otw, H.HUMAN, hs, osc.actual, osc.played, rw, k, Infinity, k + 1); }
    return { snaps: out, fin: hs };
  };
  const oppOf = (snaps: H.HState[], fin: H.HState, osc: Sc, sd: number): OppSource => {
    const memo = new Map<number, H.OppDist>();
    return { dist: (t) => {
      const k = H.firstEvAfter(otw, t); let D = memo.get(k);
      if (!D) { D = H.oppDist(H.oppSamples(otw, H.HUMAN, k < nEv ? snaps[k] : fin, k, t, osc, M, E.rng(sd * 7919 + k), { delta: 0, sigma: 0 })); memo.set(k, D); }
      return D;
    } };
  };
  for (let j = S0; j < S0 + NS; j++) {
    const sseed = seed * 101 + j; const rw = E.rng(sseed * 31 + 7);
    const z = { actual: new Float64Array(tw.games.length), played: new Uint8Array(tw.games.length) };
    const scen = E.sampleScenario(tw, null, -Infinity, rw, z);
    const oz = { actual: new Float64Array(otw.games.length), played: new Uint8Array(otw.games.length) };
    const oscen = E.sampleScenario(otw, null, -Infinity, rw, oz);
    const w0 = worldFrom([], 0, H.initHuman(otw, H.HUMAN, rw), oscen, rw);
    const sd0 = sseed; // our policies' seed in this model week
    const mk = (i: number, r: () => number, sc: Sc, opp: OppSource) =>
      opts[i] ? p11Hooks(tw, top, base, events, sd0, sc, opp, opts[i]!, r) : p10Hooks(tw, base, events, sd0, sc, {}, newStats(), { r });
    const row: any = { week, rid, orid, j, tB: Number.isFinite(tB) ? tB : null, comps: [] };
    // shared prefix (every arm = P10 while beta = 0)
    const t0 = performance.now();
    const rr = E.rngS(sd0 ^ 0x3c6ef372); const opp0 = oppOf(w0.snaps, w0.fin, oscen, sseed);
    const i0 = Math.max(0, pols.findIndex((p) => /^P10/.test(p)));
    const pre = E.simulate(tw, top, events, scen.actual, scen.played, E.initState(tw), 0, mk(i0, rr, scen, opp0), Number.isFinite(tB) ? tB - 0.5 : Infinity);
    const saved = { st: E.cloneState(pre.st), evIdx: pre.evIdx, rs: rr.state, prices: savePrices(tw, "top") };
    row.msPrefix = performance.now() - t0;
    // P10's win probability at the branch (its rule's continuations against the opponent's distribution there)
    let pB: number | null = null;
    if (Number.isFinite(tB) && saved.evIdx < events.length) {
      const D = opp0.dist(tB)!; const rp = E.rng(sseed * 17 + 3); let w = 0; const KP = 48;
      const pilotPol: E.Policy = { ...base, index: { ...base.index!, slot: "pilot" } };
      for (let k = 0; k < KP; k++) {
        const sc = E.sampleScenario(tw, saved.st, tB, rp, scen); seedPrices(tw, "pilot", "top");
        w += D.F(E.simulate(tw, pilotPol, events, sc.actual, sc.played, E.cloneState(saved.st), saved.evIdx).total);
      }
      pB = w / KP;
    }
    row.pB = pB; const K = pB !== null && pB > cLo && pB < cHi ? KC : 1; row.K = K;
    for (let c = 0; c < K; c++) {
      // completion c (0: the drawn week itself)
      let sc: Sc = scen, osc: Sc = oscen, wd = w0;
      if (c > 0) {
        const rc = E.rng(sseed * 131 + c);
        sc = E.sampleScenario(tw, saved.st, tB, rc, scen); osc = E.sampleScenario(otw, null, tB, rc, oscen);
        const kB = H.firstEvAfter(otw, tB); wd = worldFrom(w0.snaps, kB, kB < nEv ? w0.snaps[kB] : w0.fin, osc, rc);
      }
      const oppFinal = H.humanTotal(wd.fin); const opp = oppOf(wd.snaps, wd.fin, osc, sseed * 1009 + c);
      // P(his final < x | his state at our last tip-off, true traits)
      const kL = H.firstEvAfter(otw, tLast);
      const OL = H.oppSamples(otw, H.HUMAN, kL < nEv ? wd.snaps[kL] : wd.fin, kL, tLast, osc, MR, E.rng(sseed * 7 + c), { delta: 0, sigma: 0 }, true);
      const smooth = (x: number) => { let f = 0; for (const o of OL) f += o < x ? 1 : o === x ? 0.5 : 0; return f / OL.length; };
      const comp: any = { c, oppFinal, pols: {} };
      pols.forEach((pn, i) => {
        const t1 = performance.now(); const r = E.rngS(0); r.state = saved.rs; restorePrices(tw, saved.prices, "top");
        const hk = mk(i, r, sc, opp);
        const res = E.simulate(tw, top, events, sc.actual, sc.played, E.cloneState(saved.st), saved.evIdx, saved.evIdx < events.length ? hk : undefined);
        comp.pols[pn] = { total: res.total, win: winOf(res.total, oppFinal), smooth: smooth(res.total), ms: performance.now() - t1, stats: summ((hk as any).stats) };
        if (process.env.CHECKBRANCH && c === 0) { // the same arm from scratch, through the invariant checker
          const r2 = E.rngS(sd0 ^ 0x3c6ef372); const hk2 = mk(i, r2, sc, opp);
          const ch = runChecked(tw, top, events, sc.actual, sc.played, hk2, { label: `w${week} r${rid} ${pn} sim${j}` });
          comp.pols[pn].scratch = ch.total; comp.pols[pn].viol = Object.entries(ch.rep.counts ?? {}).filter(([k]) => k.startsWith("L_")).reduce((a, [, v]) => a + (v as number), 0);
        }
      });
      row.comps.push(comp);
    }
    rows.push(row);
  }
  fs.writeFileSync(out, JSON.stringify({ week, rid, orid, rows }));
}
