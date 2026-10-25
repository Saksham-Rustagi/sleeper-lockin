// Task T3: the mid-game FORFEIT option. Sleeper (confirmed by the user): a player can be benched at any time; benching
// him while his game is in progress forfeits that game (it no longer counts for him) and frees his slot at once for
// someone whose game has not started. He keeps his later games.
//
// midgameHooks wraps any engine's hooks (P10b's race, P8, POLICY's start/lock simulations, P11). At a tip-off (by
// default only the first one the hooks see: the live decision), for every player in a game in progress WITH in-game
// information (Game.live: his points so far; Game.mu / sd: his final score given them, lib/live/ingame.ts) whose game
// ends after the tip-off, it compares two worlds:
//   keep:    the engine's own decision at the tip-off with him still in his game (what the engine does without the option)
//   forfeit: the engine's own decision at the tip-off after benching him now (his slot free, his game lost)
// Each world is decided by a FRESH copy of the engine's hooks (same seed: the races see the same scenarios) from the same
// state, then scored by continuations of the rest of the week played by the engine's base policy (P8 for the race
// engines, POLICY for p7h) on common random numbers: the same scenarios for every world (drawn from this module's own
// stream, so the engine's own decisions and random streams are untouched). The forfeit is taken only for a clear gain:
// paired mean gain > max(minGain = 1 pt, z = 2 se) on the full kMax scenarios (candidates that cannot reach it are dropped
// after each batch: futility only, no early acceptance), AND only if the forfeit changes the decision at THIS tip-off
// (someone else starts, locks or keeps a held score). A clear gain that only comes from a later tip-off is deferred:
// the user can bench him any time before then, and waiting shows more of his game (the keep world here can't forfeit
// later, so "now vs never" would overstate benching now); it is re-checked when that tip-off is the next one. Among
// passing candidates the largest gain; one forfeit per decision (the next refresh may recommend another).
// Without in-game information (every backtest / replay: no Game.live) there are no candidates and the hooks behave
// exactly like the wrapped ones: simulate() calls beforeGroup, which returns without touching anything.
import * as E from "./core";
import { holdSlot, reachable, exportPrices, seedPrices, continuePrices, type IndexDecision, type PriceSnap } from "./p8";
import type { RaceCtx, RacePool, Scen } from "./p10";

export interface MidgameOpts {
  minGain?: number;  // a forfeit must gain more than this many expected points (default 1)
  z?: number;        // ... and more than z standard errors of the paired mean (default 2)
  batch?: number;    // scenarios per round (default 64)
  kMax?: number;     // scenarios per world (default 256)
  maxCands?: number; // players evaluated per decision, lowest expected final score first (default 6: live 2026-10-21, a cap of 4
                     // dropped the best candidate, a ~19.5-expected player whose slot was the one to free)
  first?: boolean;   // only at the first tip-off these hooks see (default true: the live decision)
}
const DEF: Required<MidgameOpts> = { minGain: 1, z: 2, batch: 64, kMax: 256, maxCands: 6, first: true };

// one evaluated player: keep / forfeit = mean week totals on the n scenarios both worlds have, gain = paired mean, se
export interface MidgameEval {
  p: number; gi: number; slot: number; pts: number; mu: number; sd: number; n: number; keep: number; forfeit: number; gain: number; se: number;
  pass: boolean;     // clear gain AND the forfeit changes this tip-off's decision: bench him now
  deferred: boolean; // clear gain, but the freed slot is only used at a later tip-off: keep him for now (re-checked then)
  starts: number[]; // players the forfeit world starts at the tip-off that the keep world doesn't (who uses the freed slot)
}
export interface MidgameResult { t: number; evIdx: number; evals: MidgameEval[]; pick: number; ms: number; sims: number }
// groups: tip-offs seen; checks: tip-offs with candidates (evaluated)
export interface MidgameStats { groups: number; checks: number; worlds: number; sims: number; forfeits: number; ms: number; log: MidgameResult[] }
export const newMidgameStats = (): MidgameStats => ({ groups: 0, checks: 0, worlds: 0, sims: 0, forfeits: 0, ms: 0, log: [] });

