// Which decision engine the live app uses. Default "p7h" = the backtested live algorithm (POLICY + start/lock
// simulations), unchanged. Set env LOCKIN_ENGINE or "engine" in ~/.sleeper-lockin/config.json to switch:
//   p7h: rule P2 (lockAware, holdYield, phase-1 fixes, legacy held-score tie-break) + start & lock rollouts
//   p8 : Lagrangian index policy (lib/engine/p8.ts), prices re-solved at every tip-off; no rollouts
//   p9 : P8 + rollouts over the index decision and its closest alternatives
//   p10: P8 + one complete decision per tip-off raced by rollouts (lib/engine/p10.ts), continuations played by P8f
//   p10b: decisions by P10 with continuations played by P8 (~5x the decision cost of p10): the plan's start/sit and
//         hold/lock/let-go at every tip-off, the hold/lock/bench calls (advise decisions, notifier) and replay. Mass
//         simulations (projections, Waivers, Matchups/league, IR, lock cut-offs, the decision options' expected points)
//         stay on POLICY exactly as with p7h (same numbers, shared cache entries).
//   p10c: p10b + the race's acceptance fix (task L, REPORT "P10b acceptance fix"): the race's best challenger is
//         re-scored against P8's decision on a fresh confirmation batch (P10C_OPTS in lib/engine/p10.ts); otherwise
//         exactly p10b (decision-only, mass simulations on POLICY with p7h's cache entries)
//   p10b-full: the old p10b - the same decisions in the plan and replay, every mass simulation on P8f (5-20x slower
//         views), hold/lock/bench calls by the options' P8f simulations
// Mass simulations (projections, waivers, league, IR, cut-offs, decision rollouts) use the fast variant of the engine's
// rule (p7h, p10b: POLICY; p8/p9/p10/p10b-full: P8f, prices re-solved only after new results) - full P8 is ~35x the
// cost of POLICY per simulated week (research/REPORT.md, Engine v2 Phase 2).
// Objective (env LOCKIN_OBJECTIVE or "objective" in config.json): "points" (default, unchanged) or "win" = P11 (Phase
// 5, lib/engine/p11.ts): the race scores continuations by points + beta * P(beat this week's opponent), the opponent
// simulated as a human (lib/engine/human.ts) from his Sleeper state (lib/live/opponent.ts). Only the race engines
// (p10, p10b) can play for the win; with another engine "win" is ignored (warning).
import fs from "fs";
import os from "os";
import path from "path";
import * as E from "../engine/core";
import { indexRolloutHooks } from "../engine/p8";
import { p10Hooks, P10C_OPTS, type P10Opts } from "../engine/p10";
import { p11Hooks, type OppSource, type P11Opts } from "../engine/p11";
import { POLICY } from "./week";
import { liveRacePool } from "./racepool";

export type EngineName = "p7h" | "p8" | "p9" | "p10" | "p10b" | "p10c" | "p10b-full";
export const ENGINES: EngineName[] = ["p7h", "p8", "p9", "p10", "p10b", "p10c", "p10b-full"];
export const DEFAULT_ENGINE: EngineName = "p7h";

