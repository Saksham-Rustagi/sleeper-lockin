// Task W: season-long waiver backtest (research/WAIVERS_W.md).
//   decide <week> <league|*> <out.json>   each team's pick under every method, before week <week> starts
//   score  <jobs.json> <out.json>         real-outcome totals of roster variants, played by P8 (live P10b's base policy)
// env: SEASON (season.json / season2024.json: rosters + walk-forward model), WALL (research/data/w/all20xx.json: every
// player's games), METHODS (default policy,p8f,ros,naive), NPOL (300), NP8F (400), TEAMS (rid list, optional)
import fs from "fs";
import * as E from "./engine";
import * as W from "./wcommon";
import { POLICY } from "../lib/live/week";
import { P8F_POLICY } from "../lib/live/engine";
import { policy as polByName } from "./policies";

const mode = process.argv[2];
const SIMP8F: E.Policy = { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "sim", fresh: true } }; // simPolicy('p8')
const NPOL = Number(process.env.NPOL || 300), NP8F = Number(process.env.NP8F || 400);
const METHODS = (process.env.METHODS || "policy,p8f,ros,naive").split(",");
const POOL = 12, TOPADD = 6, NDROP = 3, THRESH = 3;
// ROS term (fixed before any result was looked at; WAIVERS_W.md "Methods"): lambda * (R_add - R_drop),
// R_p = sum over weeks w+2..23 of c(w') * (games of his team in w') * ppg_p * avail_p, c = 1 (weeks <= 17), 2 (18+)
const LAMBDA = Number(process.env.LAMBDA || 0.08), PLAYOFF = 18, PLAYOFF_W = 2;

type Edit = { add?: string; drop?: string };
const key = (e: Edit) => `${e.add ?? "-"}/${e.drop ?? "-"}`;

