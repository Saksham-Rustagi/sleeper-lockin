// Task O switches (research/REPORT.md "Opportunity alerts"), both DEFAULT OFF, in ~/.sleeper-lockin/config.json:
//   "minutesOverride": true    flagged players (an absent teammate's minutes, a minutes surge) get the minutes-based
//                              estimate instead of Sleeper's per-game projection in every live simulation (projections,
//                              start/sit, Waivers, IR, league); labelled "projection override: ..." in the API / UI
//   "opportunityAlerts": true  the notifier sends "Opportunity: ..." reminders (lib/live/oppscan.ts)
// Env LOCKIN_MINUTES_OVERRIDE / LOCKIN_OPPORTUNITY_ALERTS = 1 / 0 win over the file. Re-read every 30 s (no restart).
// The current overrides' hash goes into every cache fingerprint while the override is on (lib/live/cache.ts), so an
// override change recomputes cached results, and with the option off fingerprints are unchanged.
import fs from "fs";
import os from "os";
import path from "path";

type Opt = "minutesOverride" | "opportunityAlerts";
const ENV: Record<Opt, string> = { minutesOverride: "LOCKIN_MINUTES_OVERRIDE", opportunityAlerts: "LOCKIN_OPPORTUNITY_ALERTS" };
let memo: { at: number; cfg: Record<string, unknown> } | null = null;
export function optionOn(name: Opt): boolean {
  if (typeof window !== "undefined") return false;
  const env = process.env[ENV[name]];
  if (env !== undefined && env !== "") return env === "1" || env.toLowerCase() === "true";
  if (!memo || Date.now() - memo.at > 30e3) {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(process.env.LOCKIN_CONFIG_DIR || path.join(os.homedir(), ".sleeper-lockin"), "config.json"), "utf8")); } catch { /* defaults */ }
    memo = { at: Date.now(), cfg };
  }
  return memo.cfg[name] === true;
}
export function resetOptionCache() { memo = null; overrideHash = null; }

// hash of the overrides in force (set by lib/live/oppscan.ts minutesOverrides); null when off or none loaded
let overrideHash: string | null = null;
export function setOverrideHash(h: string | null) { overrideHash = h; }
export function overrideTag(): string | null { return optionOn("minutesOverride") ? overrideHash ?? "none" : null; }
