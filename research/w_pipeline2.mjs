// Task W follow-up (exploratory policyA, added after the first results): starts when research/w_pipeline.mjs is done.
// usage: node research/launch_detached.mjs research/scratch/w_pipeline2.log research/w_pipeline2.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const B = "W_BUNDLE=research/dist/waivers_bt2.cjs";
while (!fs.readFileSync("research/scratch/w_pipeline.log", "utf8").includes("PIPELINE DONE")) await new Promise((r) => setTimeout(r, 30e3));
const steps = [
  ["decide", "w25a", "2025", "METHODS=policyA", B],
  ["decide", "w24a", "2024", "METHODS=policyA", B],
  ["score", "w25", "2025", "DEC=w25,w25p8f,w25a", B],
  ["score", "w24", "2024", "DEC=w24,w24p8f,w24a", B],
  ["score2", "w25", "2025", B],
  ["score2", "w24", "2024", B],
];
for (let i = 0; i < steps.length; i++) {
  const t0 = Date.now(); console.log(`[${new Date().toISOString()}] step ${i}: ${steps[i].join(" ")}`);
  const r = spawnSync(process.execPath, ["research/w_run.mjs", ...steps[i]], { stdio: "inherit" });
  console.log(`[${new Date().toISOString()}] step ${i} exit ${r.status} in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
console.log("PIPELINE2 DONE");
