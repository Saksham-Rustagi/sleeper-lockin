// Policies P2LA / P2LAH / P7H built exactly as research/backtest.ts builds them (same flags, same hook stack, same
// seeds for real outcomes), so instrumented runs reproduce the backtest numbers.
import * as E from "./engine";
import { indexRolloutHooks } from "../lib/engine/p8";

const K = Number(process.env.K || 200), KS = Number(process.env.KS || K);
export const POL: Record<string, E.Policy> = {
  P2LA: { name: "P2LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P2LAH: { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true },
  P7H: { name: "P7H", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true, rollout: { objective: "points", K, margin: 12 } },
  // Phase 2: Lagrangian index policy (prices re-solved never / at each day's first tip-off / at every tip-off)
  P8: { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "never" } },
  P8d: { name: "P8d", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "day" } },
  P8t: { name: "P8t", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip" } },
};
// P9<v> = P8<v> + rollouts over the index decision and its closest alternatives (base: P8 with the current prices)
for (const v of ["", "d", "t"]) POL["P9" + v] = { ...POL["P8" + v], name: "P9" + v };
// <name>_L = with every bug fixed in engine-v2 phase 1 re-enabled (= the engine the phase-1 numbers were measured on);
// <name>_L<bug>[+<bug>] = only those bugs re-enabled (strand, negEnd, reseat, stop, heldTie)
export function policy(name: string): E.Policy {
  if (POL[name]) return POL[name];
  // ad-hoc index-policy variants: P8x:key=val,key=val (keys of IndexOpts); P9x:... = the same with rollouts
  const x = name.match(/^(P8|P9)x:(.*)$/);
  if (x) {
    const o: any = { resolve: "never" };
    for (const kv of x[2].split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = /^[\d.]+$/.test(v) ? Number(v) : v; }
    return { ...POL.P8, name, index: o };
  }
  const m = name.match(/^(P2LA|P2LAH|P7H|P8|P8d|P8t|P9|P9d|P9t)_L(.*)$/); if (!m) throw new Error("unknown policy " + name);
  return { ...POL[m[1]], name, legacyBugs: m[2] ? (m[2].split("+") as E.LegacyBug[]) : true };
}
export interface Runner { pol: E.Policy; events: E.Ev[]; hooks?: E.Hooks }
// realised = the "world" the policy lives in (real outcomes, or a model scenario): rollouts keep its finished games.
export function runner(name: string, tw: E.TeamWeek, seed: number, realised: { actual: Float64Array; played: Uint8Array }): Runner {
  const pol = policy(name);
  const events = E.buildEvents(tw, pol.chain);
  let hooks: E.Hooks | undefined;
  if (pol.rollout) {
    const base: E.Policy = { ...POL.P2LA, eps: pol.eps, cutoff: pol.cutoff, holdYield: pol.holdYield, legacyBugs: pol.legacyBugs }; // (all policies here are lockAware)
    hooks = E.rolloutHooks(tw, base, events, pol.rollout.objective, pol.rollout.K, pol.rollout.margin, seed, realised);
  }
  if (/^P9/.test(name)) hooks = indexRolloutHooks(tw, { ...pol, name: "P8base", index: { ...pol.index!, resolve: "never" } }, events, KS, seed, realised);
  if (/^P7H/.test(name)) hooks = E.startRolloutHooks(tw, { ...POL.P2LA, cutoff: pol.cutoff, holdYield: pol.holdYield, legacyBugs: pol.legacyBugs }, events, KS, seed, realised, hooks);
  return { pol, events, hooks };
}
export function scenarios(tw: E.TeamWeek, n: number, seed: number) {
  const r = E.rng(seed); const base = { actual: new Float64Array(tw.games.length), played: new Uint8Array(tw.games.length) };
  return Array.from({ length: n }, () => E.sampleScenario(tw, null, -Infinity, r, base));
}
// Same week without player j (his games removed, indices of the others unchanged); keep = surviving game indices.
export function dropPlayer(tw: E.TeamWeek, j: number): { tw: E.TeamWeek; keep: number[] } {
  const keep = tw.games.map((_, i) => i).filter((i) => tw.games[i].p !== j);
  const remap = new Map(keep.map((g, i) => [g, i]));
  const games = keep.map((i) => tw.games[i]);
  const byPlayer = tw.byPlayer.map((l, p) => (p === j ? [] : l.map((g) => remap.get(g)!)));
  const nextGameIdx = tw.nextGameIdx?.map((g) => (g >= 0 && remap.has(g) ? remap.get(g)! : -1));
  return { tw: { ...tw, games, byPlayer, nextGameIdx }, keep };
}
