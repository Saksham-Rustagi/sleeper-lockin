// Task W: cold Waivers-refresh compute on this Mac for each valuation, the page's search on one real team-week
// (week start = the most work: both weeks fully ahead). POLICY: as the live code runs it (one thread; workers only
// split scenarios when N >= 4000). P8f: roster variants spread over worker threads (each variant needs its own
// week-start price solve, so splitting scenarios would repeat the solve in every worker).
// usage: node research/dist/w_latency.cjs <week> <rid> [workers=12]   (SEASON / WALL env as in waivers_bt)
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import * as E from "./engine";
import * as W from "./wcommon";
import { POLICY } from "../lib/live/week";
import { P8F_POLICY } from "../lib/live/engine";

const SIMP8F: E.Policy = { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "sim", fresh: true } };
type Task = { pids: string[]; week: number; pol: "policy" | "p8f"; N: number; model: W.Model; T: number };
function evalTask(t: Task) { const { tw } = W.teamWeekFor(t.pids, t.week, t.model, t.T); return W.simValues(tw, t.pids, t.pol === "p8f" ? SIMP8F : POLICY, t.N, t.week * 7919); }

if (!isMainThread) {
  parentPort!.on("message", (m: { id: number; t: Task }) => { const v = evalTask(m.t); parentPort!.postMessage({ id: m.id, v }); });
} else {
  const [w, rid, nw] = [Number(process.argv[2]), process.argv[3], Number(process.argv[4] || 12)];
  const Wk = W.S.weeks.find((x: any) => x.week === w); const roster: string[] = Wk.teams[rid].players;
  const model = W.fitModel(w); const T = W.weekStart(w); const weeks = [w, w + 1];
  const rostered = new Set<string>(W.A.rostered[String(w)][W.A.leagueOf[rid]]);
  const pk = (p: string) => (W.lastPlayed(p, T) ? model.dnp.p1 : model.dnp.p0);
  const fas = [...new Set(W.all.filter((g) => weeks.includes(g.week)).map((g) => g.pid))].filter((p) => !rostered.has(p) && /^\d+$/.test(p));
  const v2 = (p: string) => weeks.flatMap((x) => W.gamesOf(p, x)).reduce((s, g) => s + pk(p) * Math.max(0, model.a + model.b * g.pre!), 0);
  const pool = fas.map((p) => [p, v2(p)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p]) => p);
  const workers = Array.from({ length: nw }, () => new Worker(__filename)); let id = 0; const wait = new Map<number, (v: Float64Array) => void>();
  workers.forEach((wk) => wk.on("message", (m: { id: number; v: Float64Array }) => { wait.get(m.id)!(m.v); wait.delete(m.id); }));
  let rr = 0; const run = (t: Task) => new Promise<Float64Array>((res) => { const i = ++id; wait.set(i, res); workers[rr++ % nw].postMessage({ id: i, t }); });
  const variant = (e: { add?: string; drop?: string }) => roster.filter((p) => p !== e.drop).concat(e.add ? [e.add] : []);
  const mean = (a: Float64Array[], b: Float64Array[]) => { let s = 0; for (let j = 0; j < a.length; j++) for (let k = 0; k < a[j].length; k++) s += a[j][k] - b[j][k]; return s / a[0].length; };
  (async () => { for (const [pol, N, par] of [["policy", 300, false], ["policy", 2000, false], ["p8f", 400, true]] as ["policy" | "p8f", number, boolean][]) {
    const t0 = Date.now();
    const evalAll = async (edits: { add?: string; drop?: string }[]) => {
      const ts = edits.flatMap((e) => weeks.map((x) => ({ pids: variant(e), week: x, pol, N, model, T })));
      const vs = par ? await Promise.all(ts.map(run)) : ts.map(evalTask);
      return edits.map((_, i) => weeks.map((__, j) => vs[i * weeks.length + j]));
    };
    // phase 1: base, every drop, every add (independent); phase 2: top 6 adds x 3 cheapest drops
    const p1 = [{}, ...roster.map((p) => ({ drop: p })), ...pool.map((p) => ({ add: p }))];
    const r1 = await evalAll(p1); const base = r1[0];
    const drops = roster.map((p, i) => ({ p, loss: -mean(r1[1 + i], base) })).filter((d) => !W.isProtected(d.p, w)).sort((a, b) => a.loss - b.loss).slice(0, 3);
    const adds = pool.map((p, i) => ({ p, g: mean(r1[1 + roster.length + i], base) })).sort((a, b) => b.g - a.g).slice(0, 6);
    const r2 = await evalAll(adds.flatMap((a) => drops.map((d) => ({ add: a.p, drop: d.p }))));
    const best = Math.max(...r2.map((x) => mean(x, base)));
    console.log(`${pol} N=${N} ${par ? `variants on ${nw} workers` : "one thread"}: ${(p1.length + r2.length)} variants x ${weeks.length} weeks, ${((Date.now() - t0) / 1000).toFixed(1)} s (best move ${best.toFixed(1)})`);
  }
  workers.forEach((wk) => wk.terminate()); })();
}
