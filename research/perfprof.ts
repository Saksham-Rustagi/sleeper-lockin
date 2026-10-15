// Profiling / timing driver (task C): one policy on one team-week, real outcomes (optionally only the first `days` days
// of the week) and/or `nsc` model scenarios. Prints the totals (full precision) and the wall time.
// usage: node [--cpu-prof] research/dist/perfprof.cjs <week> <rid> <policy> [nsc=0] [days=all] [real=1]
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";

const [week, rid, pn] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const nsc = Number(process.argv[5] || 0), days = Number(process.argv[6] || 0), doReal = (process.argv[7] ?? "1") !== "0";
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const t0w = Math.min(...tw.games.map((g) => g.tip)); const toTime = days ? E.dayEnd(t0w) + (days - 1) * 86400e3 : Infinity;
const out: any = { week, rid, pn };
let t = performance.now();
if (doReal) {
  const ru = PL.runner(pn, tw, seed, real);
  out.real = E.simulate(tw, ru.pol, ru.events, real.actual, real.played, E.initState(tw), 0, ru.hooks, toTime).total;
  out.msReal = performance.now() - t;
}
if (nsc) {
  const sc = PL.scenarios(tw, nsc, seed * 17 + 3); t = performance.now();
  const tot = Float64Array.from(sc, (s, k) => { const r2 = PL.runner(pn, tw, seed + 7919 * (k + 1), s); return E.simulate(tw, r2.pol, r2.events, s.actual, s.played, E.initState(tw), 0, r2.hooks).total; });
  out.msWeek = (performance.now() - t) / nsc;
  // FNV-1a over the totals' bytes: equal hashes = bit-identical totals
  let h = 0x811c9dc5; for (const b of new Uint8Array(tot.buffer)) h = Math.imul(h ^ b, 16777619) >>> 0;
  out.scHash = h.toString(16); out.scMean = tot.reduce((a, b) => a + b, 0) / nsc;
}
console.log(JSON.stringify(out));