export type Objective = "points" | "win";
export const DEFAULT_OBJECTIVE: Objective = "points";
let memo: { at: number; name: EngineName; objective: Objective; raceWorkers: boolean } | null = null;
function config(): { name: EngineName; objective: Objective; raceWorkers: boolean } {
  if (memo && Date.now() - memo.at < 30e3) return memo;
  let name = DEFAULT_ENGINE, objective = DEFAULT_OBJECTIVE, raceWorkers = true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.LOCKIN_CONFIG_DIR || path.join(os.homedir(), ".sleeper-lockin"), "config.json"), "utf8"));
    if (cfg?.engine) name = parseEngine(String(cfg.engine));
    if (cfg?.objective) objective = parseObjective(String(cfg.objective));
    if (cfg?.raceWorkers !== undefined && Number(cfg.raceWorkers) === 0) raceWorkers = false;
  } catch { /* no config: default */ }
  memo = { at: Date.now(), name, objective, raceWorkers };
  return memo;
}
// env wins over the config file; unknown values fall back to the default (with a warning). Re-read every 30 s.
export function engineName(): EngineName {
  const env = process.env.LOCKIN_ENGINE;
  if (env) return parseEngine(env);
  if (typeof window !== "undefined") return DEFAULT_ENGINE;
  return config().name;
}
export function objectiveName(): Objective {
  const env = process.env.LOCKIN_OBJECTIVE;
  if (env) return parseObjective(env);
  if (typeof window !== "undefined") return DEFAULT_OBJECTIVE;
  return config().objective;
}
// The races (p10 / p10b) play their continuations on worker threads (lib/live/racepool.ts: same decisions, faster) unless
// "raceWorkers": 0 in config.json (re-read every 30 s, no restart) or env LOCKIN_RACE_WORKERS=0 / LOCKIN_NO_WORKERS.
export function raceOnWorkers(): boolean {
  if (typeof window !== "undefined") return false;
  return config().raceWorkers;
}
export function parseObjective(s: string): Objective {
  const v = s.trim().toLowerCase();
  if (v === "points" || v === "win") return v;
  console.warn(`[engine] unknown objective "${s}", using ${DEFAULT_OBJECTIVE}`);
  return DEFAULT_OBJECTIVE;
}
// the race engines (P10 complete decisions); p10b, p10c and p10b-full race with P8 continuations; p10c confirms
const RACE: EngineName[] = ["p10", "p10b", "p10c", "p10b-full"];
const p8Race = (e: EngineName) => e === "p10b" || e === "p10c" || e === "p10b-full";
// the decision-only race engines: mass simulations stay on POLICY
const split = (e: EngineName) => e === "p10b" || e === "p10c";
// playing for the win needs a race engine
export function winActive(e: EngineName = engineName(), o: Objective = objectiveName()): boolean {
  if (o !== "win") return false;
  if (RACE.includes(e)) return true;
  if (!warned) { console.warn(`[engine] objective "win" needs engine p10 or p10b (engine is ${e}): playing for points`); warned = true; }
  return false;
}
let warned = false;
// P11 settings, chosen by validation (REPORT "Engine v2 - Phase 5"): beta = 1000 points per unit of win probability
// (1 pp of win probability = 10 pts; w_pts = 1/1000), phased in over the last 3 game days of the week, risk dial on
export const WIN_OPTS: P11Opts = { beta: 1000, sched: "late", lateDays: 3 };
export function parseEngine(s: string): EngineName {
  const v = s.trim().toLowerCase();
  if ((ENGINES as string[]).includes(v)) return v as EngineName;
  console.warn(`[engine] unknown engine "${s}", using ${DEFAULT_ENGINE}`);
  return DEFAULT_ENGINE;
}
export function resetEngineCache() { memo = null; warned = false; }

export const P8_POLICY: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100 } };
export const P8F_POLICY: E.Policy = { name: "P8f", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "info", iters: 30 } };

// the policy that makes the actual decisions (plan, replay)
export function decisionPolicy(e: EngineName = engineName()): E.Policy { return e === "p7h" ? POLICY : P8_POLICY; }
// the policy that plays out simulated weeks (projections, waivers, league, IR, cut-offs, decision rollouts)
export function simPolicy(e: EngineName = engineName()): E.Policy { return e === "p7h" || split(e) ? POLICY : { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "sim", fresh: true } }; }
// p10b: the advice's hold / lock / bench call for each held score is the engine's own decision at the next tip-off
// (the plan's first step), not the best of the options' quick simulations (those play the rest of the week by POLICY
// and are shown for information)
export function engineDecidesHolds(e: EngineName = engineName()): boolean { return split(e); }
// the race engines replay a week in minutes (a race at every tip-off): the notifier precomputes last week's replay
export function replayIsSlow(e: EngineName = engineName()): boolean { return RACE.includes(e); }

