// Task O (c) pipeline, as executed: alert decisions + scoring, the Waivers search with the minutes override, scoring of
// its picks and of every evaluated move (and of the raw search's moves). PAR 10. Resumable (skips finished outputs).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
const sh = (args) => { console.log(new Date().toISOString(), args.join(" ")); const r = spawnSync(process.execPath, args, { stdio: "inherit" }); if (r.status) throw new Error(`failed: ${args.join(" ")}`); };
const run = (pref) => {
  const fs_ = fs.readdirSync("research/out/o").filter((f) => new RegExp(`^${pref}_runs\\d+\\.json$`).test(f)).sort();
  const f = fs_[fs_.length - 1]; if (!f) return;
  const jobs = JSON.parse(fs.readFileSync(`research/out/o/${f}`, "utf8")).filter((j) => !fs.existsSync(j.args[2]));
  const left = `research/out/o/${pref}_left.json`; fs.writeFileSync(left, JSON.stringify(jobs));
  sh(["research/o_run.mjs", left]);
};
process.env.PAR = "10";
// 1) alerts -> decisions -> P8 / hindsight scores
sh(["research/dist/o_value.cjs", "build", "research/out/o/v25_alerts.json", "o25al"]); run("o25al");
// 2) the Waivers page's search with the override (task W method policy, N = 300)
sh(["research/w_run.mjs", "decide", "o25ov", "2025", "METHODS=policy", `OVR=${process.cwd()}/research/out/o/v25_alerts.json`, "PAR=10"]);
// 3) picks (P8 + hindsight) and all moves (hindsight) of both searches
sh(["research/dist/o_value.cjs", "moves", "o25ov", "o25ovm"]); run("o25ovm");
sh(["research/dist/o_value.cjs", "moves", "w25", "o25rawm"]); run("o25rawm");
console.log(new Date().toISOString(), "pipeline done");
