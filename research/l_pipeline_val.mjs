// Task L validation: P10c (P10C_OPTS fixed before this run) on the real outcomes of 2025-26 (230) and 2024-25 (690),
// with task H's runner-up re-evaluation (FRESH=96). Baselines: the published P10b runs s10 / s24p10b.
// usage: node research/launch_detached.mjs research/out/l/val.log research/l_pipeline_val.mjs [v25|v24 ...]
import { spawnSync } from "node:child_process";
const stages = process.argv.slice(2).length ? process.argv.slice(2) : ["v25", "v24"];
const run = (args) => { console.log(new Date().toISOString(), args.join(" ")); spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/p10run.cjs", ...args], { stdio: "inherit" }); };
for (const s of stages) {
  if (s === "v25") run(["l/v25", "", "POLS=P10c", "FRESH=96", "PAR=12"]);
  if (s === "v24") run(["l/v24", "", "POLS=P10c", "FRESH=96", "SEASON=research/data/season2024.json", "PAR=12"]);
}
console.log(new Date().toISOString(), "done");
