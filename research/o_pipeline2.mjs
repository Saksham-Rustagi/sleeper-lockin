// Task O exploratory variant (after the pre-registration): the Waivers search with the "only raise" override (the live
// default: an override never lowers Sleeper's projection), its picks and moves scored like research/o_pipeline.mjs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const sh = (args) => { console.log(new Date().toISOString(), args.join(" ")); const r = spawnSync(process.execPath, args, { stdio: "inherit" }); if (r.status) throw new Error(`failed: ${args.join(" ")}`); };
const run = (pref) => {
  const f = fs.readdirSync("research/out/o").filter((x) => new RegExp(`^${pref}_runs\\d+\\.json$`).test(x)).sort().pop(); if (!f) return;
  const jobs = JSON.parse(fs.readFileSync(`research/out/o/${f}`, "utf8")).filter((j) => !fs.existsSync(j.args[2]));
  const left = `research/out/o/${pref}_left.json`; fs.writeFileSync(left, JSON.stringify(jobs)); sh(["research/o_run.mjs", left]);
};
process.env.PAR = "10";
const V = process.argv[2] || "o25ovr";
if (V === "o25ovr") sh(["research/w_run.mjs", "decide", "o25ovr", "2025", "METHODS=policy", `OVR=${process.cwd()}/research/out/o/v25_alerts_or.json`, "PAR=10"]);
// o25ovx: per-game max(Sleeper, override) = the live rule
else sh(["research/w_run.mjs", "decide", V, "2025", "METHODS=policy", `OVR=${process.cwd()}/research/out/o/v25_alerts.json`, "OVR_MAX=1", "PAR=10"]);
sh(["research/dist/o_value.cjs", "moves", V, V + "m"]); run(V + "m");
console.log(new Date().toISOString(), "pipeline 2 done");