// players who could be forfeited at tip-off group e (state before the group's decision)
export function forfeitCandidates(tw: E.TeamWeek, st: E.State, e: E.Ev, max = DEF.maxCands): number[] {
  const t = e.t;
  if (!e.group!.some((g) => !st.isLocked[tw.games[g].p] && E.usable(tw, tw.games[g].p, t))) return []; // nobody needs a slot now
  const c: number[] = [];
  for (let p = 0; p < tw.pmask.length; p++) {
    const gi = st.inGame[p]; if (gi < 0) continue;
    const g = tw.games[gi];
    if (!g.live || g.tip >= t || g.end <= t || st.pinned.indexOf(p) < 0) continue;
    c.push(p);
  }
  return c.sort((a, b) => tw.games[st.inGame[a]].mu - tw.games[st.inGame[b]].mu || a - b).slice(0, max);
}

interface World { pre: E.State | null; d: IndexDecision | null; prices: PriceSnap | null; post: E.State; tot: number[]; ctx: RaceCtx | null }

export function midgameHooks(tw: E.TeamWeek, events: E.Ev[], inner: E.Hooks | undefined, o: {
  pol: E.Policy;                          // the decision policy (the one simulate() runs)
  base: E.Policy;                         // plays the continuations (P8 with its own price slot, or POLICY)
  makeInner: () => E.Hooks | undefined;   // a fresh copy of the engine's hooks (same seed as `inner`)
  realised: { actual: Float64Array; played: Uint8Array };
  seed: number;
  pool?: RacePool | null;                 // continuations on worker threads (P8 base; identical results)
  opts?: MidgameOpts;
  onResult?: (r: MidgameResult) => void;
}, stats: MidgameStats = newMidgameStats()): E.Hooks & { midgame: MidgameStats } {
  const O = { ...DEF, ...o.opts };
  const r = E.rng(o.seed ^ 0x7f4a7c15); const scratch = E.scratchState();
  let seen = false;
  const topSlot = o.pol.index ? o.pol.index.slot ?? "top" : null;
  const baseSlot = o.base.index ? o.base.index.slot ?? "roll" : null;
  return {
    ...inner,
    midgame: stats,
    beforeGroup: (st, t, evIdx) => {
      inner?.beforeGroup?.(st, t, evIdx);
      if (O.first && seen) return; seen = true; stats.groups++;
      const e = events[evIdx];
      const cands = forfeitCandidates(tw, st, e, O.maxCands);
      if (!cands.length) return;
      const t0 = performance.now(); stats.checks++;
      const restore = [topSlot, baseSlot].filter((s): s is string => !!s).map((s) => holdSlot(tw, s));
      // the engine's decision at this tip-off in one world (forfeit = -1: keep)
      // (each world continues from the outer run's own price state, exactly as the outer decision does: "top" restored
      // and armed before the nested run)
      const decide = (forfeit: number): World => {
        if (topSlot) { restore[0](); continuePrices(tw, topSlot); }
        const s0 = E.cloneState(st); if (forfeit >= 0) E.forfeitGame(s0, forfeit);
        const h = o.makeInner(); const w: World = { pre: null, d: null, prices: null, post: s0, tot: [], ctx: null };
        const hd = h?.decideIndex;
        const hooks: E.Hooks = { ...h, beforeGroup: undefined, decideIndex: (s, tt, i, ctx) => {
          const alt = hd ? hd(s, tt, i, ctx) : undefined;
          if (i === evIdx) { w.pre = E.cloneState(s); w.d = reachable(tw, s, ctx, alt ?? ctx.best); w.prices = topSlot ? exportPrices(tw, topSlot) : null; }
          return alt;
        } };
        E.simulate(tw, o.pol, events, o.realised.actual, o.realised.played, s0, evIdx, hooks, t);
        stats.worlds++;
        return w;
      };
      // scenarios k0..k0+n-1 of world w (pool when the decision was captured, else this thread from w.post)
      const scens: Scen[] = [];
      const play = (w: World, k0: number, n: number) => {
        while (scens.length < k0 + n) scens.push(E.sampleScenario(tw, st, t, r, o.realised));
        const sc = scens.slice(k0, k0 + n); let tot: number[] | null = null;
        if (o.pool && w.pre && w.d && o.base.index) {
          w.ctx ??= { tw, base: o.base, events, st: w.pre, evIdx, cands: [w.d], prices: w.prices };
          tot = o.pool.round(w.ctx, [0], sc)?.[0] ?? null;
        }
        tot ??= sc.map((x) => { const s2 = scratch(w.post); if (baseSlot) seedPrices(tw, baseSlot, topSlot ?? "top"); return E.simulate(tw, o.base, events, x.actual, x.played, s2, evIdx + 1).total; });
        stats.sims += n; w.tot.push(...tot);
      };
      const keep = decide(-1); play(keep, 0, O.kMax);
      const pair = (w: World) => {
        const n = w.tot.length; let m = 0; for (let k = 0; k < n; k++) m += w.tot[k] - keep.tot[k]; m /= n;
        let v = 0; for (let k = 0; k < n; k++) v += (w.tot[k] - keep.tot[k] - m) ** 2;
        return { n, m, se: n > 1 ? Math.sqrt(v / (n - 1) / n) : Infinity };
      };
      const mean = (x: number[], n: number) => { let s = 0; for (let k = 0; k < n; k++) s += x[k]; return s / n; };
      const started = (s: E.State) => new Set(Array.from(s.pinned).filter((p, i) => p >= 0 && st.pinned[i] !== p));
      const kStarts = started(keep.post);
      // the forfeit changes this tip-off's decision (someone else starts, locks or keeps a held score): otherwise the
      // freed slot is only used at a later tip-off, and benching now would throw away what the rest of his game shows
      // before then - deferred (re-checked when that tip-off is the next one)
      const sig = (s: E.State, skip: number) => { let k = ""; for (let q = 0; q < tw.pmask.length; q++) if (q !== skip) k += `${s.inGame[q] >= 0 ? 1 : 0}${s.isLocked[q]}${Number.isNaN(s.pendingX[q]) ? 0 : 1}`; return k; };
      const evals: MidgameEval[] = [];
      for (const p of cands) {
        const gi = st.inGame[p]; const g = tw.games[gi]; const slot = st.pinned.indexOf(p);
        const w = decide(p);
        for (let k = 0; k < O.kMax; k += O.batch) {
          play(w, k, Math.min(O.batch, O.kMax - k));
          const q = pair(w); if (q.m + O.z * q.se < O.minGain) break; // futility: can't pass any more
        }
        const q = pair(w); const usedNow = sig(w.post, p) !== sig(keep.post, p);
        const clear = q.n >= O.kMax && q.m > O.minGain && q.m > O.z * q.se;
        evals.push({ p, gi, slot, pts: g.live!.pts, mu: g.mu, sd: g.sd, n: q.n, keep: mean(keep.tot, q.n), forfeit: mean(w.tot, q.n), gain: q.m, se: q.se,
          pass: clear && usedNow, deferred: clear && !usedNow, starts: [...started(w.post)].filter((x) => !kStarts.has(x) && x !== p) });
      }
      restore.forEach((f) => f());
      let pick = -1; for (const x of evals) if (x.pass && (pick < 0 || x.gain > evals.find((y) => y.p === pick)!.gain)) pick = x.p;
      if (pick >= 0) { E.forfeitGame(st, pick); stats.forfeits++; }
      const res: MidgameResult = { t, evIdx, evals, pick, ms: performance.now() - t0, sims: evals.reduce((a, x) => a + x.n, 0) + keep.tot.length };
      stats.ms += res.ms; stats.log.push(res); o.onResult?.(res);
    },
  };
}
