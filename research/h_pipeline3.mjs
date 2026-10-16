// Task H, third batch: after research/h_pipeline2.mjs has finished, the other half of the 2024-25 P10b sample
// (league A rids 6-10, weeks 2,6,10,14,18,22 = 30 team-weeks; together with D2 = the 60 of the original plan).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const S24 = path.resolve("research/data/season2024.json");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
while (!fs.readFileSync("research/out/h/pipeline2.log", "utf8").includes("stage M10 done")) await new Promise((r) => setTimeout(r, 20000));
const tasks = [2, 6, 10, 14, 18, 22].flatMap((w) => [6, 7, 8, 9, 10].map((r) => `${w}:${r}`)).join(",");
const t0 = Date.now(); log("stage D3 start");
spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/htrace.cjs", "h/r24b", "real", "POLS=P10b", "FRESH=96", `SEASON=${S24}`, `TASKS=${tasks}`, "PAR=10"], { stdio: "inherit" });
log(`stage D3 done in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
