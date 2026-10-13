// Policies P2LA / P2LAH / P7H built exactly as research/backtest.ts builds them (same flags, same hook stack, same
// seeds for real outcomes), so instrumented runs reproduce the backtest numbers.
import * as E from "./engine";

const K = Number(process.env.K || 200), KS = Number(process.env.KS || K);
export const POL: Record<string, E.Policy> = {
  P2LA: { name: "P2LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P2LAH: { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true },
  P7H: { name: "P7H", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true, rollout: { objective: "points", K, margin: 12 } },
};
export interface Runner { pol: E.Policy; events: E.Ev[]; hooks?: E.Hooks }
// realised = the "world" the policy lives in (real outcomes, or a model scenario): rollouts keep its finished games.
export function runner(name: string, tw: E.TeamWeek, seed: number, realised: { actual: Float64Array; played: Uint8Array }): Runner {
  const pol = POL[name]; if (!pol) throw new Error("unknown policy " + name);
  const events = E.buildEvents(tw, pol.chain);
  let hooks: E.Hooks | undefined;
  if (pol.rollout) {
    const base: E.Policy = { ...POL.P2LA, eps: pol.eps, cutoff: pol.cutoff, holdYield: pol.holdYield }; // (all policies here are lockAware)
    hooks = E.rolloutHooks(tw, base, events, pol.rollout.objective, pol.rollout.K, pol.rollout.margin, seed, realised);
  }
  if (name === "P7H") hooks = E.startRolloutHooks(tw, { ...POL.P2LA, cutoff: pol.cutoff, holdYield: pol.holdYield }, events, KS, seed, realised, hooks);
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