// P10 / P10b: raced complete decisions, continuations played by P8f / P8 on their own price state (K is not used: the
// number of rollouts is adaptive). The races' continuations run on worker threads when available (lib/live/racepool.ts;
// identical decisions; the race ~7x faster on 12 workers), else on this thread.
const raceBase = (e: EngineName): E.Policy => p8Race(e) ? { ...P8_POLICY, index: { ...P8_POLICY.index!, slot: "roll" } } : { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } };
// Measurement knob (not for live use): env LOCKIN_RACE_KMAX = the race's maximum number of scenarios (default 256); when
// set, the decision results get their own cache entries (engineTag "+kMax=N").
const raceKMax = () => { const k = Number(process.env.LOCKIN_RACE_KMAX); return k > 0 ? k : undefined; };
const raceOpts = (e: EngineName): P10Opts => { const k = raceKMax(); return { ...(e === "p10c" ? P10C_OPTS : {}), ...(k ? { kMax: k } : {}) }; };
const p10 = (tw: E.TeamWeek, events: E.Ev[], seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName) =>
  p10Hooks(tw, raceBase(e), events, seed, real, raceOpts(e), undefined, { pool: raceOnWorkers() ? liveRacePool : null });
// Hooks for the start decisions of the plan: p7h start/sit simulations; p8 none (the index policy decides);
// p9 rollouts over the index decision played by P8f; p10 / p10b / p10b-full raced complete decisions.
// With objective "win" (race engines) and an opponent: P11 (the race plays for the win against the opponent's distribution).
export function planHooks(tw: E.TeamWeek, events: E.Ev[], K: number, seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName = engineName(), opp?: OppSource | null): E.Hooks | undefined {
  if (opp && winActive(e)) return p11Hooks(tw, P8_POLICY, raceBase(e), events, seed, real, opp, { ...WIN_OPTS, ...raceOpts(e) }, undefined, raceOnWorkers() ? liveRacePool : null);
  if (e === "p7h") return E.startRolloutHooks(tw, POLICY, events, K, seed, real);
  if (e === "p9") return indexRolloutHooks(tw, { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } }, events, K, seed, real);
  if (RACE.includes(e)) return p10(tw, events, seed, real, e);
  return undefined;
}
// Hooks for replaying a finished week: p7h lock simulations (as before); p8 none; p9 index rollouts; race engines: races.
export function replayHooks(tw: E.TeamWeek, events: E.Ev[], K: number, seed: number, real: { actual: Float64Array; played: Uint8Array }, e: EngineName = engineName()): E.Hooks | undefined {
  if (e === "p7h") return E.rolloutHooks(tw, POLICY, events, "points", K, 12, seed, real);
  if (e === "p9") return indexRolloutHooks(tw, { ...P8F_POLICY, index: { ...P8F_POLICY.index!, slot: "roll" } }, events, K, seed, real);
  if (RACE.includes(e)) return p10(tw, events, seed, real, e);
  return undefined;
}
// what cache fingerprints add: nothing for the default engine and objective (so their fingerprints, and cached results,
// are unchanged); "+win" when playing for the win (the opponent's state is in the views' fingerprints already).
// engineTag: for results that contain decisions (advise, replay). p10b's is "p10b+sim:p7h", never the "p10b" that the
// old all-P8f p10b (now p10b-full, tag "p10b-full") wrote.
export function engineTag(e: EngineName = engineName()): string | undefined {
  const w = winActive(e); const k = RACE.includes(e) ? raceKMax() : undefined; const id = (split(e) ? `${e}+sim:p7h` : e) + (k ? `+kMax=${k}` : "");
  return e === DEFAULT_ENGINE && !w ? undefined : w ? `${id}+win` : id;
}
// simTag: for results of mass simulations only (projections, Waivers, Matchups/league, IR). They depend on simPolicy
// alone, so an engine that simulates with POLICY (p7h, p10b) shares the default's fingerprints and cache entries.
export function simTag(e: EngineName = engineName()): string | undefined {
  return simPolicy(e) === POLICY ? undefined : engineTag(e);
}
