// Task H, second batch (replaces the tail of research/h_pipeline.mjs, which was stopped after stage B to fit the time
// budget), one stage at a time, <= 10 processes.
//   WAIT : until stage B (h/r25b, 120 team-weeks) has finished
//   D2   h/r24b : 2024-25 real, league A, P10b, weeks 2,6,10,14,18,22 x rids 1-5 = 30 team-weeks, FRESH=96
//   LM   : bound looseness on medium random weeks (research/h_lagmed.ts), exact optimum by brute force
//   M10  h/m10  : model scenarios, 46 gap-study team-weeks x 1, P10b (decomposition of the live engine's bound gap)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const S24 = path.resolve("research/data/season2024.json");
const gap46 = "10:10,10:5,11:1,11:6,12:2,12:7,13:3,13:8,14:4,14:9,15:10,15:5,16:1,16:6,17:2,17:7,18:3,18:8,19:4,19:9,1:1,1:6,20:10,20:5,21:1,21:6,22:2,22:7,23:3,23:8,2:2,2:7,3:3,3:8,4:4,4:9,5:10,5:5,6:1,6:6,7:2,7:7,8:3,8:8,9:4,9:9";
const tasks = (weeks, rids) => weeks.flatMap((w) => rids.map((r) => `${w}:${r}`)).join(",");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const first = process.argv[2] || "WAIT"; let on = false;
const stages = {
  WAIT: async () => { while (fs.readdirSync("research/out/h").filter((f) => /^r25b_\d+_\d+\.json$/.test(f)).length < 120) await new Promise((r) => setTimeout(r, 20000)); },
  D2: () => spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/htrace.cjs", "h/r24b", "real", "POLS=P10b", "FRESH=96", `SEASON=${S24}`, `TASKS=${tasks([2, 6, 10, 14, 18, 22], [1, 2, 3, 4, 5])}`, "PAR=10"], { stdio: "inherit" }),
  LM: async () => {
    const cfg = [[2, 3, 200], [2, 4, 150], [3, 4, 100], [3, 5, 50], [3, 6, 24], [4, 6, 24], [4, 7, 8], [2, 5, 100], [3, 5, 50]]; // [slots, players, trials]
    const out = fs.openSync("research/out/h/lagmed.jsonl", "a");
    await Promise.all(cfg.map(([s, p, n], i) => new Promise((res) => {
      const c = spawn(process.execPath, ["research/dist/h_lagmed.cjs", String(s), String(p), String(n), String(11 + i)], { stdio: ["ignore", out, "inherit"] });
      c.on("exit", res);
    })));
  },
  M10: () => spawnSync(process.execPath, ["research/runtasks.mjs", "research/dist/htrace.cjs", "h/m10", "model", "POLS=P10b", "NSC=1", `TASKS=${gap46}`, "PAR=10"], { stdio: "inherit" }),
};
for (const [name, fn] of Object.entries(stages)) {
  if (name === first) on = true; if (!on) continue;
  const t0 = Date.now(); log(`stage ${name} start`); await fn(); log(`stage ${name} done in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
