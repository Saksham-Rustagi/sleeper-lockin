// Which decision engine the live app uses. Default "p7h" = the backtested live algorithm (POLICY + start/lock
// simulations), unchanged. Set env LOCKIN_ENGINE or "engine" in ~/.sleeper-lockin/config.json to switch:
//   p7h: rule P2 (lockAware, holdYield, phase-1 fixes, legacy held-score tie-break) + start & lock rollouts
//   p8 : Lagrangian index policy (lib/engine/p8.ts), prices re-solved at every tip-off; no rollouts
//   p9 : P8 + rollouts over the index decision and its closest alternatives
//   p10: P8 + one complete decision per tip-off raced by rollouts (lib/engine/p10.ts), continuations played by P8f
//   p10b: the same with continuations played by P8 (~5x the decision cost of p10)
// Mass simulations (projections, waivers, league, IR, cut-offs, decision rollouts) use the fast variant of the engine's
// rule (p7h: POLICY; p8/p9: P8f, prices re-solved only after new results) - full P8 is ~35x the cost of POLICY per
// simulated week (research/REPORT.md, Engine v2 Phase 2).
import fs from "fs";
import os from "os";
import path from "path";
import * as E from "../engine/core";
import { indexRolloutHooks } from "../engine/p8";
import { p10Hooks } from "../engine/p10";
import { POLICY } from "./week";

export type EngineName = "p7h" | "p8" | "p9" | "p10" | "p10b";
export const ENGINES: EngineName[] = ["p7h", "p8", "p9", "p10", "p10b"];
export const DEFAULT_ENGINE: EngineName = "p7h";

let memo: { at: number; name: EngineName } | null = null;
// env wins over the config file; unknown values fall back to the default (with a warning). Re-read every 30 s.
export function engineName(): EngineName {
  const env = process.env.LOCKIN_ENGINE;
  if (env) return parseEngine(env);
  if (typeof window !== "undefined") return DEFAULT_ENGINE;
  if (memo && Date.now() - memo.at < 30e3) return memo.name;
  let name = DEFAULT_ENGINE;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.LOCKIN_CONFIG_DIR || path.join(os.homedir(), ".sleeper-lockin"), "config.json"), "utf8"));
    if (cfg?.engine) name = parseEngine(String(cfg.engine));
  } catch { /* no config: default */ }
  memo = { at: Date.now(), name };
  return name;
}
export function parseEngine(s: string): EngineName {
  const v = s.trim().toLowerCase();
  if ((ENGINES as string[]).includes(v)) return v as EngineName;
  console.warn(`[engine] unknown engine "${s}", using ${DEFAULT_ENGINE}`);
  return DEFAULT_ENGINE;
}
export function resetEngineCache() { memo = null; }

export const P8_POLICY: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100 } };
export const P8F_POLICY: E.Policy = { name: "P8f", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "info", iters: 30 } };

// the policy that makes the actual decisions (plan, replay)
export function decisionPolicy(e: EngineName = engineName()): E.Policy { return e === "p7h" ? POLICY : P8_POLICY; }
// the policy that plays out simulated weeks (projections, waivers, league, IR, cut-offs, decision rollouts)
export function simPolicy(e: EngineName = engineName()): E.Policy { return e === "p7h" ? POLICY : { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "sim", fresh: true } }; }

// P10 / P10b: raced complete decisions, continuations played by P8f / P8 on their own price state (K is not used: the
// number of rollouts is adaptive)
const p10 = (tw: E.TeamWeek, events: E.Ev[], seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName) =>
  p10Hooks(tw, e === "p10b" ? { ...P8_POLICY, index: { ...P8_POLICY.index!, slot: "roll" } } : { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } }, events, seed, real);
// Hooks for the start decisions of the plan: p7h start/sit simulations; p8 none (the index policy decides);
// p9 rollouts over the index decision played by P8f; p10 / p10b raced complete decisions.
export function planHooks(tw: E.TeamWeek, events: E.Ev[], K: number, seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName = engineName()): E.Hooks | undefined {
  if (e === "p7h") return E.startRolloutHooks(tw, POLICY, events, K, seed, real);
  if (e === "p9") return indexRolloutHooks(tw, { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } }, events, K, seed, real);
  if (e === "p10" || e === "p10b") return p10(tw, events, seed, real, e);
  return undefined;
}
// Hooks for replaying a finished week: p7h lock simulations (as before); p8 none; p9 index rollouts; p10 / p10b races.
export function replayHooks(tw: E.TeamWeek, events: E.Ev[], K: number, seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName = engineName()): E.Hooks | undefined {
  if (e === "p7h") return E.rolloutHooks(tw, POLICY, events, "points", K, 12, seed, real);
  if (e === "p9") return indexRolloutHooks(tw, { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } }, events, K, seed, real);
  if (e === "p10" || e === "p10b") return p10(tw, events, seed, real, e);
  return undefined;
}
// what cache fingerprints add: nothing for the default engine (so its fingerprints, and cached results, are unchanged)
export function engineTag(e: EngineName = engineName()): EngineName | undefined { return e === DEFAULT_ENGINE ? undefined : e; }
