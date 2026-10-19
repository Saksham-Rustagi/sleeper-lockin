// Task W, rest of the run (replaces steps 5-7 of research/w_pipeline.mjs and research/w_pipeline2.mjs): waits for the
// running 2025-26 P8f decide step (pid argv[2]) to exit, then P8f on 2024-25 league A odd weeks (110 decisions, the
// time budget), the exploratory policyA decisions, real-outcome scoring of every new pick, secondary evaluators.
// usage: node research/launch_detached.mjs research/scratch/w_pipeline3.log research/w_pipeline3.mjs <pid>
import { spawnSync } from "node:child_process";
const pid = Number(process.argv[2]);
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
while (pid && alive()) await new Promise((r) => setTimeout(r, 30e3));
const B = "W_BUNDLE=research/dist/waivers_bt2.cjs";
const steps = [
  ["decide", "w25p8f", "2025", "METHODS=p8f", "SPLIT=team"], // (resumes: only missing team-weeks, if any)
  ["decide", "w25a", "2025", "METHODS=policyA", B],
  ["score", "w25", "2025", "DEC=w25,w25p8f,w25a", B],
  ["score2", "w25", "2025", B],
  ["decide", "w24p8f", "2024", "METHODS=p8f", "SPLIT=team", "LEAGUES=0", "WEEKLIST=1,3,5,7,9,11,13,15,17,19,21"],
  ["decide", "w24a", "2024", "METHODS=policyA", B],
  ["score", "w24", "2024", "DEC=w24,w24p8f,w24a", B],
  ["score2", "w24", "2024", B],
];
for (let i = 0; i < steps.length; i++) {
  const t0 = Date.now(); console.log(`[${new Date().toISOString()}] step ${i}: ${steps[i].join(" ")}`);
  const r = spawnSync(process.execPath, ["research/w_run.mjs", ...steps[i]], { stdio: "inherit" });
  console.log(`[${new Date().toISOString()}] step ${i} exit ${r.status} in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
console.log("PIPELINE3 DONE");
