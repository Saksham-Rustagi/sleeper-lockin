// Optimality gap per team-week (ENGINE_V2 Phase 1.2): Lagrangian upper bound on the optimal expected score under the
// walk-forward model vs the simulated expected value of P2LA / P2LAH / P7H under the SAME model (common random numbers),
// and the expected perfect-hindsight value (another valid upper bound, used as a sanity ceiling).
// usage: node research/dist/gap.cjs <week> <rid> <out.json>      env: N (2000) scenarios for P2LA/P2LAH/hindsight,
//        N7 (12) of them (the first ones) also for P7H, run through the invariant checker; ITERS (200000) per Adam stage
import fs from "fs";
import * as E from "./engine";
import * as L from "../lib/engine/lagrange";
import { S, fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";
import { runChecked, newReport, mergeReport } from "./invariants";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const N = Number(process.env.N || 2000), N7 = Number(process.env.N7 || 12), ITERS = Number(process.env.ITERS || 200000);
const { tw, real } = teamWeek(week, rid, fitModel(week));
const seed = week * 1000 + Number(rid); const t0 = Date.now();
const row: any = { week, rid, games: tw.games.length, players: tw.byPlayer.filter((l) => l.length).length };

const b = L.tightBound(L.fromTeamWeek(tw), ITERS);
row.bound = b.bound; row.free = b.free; row.B = b.P.B; row.boundMs = Date.now() - t0;
row.relaxedReward = b.at.reward; // expected points the relaxed (priced) players collect at the optimum

const sc = PL.scenarios(tw, N, seed * 13 + 7);
const runP2 = (name: string) => { const ru = PL.runner(name, tw, seed, real); return sc.map((s) => E.simulate(tw, ru.pol, ru.events, s.actual, s.played).total); };
row.P2LA = runP2("P2LA"); row.P2LAH = runP2("P2LAH");
row.HS = sc.map((s) => L.hindsightValue(tw.slots, tw.pmask, tw.byPlayer, s.actual, s.played, E.assignExact));
const rep = newReport(); row.P7H = [];
for (let k = 0; k < N7; k++) {
  const s = sc[k]; const ru = PL.runner("P7H", tw, seed + 7919 * (k + 1), s);
  const r = runChecked(tw, ru.pol, ru.events, s.actual, s.played, ru.hooks, { label: `w${week} r${rid} P7H sim${k}`, maxEx: 2 });
  row.P7H.push(r.total); mergeReport(rep, r.rep, 6);
}
row.P7H_rep = rep; row.ms = Date.now() - t0;
const r1 = (a: number[]) => a.map((x) => Math.round(x * 10) / 10);
row.P2LA = r1(row.P2LA); row.P2LAH = r1(row.P2LAH); row.HS = r1(row.HS);
fs.writeFileSync(out, JSON.stringify(row));
process.stderr.write(`w${week} r${rid} bound ${b.bound.toFixed(1)} P2LAH ${(row.P2LAH.reduce((a: number, x: number) => a + x, 0) / N).toFixed(1)} ${row.ms}ms\n`);
