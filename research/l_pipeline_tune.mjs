// Task L tuning data (model scenarios): P10b + confirmation probe (research/l_tune.ts) on
//  t25: 2025-26 gap46 team-weeks x 2 model worlds;  t24: 2024-25 league B (rids 13, 18) x 23 weeks x 1 model world.
// usage: node research/launch_detached.mjs research/out/l/tune.log research/l_pipeline_tune.mjs
import { spawnSync } from "node:child_process";
const gap46 = "10:10,10:5,11:1,11:6,12:2,12:7,13:3,13:8,14:4,14:9,15:10,15:5,16:1,16:6,17:2,17:7,18:3,18:8,19:4,19:9,1:1,1:6,20:10,20:5,21:1,21:6,22:2,22:7,23:3,23:8,2:2,2:7,3:3,3:8,4:4,4:9,5:10,5:5,6:1,6:6,7:2,7:7,8:3,8:8,9:4,9:9";
const t24 = Array.from({ length: 23 }, (_, i) => [`${i + 1}:13`, `${i + 1}:18`]).flat().join(",");
const run = (args) => { console.log(new Date().toISOString(), args.join(" ")); spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/l_tune.cjs", ...args], { stdio: "inherit" }); };
run(["l/t25", "", "NW=2", "FRESH=512", "GATE=0.25", `TASKS=${gap46}`, "PAR=12"]);
run(["l/t24", "", "NW=1", "FRESH=512", "GATE=0.25", "SEASON=research/data/season2024.json", `TASKS=${t24}`, "PAR=12"]);
console.log(new Date().toISOString(), "done");