function decideWeek(w: number, league: string) {
  const Wk = W.S.weeks.find((x: any) => x.week === w); const model = W.fitModel(w); const T = W.weekStart(w);
  const weeks = [w, w + 1].filter((x) => x <= W.LAST_WEEK);
  const out: any[] = [];
  const rids = Object.keys(Wk.teams).filter((r) => (league === "all" || W.A.leagueOf[r] === league) && (!process.env.TEAMS || process.env.TEAMS.split(",").includes(r)));
  for (const rid of rids) {
    const t0 = Date.now();
    const lg = W.A.leagueOf[rid]; const roster: string[] = Wk.teams[rid].players;
    const rostered = new Set<string>(W.A.rostered[String(w)][lg]);
    const pk = (p: string) => (W.lastPlayed(p, T) ? model.dnp.p1 : model.dnp.p0);
    const window = (p: string) => weeks.flatMap((x) => W.gamesOf(p, x));
    const ppg = (p: string) => { const g = window(p); return g.length ? g.reduce((s, x) => s + x.pre!, 0) / g.length : W.projAt(p, T); };
    // IR: a roster over 19 has (n - 19) players on IR = the longest current sit-out streaks (not droppable for a spot)
    const nIR = Math.max(0, roster.length - W.ACTIVE);
    const ir = new Set([...roster].sort((a, b) => W.dnpStreak(b, T) - W.dnpStreak(a, T) || ppg(a) - ppg(b)).slice(0, nIR));
    const openSpots = Math.max(0, W.ACTIVE - (roster.length - nIR));
    const dropCands = roster.filter((p) => !ir.has(p));
    const prot = new Map(roster.map((p) => [p, W.isProtected(p, w)]));
    // free agents with games in the 2-week window, ranked like the Waivers page (expected points of their games)
    const fas = [...new Set(weeks.flatMap((x) => W.all.filter((g) => g.week === x).map((g) => g.pid)))].filter((p) => !rostered.has(p) && /^\d+$/.test(p));
    const v2 = (p: string) => window(p).reduce((s, g) => s + pk(p) * Math.max(0, model.a + model.b * g.pre!), 0);
    const pool1 = fas.map((p) => [p, v2(p)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, POOL).map(([p]) => p);
    const R = (p: string) => { const tm = W.teamAt(p, T); let s = 0; for (let x = w + 2; x <= W.LAST_WEEK; x++) s += (x >= PLAYOFF ? PLAYOFF_W : 1) * W.teamGamesIn(tm, x); return s * Math.max(0, model.a + model.b * ppg(p)) * W.availability(p, T); };

    // simulated value of a roster variant over the 2 weeks (paired draws per player)
    const sims = (pol: E.Policy, N: number) => {
      const cache = new Map<string, Float64Array[]>(); let n = 0;
      const get = (e: Edit) => {
        const k = key(e); let v = cache.get(k);
        if (!v) {
          const pids = roster.filter((p) => p !== e.drop).concat(e.add ? [e.add] : []);
          v = weeks.map((x) => { const { tw } = W.teamWeekFor(pids, x, model, T); return W.simValues(tw, pids, pol, N, x * 7919); });
          cache.set(k, v); n++;
        }
        return v;
      };
      const diff = (e: Edit) => {
        const b = get({}), x = get(e); const d = new Float64Array(N); const per = weeks.map(() => 0);
        for (let k = 0; k < N; k++) for (let j = 0; j < weeks.length; j++) { const dd = x[j][k] - b[j][k]; d[k] += dd; per[j] += dd / N; }
        const mean = d.reduce((s, v) => s + v, 0) / N; const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, N - 1));
        return { total: mean, se: sd / Math.sqrt(N), a: per[0], b: per[1] ?? 0 };
      };
      return { diff, count: () => n };
    };
    // the Waivers page's search (lib/live/waivers.ts) with a valuation hook (extra = ROS term, 0 for the page)
    const pageSearch = (s: ReturnType<typeof sims>, extraAdd: (p: string) => number, extraDrop: (p: string) => number, pool: string[]) => {
      const droppable = dropCands.map((p) => { const d = s.diff({ drop: p }); return { p, loss: -d.total, se: d.se, prot: prot.get(p)! }; });
      const dropPick = droppable.filter((d) => !d.prot).map((d) => ({ ...d, v: d.loss + extraDrop(d.p) })).sort((a, b) => a.v - b.v).slice(0, NDROP);
      const cands = pool.map((p) => { const d = s.diff({ add: p }); return { p, gain: d.total, v: d.total + extraAdd(p) }; }).sort((a, b) => b.v - a.v);
      const moves: any[] = [];
      for (const c of cands.slice(0, TOPADD)) {
        const opts: (string | undefined)[] = [...(openSpots > 0 ? [undefined] : []), ...dropPick.map((d) => d.p)];
        for (const dr of opts) {
          const d = s.diff({ add: c.p, drop: dr }); const extra = extraAdd(c.p) - (dr ? extraDrop(dr) : 0);
          const dropOnly = dr ? -droppable.find((x) => x.p === dr)!.loss : 0;
          moves.push({ add: c.p, drop: dr ?? null, raw: v2(c.p) - (dr ? v2(dr) : 0), sim: d.total, se: d.se, a: d.a, b: d.b, ros: extra, total: d.total + extra, gainNoDrop: c.gain, dropOnly });
        }
      }
      moves.sort((a, b) => b.total - a.total);
      const pick = moves.find((m) => m.total > Math.max(1, 2 * m.se) && m.total >= THRESH) ?? null;
      return { pick, best: moves[0] ?? null, nMoves: moves.length, moves: moves.map((m) => [m.add, m.drop, Math.round(m.sim * 100) / 100, Math.round(m.raw * 100) / 100]),
        sigDropGain: droppable.filter((d) => -d.loss > 2 * d.se && -d.loss > 0.5).length, nDroppable: droppable.length,
        dropGains: droppable.map((d) => [d.p, Math.round(-d.loss * 100) / 100, Math.round(d.se * 100) / 100]) };
    };
    const row: any = { week: w, rid, league: lg, roster, ir: [...ir], openSpots, pool: pool1, methods: {} as any, ms: {} as any };
    let sPol: ReturnType<typeof sims> | null = null;
    for (const m of METHODS) {
      const t1 = Date.now();
      if (m === "policy" || m === "policy2000") { const s = m === "policy" ? (sPol ??= sims(POLICY, NPOL)) : sims(POLICY, 2000); row.methods[m] = { ...pageSearch(s, () => 0, () => 0, pool1), variants: s.count() }; }
      else if (m === "p8f") { const s = sims(SIMP8F, NP8F); row.methods[m] = { ...pageSearch(s, () => 0, () => 0, pool1), variants: s.count() }; }
      else if (m === "ros") {
        const s = (sPol ??= sims(POLICY, NPOL));
        const pool3 = [...new Set([...pool1, ...fas.map((p) => [p, v2(p) + LAMBDA * R(p)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p)])];
        row.methods[m] = { ...pageSearch(s, (p) => LAMBDA * R(p), (p) => LAMBDA * R(p), pool3), variants: s.count(), pool: pool3 };
      } else if (m === "naive") {
        const fa = fas.filter((p) => W.gamesOf(p, w).length).map((p) => [p, ppg(p)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
        const low = dropCands.filter((p) => !prot.get(p)).map((p) => [p, ppg(p)] as [string, number]).sort((a, b) => a[1] - b[1])[0];
        const act = fa && (openSpots > 0 || (low && fa[1] > low[1]));
        row.methods[m] = { pick: act ? { add: fa[0], drop: openSpots > 0 ? null : low[0], total: fa[1] - (openSpots > 0 ? 0 : low[1]) } : null };
      }
      row.ms[m] = Date.now() - t1;
    }
    row.msTotal = Date.now() - t0; row.rssMB = Math.round(process.memoryUsage().rss / 1e6);
    out.push(row);
    process.stderr.write(`w${w} r${rid} ${METHODS.map((m) => `${m}:${row.methods[m].pick ? `+${W.A.names[row.methods[m].pick.add]}/-${W.A.names[row.methods[m].pick.drop] ?? "-"} ${row.methods[m].pick.total.toFixed(1)}` : "none"}(${row.ms[m]}ms)`).join(" ")}\n`);
  }
  return out;
}

// real outcome of a roster in week w, played by P8 (deterministic on real outcomes: no seeds)
const P8 = polByName("P8");
const models = new Map<number, W.Model>();
export function realTotal(w: number, pids: string[]) {
  if (!models.has(w)) models.set(w, W.fitModel(w));
  const { tw, real } = W.teamWeekFor(pids, w, models.get(w)!, W.weekStart(w));
  return E.simulate(tw, P8, E.buildEvents(tw, P8.chain), real.actual, real.played, E.initState(tw), 0).total;
}

if (mode === "decide") {
  const [w, lg, outFile] = [Number(process.argv[3]), process.argv[4], process.argv[5]];
  fs.writeFileSync(outFile, JSON.stringify(decideWeek(w, lg)));
} else if (mode === "score") {
  const jobs: { w: number; rid: string; pids: string[]; k: string }[] = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const res: Record<string, number> = {}; const t0 = Date.now();
  for (const j of jobs) res[j.k] = Math.round(realTotal(j.w, j.pids) * 100) / 100;
  fs.writeFileSync(process.argv[4], JSON.stringify({ res, ms: Date.now() - t0, n: jobs.length }));
}
