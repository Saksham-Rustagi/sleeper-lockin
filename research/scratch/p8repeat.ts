// P8 repeatability repro: same team-week + scenarios simulated twice / in different orders must give identical totals.
// usage: npx esbuild research/scratch/p8repeat.ts --bundle --platform=node --format=cjs --outfile=research/dist/p8repeat.cjs && node research/dist/p8repeat.cjs [week] [N]
import * as E from "../engine";
import { S, fitModel, teamWeek } from "../btcommon";
const week = Number(process.argv[2] || 5), N = Number(process.argv[3] || 6);
const model = fitModel(week);
const rids = Object.keys(S.weeks.find((x: any) => x.week === week).teams).slice(0, 2);
const P8: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100 } };
const P8F: E.Policy = { name: "P8f", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "info", iters: 30 } };
const SIM: E.Policy = { ...P8F, index: { ...P8F.index!, slot: "sim", fresh: true } };
const pols = (process.env.POLS || "SIM,P8F,P8").split(",").map((n) => ({ SIM, P8F, P8 } as Record<string, E.Policy>)[n]);
const teams = rids.map((rid) => { const { tw, real } = teamWeek(week, rid, model); const ev = E.buildEvents(tw, true);
  const scen = Array.from({ length: N }, (_, k) => E.sampleScenario(tw, null, -Infinity, E.rng(1000 + k), real)); return { rid, tw, ev, scen }; });
// mid-week start (as the live app at an asOf after some games): state after the real first ~third of the week
const MID = Number(process.argv[4] || 0);
// (computed once per team, like the live app's T.st / T.evIdx: later calls start from it without a prefix simulation)
const mids = new Map<string, { st: E.State; i: number }>();
function start(T: (typeof teams)[number]) {
  if (!MID) return { st: E.initState(T.tw), i: 0 };
  if (mids.has(T.rid)) return mids.get(T.rid)!;
  const st = E.initState(T.tw); const t = T.tw.games[Math.floor(T.tw.games.length * MID)].tip - 1;
  const r = E.simulate(T.tw, P8, T.ev, T.scen[0].actual, T.scen[0].played, st, 0, undefined, t); mids.set(T.rid, { st: r.st, i: r.evIdx }); return mids.get(T.rid)!;
}
const run = (T: (typeof teams)[number], pol: E.Policy, k: number) => { const s = start(T); return E.simulate(T.tw, pol, T.ev, T.scen[k].actual, T.scen[k].played, E.cloneState(s.st), s.i).total; };
for (const pol of pols) {
  const ks = [...Array(N).keys()];
  const A1 = ks.map((k) => run(teams[0], pol, k));
  const B1 = ks.map((k) => run(teams[1], pol, k));
  const A2 = ks.map((k) => run(teams[0], pol, k));
  const Arev = [...ks].reverse().map((k) => run(teams[0], pol, k)).reverse();
  const inter = ks.map((k) => (run(teams[1], pol, k), run(teams[0], pol, k)));
  const diff = (x: number[]) => x.reduce((a, v, i) => a + (v !== A1[i] ? 1 : 0), 0);
  console.log(`${pol.name}${pol.index?.fresh ? "(sim,fresh)" : ""} MID=${MID} A1 ${A1.map((x) => x.toFixed(2)).join(" ")}`);
  console.log(`  differing vs A1: again ${diff(A2)}/${N}, reversed ${diff(Arev)}/${N}, interleaved with B ${diff(inter)}/${N}   (B ${B1[0].toFixed(2)})`);
}
