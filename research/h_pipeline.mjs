// Task H analysis runs, one stage at a time (<= 10 processes; the machine is short on memory and disk).
// usage: node research/h_pipeline.mjs [firstStage]
//   A  h/r25  : 2025-26 real, all 230 team-weeks, P7H_LheldTie + P8 (traced, + hindsight + human lineups)
//   M8 h/m8   : model scenarios (gap-study seeds), 46 team-weeks x 100, P8 (decomposition identity check)
//   C  h/r24  : 2024-25 real, league A (rids 1-10), 230 team-weeks, P7H_LheldTie + P8
//   B  h/r25b : 2025-26 real, P10b (live engine), weeks 1,3,..,23 x 10 teams = 120, runner-up re-evaluated (FRESH=96)
//   D  h/r24b : 2024-25 real, P10b, league A weeks 2,6,10,14,18,22 = 60, FRESH=96
//   M7 h/m7   : model scenarios, 46 team-weeks x 10, P7H_LheldTie
import { spawnSync } from "node:child_process";
import path from "node:path";
const S24 = path.resolve("research/data/season2024.json");
const gap46 = "10:10,10:5,11:1,11:6,12:2,12:7,13:3,13:8,14:4,14:9,15:10,15:5,16:1,16:6,17:2,17:7,18:3,18:8,19:4,19:9,1:1,1:6,20:10,20:5,21:1,21:6,22:2,22:7,23:3,23:8,2:2,2:7,3:3,3:8,4:4,4:9,5:10,5:5,6:1,6:6,7:2,7:7,8:3,8:8,9:4,9:9";
const tasks = (weeks, rids) => weeks.flatMap((w) => rids.map((r) => `${w}:${r}`)).join(",");
const r10 = Array.from({ length: 10 }, (_, i) => i + 1);
const all23 = Array.from({ length: 23 }, (_, i) => i + 1);
const stages = [
  ["A", ["h/r25", "real", "POLS=P7H_LheldTie;P8"]],
  ["M8", ["h/m8", "model", "POLS=P8", "NSC=100", `TASKS=${gap46}`]],
  ["C", ["h/r24", "real", "POLS=P7H_LheldTie;P8", `SEASON=${S24}`, `TASKS=${tasks(all23, r10)}`]],
  ["B", ["h/r25b", "real", "POLS=P10b", "FRESH=96", `TASKS=${tasks(all23.filter((w) => w % 2), r10)}`]],
  ["D", ["h/r24b", "real", "POLS=P10b", "FRESH=96", `SEASON=${S24}`, `TASKS=${tasks([2, 6, 10, 14, 18, 22], r10)}`]],
  ["M7", ["h/m7", "model", "POLS=P7H_LheldTie", "NSC=10", `TASKS=${gap46}`]],
];
const first = process.argv[2] || "A"; let on = false;
for (const [name, args] of stages) {
  if (name === first) on = true; if (!on) continue;
  const t0 = Date.now(); console.log(`[${new Date().toISOString()}] stage ${name} start`);
  const r = spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/htrace.cjs", ...args, "PAR=10"], { stdio: "inherit" });
  console.log(`[${new Date().toISOString()}] stage ${name} done (exit ${r.status}) in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
