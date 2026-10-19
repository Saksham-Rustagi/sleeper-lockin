// Policies P2LA / P2LAH / P7H built exactly as research/backtest.ts builds them (same flags, same hook stack, same
// seeds for real outcomes), so instrumented runs reproduce the backtest numbers.
import * as E from "./engine";
import { indexRolloutHooks } from "../lib/engine/p8";
import { p10Hooks, P10C_OPTS, type P10Opts, type RaceInfo } from "../lib/engine/p10";
import { p11Hooks, type P11Opts, type OppSource } from "../lib/engine/p11";

const K = Number(process.env.K || 200), KS = Number(process.env.KS || K);
export const POL: Record<string, E.Policy> = {
  P2LA: { name: "P2LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P2LAH: { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true },
  P7H: { name: "P7H", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true, rollout: { objective: "points", K, margin: 12 } },
  // Phase 2: Lagrangian index policy. P8 = prices re-solved (100 warm-started iterations) at every tip-off;
  // P8f (fast) = re-solved (30 iterations) only at tip-offs after new results; P8s = week-start prices only
  P8: { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100 } },
  P8f: { name: "P8f", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "info", iters: 30 } },
  P8s: { name: "P8s", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "never" } },
};
// P9 = P8 + rollouts over the index decision and its closest alternatives, continuations played by P8f (env P9BASE)
POL.P9 = { ...POL.P8, name: "P9" };
// P9b = P8 + rollouts played by P8 itself (prices re-solved at every tip-off inside the rollout too), K = 50
POL.P9b = { ...POL.P8, name: "P9b" };
// P10 = one complete decision per tip-off: P8's decision and its best alternatives raced by rollouts (common random
// numbers, adaptive sampling); continuations played by P8f (P10) or P8 (P10b). P10x:base=P8|P8f,<P10Opts key>=val,...
POL.P10 = { ...POL.P8, name: "P10" };
POL.P10b = { ...POL.P8, name: "P10b" };
// P10c = P10b + the confirmation of the race's best challenger on a fresh batch (task L, P10C_OPTS in lib/engine/p10.ts)
POL.P10c = { ...POL.P8, name: "P10c" };
// P11 = P10 playing for the win (lib/engine/p11.ts): P11:key=val,... (P11Opts, e.g. beta=300,sched=late), continuations by
// P8f; P11b:... the same on P10b (continuations by P8). Needs the opponent (runner's opp argument).
export const P11_TOP: E.Policy = { ...POL.P8, name: "P11top" };
// <name>_L = with every bug fixed in engine-v2 phase 1 re-enabled (= the engine the phase-1 numbers were measured on);
// <name>_L<bug>[+<bug>] = only those bugs re-enabled (strand, negEnd, reseat, stop, heldTie)
export function policy(name: string): E.Policy {
  if (POL[name]) return POL[name];
  if (/^P10x:/.test(name) || /^P11b?(:|$)/.test(name)) return { ...POL.P8, name };
  // ad-hoc index-policy variants: P8x:key=val,key=val (keys of IndexOpts); P9x:... = the same with rollouts
  const x = name.match(/^(P8|P9)x:(.*)$/);
  if (x) {
    const o: any = { resolve: "never" };
    for (const kv of x[2].split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = /^[\d.]+$/.test(v) ? Number(v) : v; }
    return { ...POL[x[1] === "P9" ? "P9" : "P8"], name, index: o };
  }
  const m = name.match(/^(P2LA|P2LAH|P7H|P8|P8f|P8s|P9|P9b)_L(.*)$/); if (!m) throw new Error("unknown policy " + name);
  return { ...POL[m[1]], name, legacyBugs: m[2] ? (m[2].split("+") as E.LegacyBug[]) : true };
}
function baseOpts(): any { const o: any = {}; for (const kv of (process.env.P9BASE || "resolve=info,iters=30").split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = /^[\d.]+$/.test(v) ? Number(v) : v; } return o; }
export interface Runner { pol: E.Policy; events: E.Ev[]; hooks?: E.Hooks }
// realised = the "world" the policy lives in (real outcomes, or a model scenario): rollouts keep its finished games.
export const optsOf = (spec: string) => { const o: any = {}; for (const kv of spec.split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = /^-?[\d.]+$/.test(v) ? Number(v) : v === "false" ? false : v === "true" ? true : v; } return o; };
export const p11Base = (b8: boolean): E.Policy => ({ ...POL.P8, name: "P10base", index: b8 ? { resolve: "tip", iters: 100, slot: "roll" } : { resolve: "info", iters: 30, slot: "roll" } });
// onRace: research probe on P10 races (research/lprobe.ts; observe only)
export function runner(name: string, tw: E.TeamWeek, seed: number, realised: { actual: Float64Array; played: Uint8Array }, opp?: OppSource | null, r?: () => number,
  onRace?: (x: RaceInfo) => void): Runner {
  const pol = policy(name);
  const events = E.buildEvents(tw, pol.chain);
  let hooks: E.Hooks | undefined;
  if (pol.rollout) {
    const base: E.Policy = { ...POL.P2LA, eps: pol.eps, cutoff: pol.cutoff, holdYield: pol.holdYield, legacyBugs: pol.legacyBugs }; // (all policies here are lockAware)
    hooks = E.rolloutHooks(tw, base, events, pol.rollout.objective, pol.rollout.K, pol.rollout.margin, seed, realised);
  }
  // P9 base inside rollouts: env P9BASE = IndexOpts overrides for the base (default: the current prices, no re-solve)
  if (name === "P9b") hooks = indexRolloutHooks(tw, { ...pol, name: "P8base", index: { ...pol.index!, slot: "roll" } }, events, Number(process.env.KB || 50), seed, realised);
  else if (/^P9/.test(name)) hooks = indexRolloutHooks(tw, { ...pol, name: "P8base", index: { ...pol.index!, resolve: "never", ...baseOpts(), slot: "roll" } }, events, KS, seed, realised);
  if (/^P10/.test(name)) {
    const o: any = name === "P10c" ? { ...P10C_OPTS } : {};
    for (const kv of (name.match(/^P10x:(.*)$/)?.[1] ?? "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); o[k] = /^-?[\d.]+$/.test(v) ? Number(v) : v === "false" ? false : v === "true" ? true : v; }
    const b8 = (o.base ?? (name === "P10b" || name === "P10c" ? "P8" : "P8f")) === "P8"; delete o.base;
    // rseed=N: the race's random stream rng(seed ^ N) instead of rng(seed ^ 0x3c6ef372) (Monte-Carlo noise baseline);
    // cseed=N: the confirmation's stream rng(seed ^ N) instead of rng(seed ^ 0x2545f491)
    const rseed = o.rseed, cseed = o.cseed; delete o.rseed; delete o.cseed;
    const base: E.Policy = { ...POL.P8, name: "P10base", index: b8 ? { resolve: "tip", iters: 100, slot: "roll" } : { resolve: "info", iters: 30, slot: "roll" } };
    hooks = p10Hooks(tw, base, events, seed, realised, o as P10Opts, undefined, {
      ...(rseed !== undefined ? { r: E.rng(seed ^ Number(rseed)) } : {}), ...(cseed !== undefined ? { rc: E.rng(seed ^ Number(cseed)) } : {}), onRace });
  }
  if (/^P11/.test(name)) hooks = p11Hooks(tw, P11_TOP, p11Base(/^P11b/.test(name)), events, seed, realised, opp ?? null, optsOf(name.match(/^P11b?:(.*)$/)?.[1] ?? "") as P11Opts, r);
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
