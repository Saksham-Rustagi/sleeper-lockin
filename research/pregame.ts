// ENGINE_V2 Phase 4 prototype: the pre-game planner.
// Before tonight's first tip-off it fixes tonight's lineup (the decision engine, P10b by default) and then, by deep
// simulation within a time budget, turns the morning-after decision for every starter into a lookup table. The decision
// is the one at D = tomorrow's first decision tip-off (the first tip-off on the next game day): by then all of tonight's
// results are known, and it is where a held score competes for a slot again (at a later tip-off tonight keeping a
// score is usually free, so "lock" only wins there for extreme scores). For a starter scoring x tonight:
//     lock  if x >= lockCut      (lock x in the slot the index policy picks)
//     keep  if letGoCut <= x < lockCut   (hold the score in a starting slot and decide later; if his own next game
//                                         tips at D, "keep" means playing it)
//     free  if x < letGoCut      (let the score go: the slot is worth more to the others)
//   and the same cut-offs conditional on a key teammate's result tonight (above / below his own lock cut-off), when
//   conditioning moves the cut-off materially.
// Method (common random numbers): scenarios of tonight + the rest of the week are drawn from the model; for each
// starter p, scenario k and every x on a grid of his score distribution (his game's result set to x), the rest of the
// week is played by the base policy (P8, prices re-solved at every tip-off: the continuations P10b uses) with p's action
// at D forced to lock / keep / free. Before D the base policy decides as usual (if it already locked or let go his
// score at a later tip-off tonight, the three continuations coincide). lockCut = min x with V_lock(x) >=
// max(V_keep(x), V_free(x)), letGoCut = min x with max(V_lock(x), V_keep(x)) >= V_free(x) (linear interpolation on the
// grid, bootstrap SEs). Rounds of scenarios run until BUDGET_S seconds of search (default 1800) or KMAX scenarios;
// conditional cut-offs re-use the same continuations split by the teammate's simulated result (post-stratification),
// so they cost nothing extra.
//
// usage: node research/dist/pregame.cjs season <week> <rid> <day> <out.json>   (2025-26 data; day = index of the game
//          day in the week; history before tonight played by P8; then the planner; then the check against the real-time
//          engines P10b and P8 on the real results)
//        node research/dist/pregame.cjs live <leagueId> <rosterId> <out.json>   (live league state now; no check)
// env (or KEY=VAL arguments): BUDGET_S (1800), KMAX (4000), ROUND (16 scenarios per round), BASE (P8 | P8f), ENGINE
//      (P10b | P8: tonight's lineup), GRID (comma-separated z-scores of his score distribution; -9 = a score of 0),
//      KEVAL (300: continuations per action in the check), TABLE (<prefix>: re-use <prefix>_<week>_<rid>.json's table
//      and redo only the lineup and the check)
import fs from "fs";
import * as E from "./engine";
import * as PL from "./policies";
import { assign, toDecision, fillIdle, seedPrices, continuePrices, type IndexContext, type IndexDecision } from "../lib/engine/p8";

