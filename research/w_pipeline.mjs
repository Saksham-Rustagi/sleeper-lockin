// Task W pipeline: the whole waiver backtest, one step after another (one heavy job at a time, 12 processes).
// usage: node research/launch_detached.mjs research/scratch/w_pipeline.log research/w_pipeline.mjs [fromStep]
import { spawnSync } from "node:child_process";
const steps = [
  ["decide", "w25", "2025", "METHODS=policy,ros,naive,policy2000"],
  ["decide", "w24", "2024", "METHODS=policy,ros,naive"],
  ["score", "w25", "2025", "DEC=w25"],
  ["score", "w24", "2024", "DEC=w24"],
  ["decide", "w25p8f", "2025", "METHODS=p8f", "SPLIT=team"],
  ["decide", "w24p8f", "2024", "METHODS=p8f", "SPLIT=team", "LEAGUES=0"],
  ["score", "w25", "2025", "DEC=w25,w25p8f"],
  ["score", "w24", "2024", "DEC=w24,w24p8f"],
];
const from = Number(process.argv[2] || 0);
for (let i = from; i < steps.length; i++) {
  const t0 = Date.now(); console.log(`[${new Date().toISOString()}] step ${i}: ${steps[i].join(" ")}`);
  const r = spawnSync(process.execPath, ["research/w_run.mjs", ...steps[i]], { stdio: "inherit" });
  console.log(`[${new Date().toISOString()}] step ${i} exit ${r.status} in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
console.log("PIPELINE DONE");