// KEY=VAL arguments set the environment (e.g. BUDGET_S=600); the rest are positional
for (const a of process.argv.slice(2)) { const m = a.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const ARGS = process.argv.slice(2).filter((a) => !/^[A-Z_][A-Z0-9_]*=/.test(a));
const BUDGET_S = Number(process.env.BUDGET_S || 1800), KMAX = Number(process.env.KMAX || 4000), ROUND = Number(process.env.ROUND || 16);
const GRID = (process.env.GRID || "-9,-1,-0.5,0,0.5,1,1.5,2,2.75").split(",").map(Number); // (-9: a score of 0, e.g. a DNP)
const BASE: E.Policy = process.env.BASE === "P8f"
  ? { ...PL.POL.P8, name: "P8f-plan", index: { resolve: "info", iters: 30, slot: "plan" } }
  : { ...PL.POL.P8, name: "P8-plan", index: { resolve: "tip", iters: 100, slot: "plan" } };
const ENGINE = process.env.ENGINE || "P10b";
type Real = { actual: Float64Array; played: Uint8Array };
type Act = "lock" | "keep" | "free";

// ---------------- forcing one held player's action at his next decision ----------------
// The index policy's tip-off decision with candidate i forced: seat = -1 (let go / bench), or seated with action a
// (0 play, 1 lock, 2 hold) in the best slot for it; everyone else is re-assigned around it (as P10's alternatives).
function forced(tw: E.TeamWeek, st: E.State, ctx: IndexContext, i: number, seat: number, a?: number): IndexDecision | undefined {
  const cs = ctx.cands.map((c, j) => (j === i && a !== undefined ? { ...c, w: c.wa[a], act: new Uint8Array(c.act.length).fill(a) } : c));
  const force = new Map([[i, seat]]);
  const r = assign(cs, ctx.free, force); if (!r) return undefined;
  const d = toDecision(cs, r.pick); fillIdle(tw, st, ctx.t, cs, d, ctx.free, "idle", force);
  return d;
}
// hooks that force p's action at the first tip-off decision at or after tFrom at which he holds a score
function forceHooks(tw: E.TeamWeek, p: number, act: Act, tFrom: number, rec?: { t: number; ok: boolean }): E.Hooks {
  let done = false;
  return {
    decideIndex: (st, t, _i, ctx) => {
      if (done || t < tFrom) return undefined;
      const i = ctx.cands.findIndex((c) => c.p === p && c.held); if (i < 0) return undefined;
      done = true; const c = ctx.cands[i];
      const d = act === "free" ? forced(tw, st, ctx, i, -1) : forced(tw, st, ctx, i, 1, act === "lock" ? 1 : c.tipping ? 0 : 2);
      if (rec) { rec.t = t; rec.ok = !!d; }
      return d; // (infeasible: the base policy decides)
    },
  };
}

// ---------------- the planner ----------------
export interface PlanInput { tw: E.TeamWeek; st: E.State; evIdx: number; events: E.Ev[]; real: Real; t0: number; label: string; seed: number; slotNames: string[]; tableFile?: string }
interface Starter {
  p: number; name: string; slot: string; gi: number; tip: number; end: number; mu: number; sd: number; D: number;
  grid: number[]; L: number[][]; G: number[][]; K: number[][]; // per scenario and grid x: lock, let go, keep at D
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
// cut-offs from per-scenario values on the subset idx
function cutoffs(s: Starter, idx: number[]) {
  const V = (A: number[][]) => s.grid.map((_, j) => mean(idx.map((k) => A[k][j])));
  const VL = V(s.L), VG = V(s.G), VK = V(s.K);
  const cross = (f: (j: number) => number) => { // first grid crossing of f >= 0, linearly interpolated
    if (f(0) >= 0) return { x: s.grid[0], below: true, above: false };
    for (let j = 1; j < s.grid.length; j++) if (f(j) >= 0) { const a = f(j - 1), b = f(j); return { x: s.grid[j - 1] + ((s.grid[j] - s.grid[j - 1]) * -a) / (b - a), below: false, above: false }; }
    return { x: s.grid[s.grid.length - 1], below: false, above: true };
  };
  const lock = cross((j) => VL[j] - Math.max(VG[j], VK[j]));
  const letGo = cross((j) => Math.max(VL[j], VK[j]) - VG[j]);
  return { lock, letGo, VL, VG, VK };
}
function boot(s: Starter, idx: number[], B: number, seed: number) {
  const r = E.rng(seed); const xs: number[] = []; const ys: number[] = [];
  for (let b = 0; b < B; b++) { const sub = idx.map(() => idx[Math.floor(r() * idx.length)]); const c = cutoffs(s, sub); xs.push(c.lock.x); ys.push(c.letGo.x); }
  const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map((x) => (x - m) ** 2))); };
  return { lockSe: sd(xs), letGoSe: sd(ys) };
}

export function plan(inp: PlanInput, log: (s: string) => void = () => {}) {
  const t0wall = performance.now(); const { tw, real, events } = inp;
  // 1. tonight's lineup: the decision engine at tonight's tip-offs, up to the first moment a game of tonight ends
  const night = tw.games.filter((g) => g.tip >= inp.t0 && g.tip < E.dayEnd(inp.t0));
  const firstEnd = Math.min(...night.map((g) => g.end)); const lastTip = Math.max(...night.map((g) => g.tip));
  const ru = PL.runner(ENGINE, tw, inp.seed, real);
  continuePrices(tw, ru.pol.index?.slot ?? "top"); // (continues the history's prices: the same simulated week)
  const res = E.simulate(tw, ru.pol, events, real.actual, real.played, E.cloneState(inp.st), inp.evIdx, ru.hooks, Math.min(lastTip, firstEnd - 1));
  const S = E.cloneState(res.st); const evS = res.evIdx; seedPrices(tw, "plan0", "top");
  const laterTips = night.filter((g) => g.tip > Math.min(lastTip, firstEnd - 1)).length; // decided inside the continuations
  // 2. starters and the morning-after decision tip-off D (tomorrow's first tip-off with a player who is not locked)
  const tips = [...new Set(tw.games.map((g) => g.tip))].sort((a, b) => a - b);
  const D = tips.find((t) => t >= E.dayEnd(inp.t0) && tw.games.some((h) => h.tip === t && !S.isLocked[h.p])) ?? Infinity;
  const starters: Starter[] = [];
  for (let p = 0; p < tw.pmask.length; p++) {
    const gi = S.inGame[p]; if (gi < 0) continue;
    const g = tw.games[gi];
    const slot = inp.slotNames[S.pinned.indexOf(p)] ?? "?";
    const grid = [...new Set(GRID.map((z) => Math.round(Math.max(0, g.mu + g.sd * z) * 10) / 10))].sort((a, b) => a - b);
    starters.push({ p, name: tw.names[p], slot, gi, tip: g.tip, end: g.end, mu: g.mu, sd: g.sd, D, grid: grid.length > 1 ? grid : [0, 1], L: [], G: [], K: [] });
  }
  // 3. deep search: rounds of scenarios, every starter's actions on the same scenarios
  const r = E.rng(inp.seed ^ 0x6a09e667); const scen: Real[] = []; const scratch = E.scratchState();
  const cont = (sc: Real, p: number, gi: number, x: number, act: Act) => {
    const a = sc.actual.slice(), pl = sc.played.slice(); a[gi] = x; pl[gi] = 1;
    seedPrices(tw, "plan", "plan0");
    return E.simulate(tw, BASE, events, a, pl, scratch(S), evS, forceHooks(tw, p, act, D)).total;
  };
  let sims = 0; const lineupS = (performance.now() - t0wall) / 1000; const t0search = performance.now();
  // the budget is for the search (the lineup is computed first); at least two rounds always run
  while (!inp.tableFile && starters.length && Number.isFinite(D) && (scen.length < 2 * ROUND || (scen.length < KMAX && (performance.now() - t0search) / 1000 < BUDGET_S))) {
    for (let k = 0; k < ROUND; k++) {
      const sc = E.sampleScenario(tw, S, inp.t0, r, real); scen.push(sc);
      for (const s of starters) {
        s.L.push(s.grid.map((x) => cont(sc, s.p, s.gi, x, "lock"))); s.G.push(s.grid.map((x) => cont(sc, s.p, s.gi, x, "free")));
        s.K.push(s.grid.map((x) => cont(sc, s.p, s.gi, x, "keep"))); sims += 3 * s.grid.length;
      }
    }
    log(`${inp.label}: ${scen.length} scenarios, ${sims} continuations, ${((performance.now() - t0wall) / 1000).toFixed(0)} s`);
  }
  // (env TABLE=<earlier output.json>: re-use its table and search statistics, e.g. to redo only the check)
  const old = inp.tableFile ? JSON.parse(fs.readFileSync(inp.tableFile, "utf8")) : null;
  // 4. the table: unconditional cut-offs, then conditional on each teammate whose game ends before D(p)
  const all = scen.map((_, k) => k);
  const table = starters.map((s) => { const c = cutoffs(s, all); const b = boot(s, all, 200, s.p + 1); return { s, c, b }; });
  const rows = table.map(({ s, c, b }) => {
    const cond = table.filter((o) => o.s.p !== s.p && o.s.end <= s.D).map((o) => {
      const q = o.s; const cq = o.c.lock.x; const hi = all.filter((k) => scen[k].played[q.gi] && scen[k].actual[q.gi] >= cq), lo = all.filter((k) => !hi.includes(k));
      if (hi.length < 40 || lo.length < 40) return null;
      const ch = cutoffs(s, hi), cl = cutoffs(s, lo), bh = boot(s, hi, 200, s.p * 31 + q.p), bl = boot(s, lo, 200, s.p * 37 + q.p);
      const diff = ch.lock.x - cl.lock.x, se = Math.hypot(bh.lockSe, bl.lockSe);
      return { teammate: q.name, q: q.p, qCut: r1(cq), nHigh: hi.length, nLow: lo.length,
        ifHigh: { lockCut: r1(ch.lock.x), letGoCut: r1(ch.letGo.x), lockSe: r1(bh.lockSe) }, ifLow: { lockCut: r1(cl.lock.x), letGoCut: r1(cl.letGo.x), lockSe: r1(bl.lockSe) },
        diff: r1(diff), se: r1(se), key: Math.abs(diff) >= 1 && Math.abs(diff) > 2 * se };
    }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    return {
      player: s.name, p: s.p, slot: s.slot, tip: s.tip, end: s.end, decideAt: s.D, mu: r1(s.mu), sd: r1(s.sd),
      lockCut: r1(c.lock.x), lockCutBelowGrid: c.lock.below, lockCutAboveGrid: c.lock.above, lockSe: r1(b.lockSe),
      letGoCut: r1(c.letGo.x), letGoCutBelowGrid: c.letGo.below, letGoSe: r1(b.letGoSe),
      pLock: r2(pAbove(s.mu, s.sd, c.lock.x, tw)), values: s.grid.map((x, j) => ({ x, lock: r1(c.VL[j]), keep: r1(c.VK[j]), free: r1(c.VG[j]) })),
      conditional: cond,
    };
  });
  const lineup = { starts: starters.map((s) => ({ player: s.name, slot: s.slot, tip: s.tip })), laterTipsDecidedInContinuations: laterTips };
  if (old && JSON.stringify(old.lineup) !== JSON.stringify(lineup)) throw new Error("TABLE: tonight's lineup differs from the saved plan");
  const stats = old ? { budgetS: old.budgetS as number, lineupSeconds: old.lineupSeconds as number, seconds: old.seconds as number, scenarios: old.scenarios as number, continuations: old.continuations as number }
    : { budgetS: BUDGET_S, lineupSeconds: r1(lineupS), seconds: r1((performance.now() - t0wall) / 1000), scenarios: scen.length, continuations: sims };
  return { label: inp.label, t0: inp.t0, decideAt: D, engine: ENGINE, base: BASE.name, ...stats, lineup, rows: old ? (old.rows as typeof rows) : rows,
    // for the check against the real-time engines
    _S: S, _evS: evS, _hooks: ru.hooks, _pol: ru.pol };
}
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
function pAbove(mu: number, sd: number, x: number, tw: E.TeamWeek) { // P(he plays and scores >= x) given he plays
  if (tw.resid) { const q = tw.resid.q; let c = 0; for (let i = 0; i < q.length; i++) if (Math.max(-5, mu + sd * q[i]) >= x) c++; return c / q.length; }
  return 1 - E.normCdf((x - mu) / sd);
}
type PlanOut = ReturnType<typeof plan>;

// the table's action for a starter given tonight's results (the conditional cut-off of the strongest key teammate)
export function tableAction(row: PlanOut["rows"][number], x: number, played: boolean, results: Map<number, { x: number; played: boolean }>): { act: Act; cut: number; letGo: number; why: string } {
  let lockCut = row.lockCut, letGoCut = row.letGoCut, why = "unconditional";
  const key = row.conditional.find((c) => c.key && results.has(c.q));
  if (key) { const q = results.get(key.q)!; const hi = q.played && q.x >= key.qCut; const b = hi ? key.ifHigh : key.ifLow; lockCut = b.lockCut; letGoCut = b.letGoCut; why = `${key.teammate} ${hi ? ">=" : "<"} ${key.qCut}`; }
  if (!played) x = 0; // a DNP holds 0
  // beyond the grid nothing was measured: no lock above it, keep below it (keeping can still be undone)
  const lock = !row.lockCutAboveGrid && x >= lockCut, keep = row.letGoCutBelowGrid || x >= letGoCut;
  return { act: lock ? "lock" : keep ? "keep" : "free", cut: lockCut, letGo: letGoCut, why: played ? why : "DNP" };
}

// ---------------- check against the real-time engines (season mode) ----------------
// Replays the real-time engine from the planner's post-lineup state on the real results and records each starter's
// action at his decision tip-off; where the table disagrees with P10b, both actions are scored from P10b's real state
// just before that decision by KEVAL paired continuations (base policy, model scenarios).
// each starter's action at the first decision at or after D at which he still holds a score; a score already locked
// or let go at a tip-off tonight is reported as that (early) action
function realtimeActions(inp: PlanInput, pl: PlanOut, name: string, S: E.State, ev: number, pol: E.Policy, hooks: E.Hooks | undefined) {
  const { tw, real, events } = inp; const want = new Set(pl.rows.map((r) => r.p)); const D = pl.decideAt;
  const seen = new Map<number, number>(); // p -> decision time (at or after D)
  const wrap: E.Hooks = { ...hooks, decideIndex: (st, t, i, ctx) => { if (t >= D) for (const c of ctx.cands) if (c.held && want.has(c.p) && !seen.has(c.p)) seen.set(c.p, t); return hooks?.decideIndex?.(st, t, i, ctx); } };
  const out = new Map<number, { act: Act; t: number; early: boolean; before: E.State; evBefore: number }>();
  let st = E.cloneState(S); let i = ev; continuePrices(tw, pol.index?.slot ?? "top"); // (its prices continue from S)
  const times = [...new Set(events.slice(ev).map((e) => e.t))].filter((t) => t <= D).sort((a, b) => a - b);
  const status = (s: E.State, p: number): Act => (s.isLocked[p] ? "lock" : !Number.isNaN(s.pendingX[p]) || s.inGame[p] >= 0 ? "keep" : "free");
  for (const t of times) {
    const before = E.cloneState(st); const evBefore = i;
    const res = E.simulate(tw, pol, events, real.actual, real.played, st, i, wrap, t); st = res.st; i = res.evIdx;
    for (const p of want) {
      if (out.has(p)) continue;
      if (seen.get(p) === t) out.set(p, { act: status(st, p), t, early: false, before, evBefore });
      else if (t < D && st.inGame[p] < 0 && !Number.isNaN(before.pendingX[p]) && status(st, p) !== "keep") out.set(p, { act: status(st, p), t, early: true, before, evBefore });
    }
  }
  return { name, out };
}
function checkRealtime(inp: PlanInput, pl: PlanOut, log: (s: string) => void) {
  const { tw, real } = inp; const results = new Map<number, { x: number; played: boolean }>();
  for (const r of pl.rows) { const gi = tw.games.findIndex((g) => g.p === r.p && g.tip === r.tip); results.set(r.p, { x: real.actual[gi], played: !!real.played[gi] }); }
  // P10b continues with its own hooks (same seed, same state, its own "top" prices); P8 from the same post-lineup state
  // on its own price state; the value checks start from P10b's prices at the decision
  const p10 = realtimeActions(inp, pl, ENGINE, pl._S, pl._evS, pl._pol, pl._hooks);
  seedPrices(tw, "p10D", "top"); seedPrices(tw, "rtP8", "plan0");
  const p8 = realtimeActions(inp, pl, "P8", pl._S, pl._evS, { ...PL.POL.P8, index: { ...PL.POL.P8.index!, slot: "rtP8" } }, undefined);
  const KEVAL = Number(process.env.KEVAL || 300); const r = E.rng(inp.seed ^ 0x3c6ef372); const scratch = E.scratchState();
  return pl.rows.map((row) => {
    const res = results.get(row.p)!; const ta = tableAction(row, res.x, res.played, results);
    const a10 = p10.out.get(row.p), a8 = p8.out.get(row.p);
    const o: any = { player: row.player, x: res.played ? r1(res.x) : "DNP", table: ta.act, tableCut: ta.cut, tableLetGo: ta.letGo, tableWhy: ta.why,
      [ENGINE]: a10 ? a10.act + (a10.early ? " (tonight)" : "") : "n/a", P8: a8 ? a8.act + (a8.early ? " (tonight)" : "") : "n/a", decidedAt: a10?.t };
    if (a10 && !a10.early) {
      // score all three actions from the real-time engine's state just before its decision (model continuations of
      // the rest of the week, common random numbers): which is best, and what the table's and the engine's choices cost
      const tD = a10.t; const acts: Act[] = ["lock", "keep", "free"]; const V: Record<Act, number[]> = { lock: [], keep: [], free: [] };
      const ok: Record<Act, number> = { lock: 0, keep: 0, free: 0 };
      for (let k = 0; k < KEVAL; k++) {
        const sc = E.sampleScenario(tw, a10.before, tD, r, real);
        for (const act of acts) {
          seedPrices(tw, "plan", "p10D"); const rec = { t: -1, ok: false };
          V[act].push(E.simulate(tw, BASE, inp.events, sc.actual, sc.played, scratch(a10.before), a10.evBefore, forceHooks(tw, row.p, act, tD, rec)).total);
          if (rec.t === tD && rec.ok) ok[act]++;
        }
      }
      // an action that could not be forced at the decision (no legal seat for it) is not scored
      const feasible = acts.filter((a) => ok[a] >= 0.99 * KEVAL);
      const m = (a: Act) => mean(V[a]);
      const best = feasible.reduce((b, a) => (m(a) > m(b) ? a : b), feasible[0]);
      const regret = (a: Act) => { if (!feasible.includes(a)) return null; const d = V[best].map((x, k) => x - V[a][k]); const mu = mean(d); return { m: r2(mu), se: r2(Math.sqrt(mean(d.map((x) => (x - mu) ** 2)) / d.length)) }; };
      o.values = Object.fromEntries(acts.map((a) => [a, r2(m(a))])); o.best = best; o.feasible = Object.fromEntries(acts.map((a) => [a, r2(ok[a] / KEVAL)]));
      o.regretTable = regret(ta.act); o.regretEngine = regret(a10.act);
      if (a8 && !a8.early) o.regretP8 = regret(a8.act);
      log(`${inp.label}: ${row.player} x=${res.played ? r1(res.x) : "DNP"} best ${best} (lock ${r1(m("lock"))} keep ${r1(m("keep"))} free ${r1(m("free"))}; feasible ${feasible}); table ${ta.act} -${o.regretTable?.m}, ${ENGINE} ${a10.act} -${o.regretEngine?.m}${a8 && !a8.early ? `, P8 ${a8.act} -${o.regretP8?.m}` : ""}`);
    }
    return o;
  });
}

// ---------------- readable summary ----------------
const fmt = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
export function summary(pl: PlanOut) {
  const L: string[] = [`Pre-game plan ${pl.label} (tonight from ${fmt(pl.t0)}; ${pl.scenarios} scenarios, ${pl.continuations} continuations, ${pl.seconds} s; lineup by ${pl.engine}, continuations by ${pl.base})`];
  L.push(`Tonight: ${pl.lineup.starts.map((s) => `${s.player} (${s.slot}, ${fmt(s.tip)})`).join(", ")}${pl.lineup.laterTipsDecidedInContinuations ? ` (+${pl.lineup.laterTipsDecidedInContinuations} later games decided after the first results)` : ""}`);
  L.push(`Before ${Number.isFinite(pl.decideAt) ? fmt(pl.decideAt) : "week end"}, with tonight's results:`);
  for (const r of pl.rows) {
    const lock = r.lockCutAboveGrid ? `don't lock (not even at ${r.lockCut})` : `LOCK if >= ${r.lockCut}${r.lockCutBelowGrid ? " (or less)" : ""} (±${r.lockSe}; P ${Math.round(r.pLock * 100)}% if he plays)`;
    const keep = r.letGoCutBelowGrid ? "; otherwise keep" : r.letGoCut < r.lockCut || r.lockCutAboveGrid ? `; keep ${r.letGoCut}${r.lockCutAboveGrid ? "+" : `-${r.lockCut}`}; free the slot below ${r.letGoCut}` : `; free the slot below ${r.lockCut}`;
    L.push(`  ${r.player} [${r.slot}] proj ${r.mu}±${r.sd}: ${lock}${keep}`);
    for (const c of r.conditional.filter((c) => c.key)) L.push(`      if ${c.teammate} scores >= ${c.qCut}: lock if >= ${c.ifHigh.lockCut}; otherwise lock if >= ${c.ifLow.lockCut}  (Δ ${c.diff} ± ${c.se})`);
  }
  return L.join("\n");
}

// ---------------- CLI ----------------
async function main() {
  // research/runtasks.mjs form: <week> <rid> <out.json> [day]  ==  season <week> <rid> <day> <out.json>; with
  // TASKS=w:rid:day runtasks passes the day as env PLAYERS
  const args = /^\d+$/.test(ARGS[0] ?? "") ? ["season", ARGS[0], ARGS[1], ARGS[3] ?? process.env.DAY ?? process.env.PLAYERS ?? "1", ARGS[2]] : ARGS;
  const [mode, ...a] = args;
  const log = (s: string) => process.stderr.write(s + "\n");
  if (mode === "season") {
    const { fitModel, teamWeek } = await import("./btcommon");
    const [week, rid, day, out] = [Number(a[0]), a[1], Number(a[2]), a[3]];
    const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
    const days = [...new Set(tw.games.map((g) => E.dayEnd(g.tip)))].sort((x, y) => x - y);
    const t0 = Math.min(...tw.games.filter((g) => E.dayEnd(g.tip) === days[day]).map((g) => g.tip));
    // history before tonight: P8 on the real results
    const ru = PL.runner("P8", tw, seed, real); const pre = E.simulate(tw, ru.pol, ru.events, real.actual, real.played, E.initState(tw), 0, undefined, t0 - 1);
    const S = (await import("./btcommon")).S; const inp: PlanInput = { tw, st: pre.st, evIdx: pre.evIdx, events: ru.events, real, t0, label: `w${week} r${rid} day ${day}`, seed, slotNames: S.slots,
      tableFile: process.env.TABLE ? `${process.env.TABLE}_${week}_${rid}.json` : undefined };
    const pl = plan(inp, log);
    const check = checkRealtime(inp, pl, log);
    const { _S, _evS, _hooks, _pol, ...rest } = pl;
    fs.writeFileSync(out, JSON.stringify({ week, rid, day, ...rest, check, summary: summary(pl) }, null, 1));
    log(summary(pl)); log(JSON.stringify(check));
  } else if (mode === "live") {
    const { buildWeek } = await import("../lib/live/week");
    const [leagueId, rosterId, out] = [a[0], Number(a[1]), a[2]];
    const ctx = await buildWeek({ leagueId, rosterId, mode: "live", skipOpp: true }); const T = ctx.me;
    const t0 = Math.min(...T.tw.games.filter((g) => g.tip > ctx.asOf).map((g) => g.tip));
    if (!Number.isFinite(t0)) throw new Error("no games left this week");
    const pl = plan({ tw: T.tw, st: T.st, evIdx: T.evIdx, events: T.events, real: T.real, t0, label: `${ctx.league.name} roster ${rosterId} week ${ctx.week}`, seed: 4242 + ctx.week, slotNames: ctx.slotNames }, log);
    const { _S, _evS, _hooks, _pol, ...rest } = pl;
    fs.writeFileSync(out, JSON.stringify({ ...rest, summary: summary(pl) }, null, 1)); log(summary(pl));
  } else { console.error("usage: pregame.cjs season <week> <rid> <day> <out.json> | live <leagueId> <rosterId> <out.json>"); process.exit(1); }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
