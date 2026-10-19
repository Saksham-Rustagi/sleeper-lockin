// Task O runner: research/o_val.cjs jobs in parallel (PAR, default 8).
//   node research/o_run.mjs <jobs.json>   jobs = [{ args: [...], env: {...}, out?: "log path" }]
//   node research/o_run.mjs tune          the 2024-25 tuning grid (research/out/o/tune24_*.json)
import { spawn } from "node:child_process";
import fs from "node:fs";
const BUNDLE = "research/dist/o_val.cjs";
const arg = process.argv[2];
let jobs;
if (arg === "tune") {
  const grid = { rk30: { rateK: 30 }, rk60: { rateK: 60 }, rk120: { rateK: 120 }, rk240: { rateK: 240 }, prioronly: { bTrend: 0, bWo: 0 }, trendonly: { bPrior: 0, bWo: 0 }, nowo: { bWo: 0 } };
  jobs = Object.entries(grid).map(([k, P]) => ({ args: ["absences", "2024", `research/out/o/tune24_${k}.json`], env: { P: JSON.stringify(P) } }));
} else jobs = JSON.parse(fs.readFileSync(arg, "utf8"));
const PAR = Number(process.env.PAR || 8); let running = 0, done = 0, failed = 0; const t0 = Date.now();
await new Promise((resolve) => {
  const next = () => {
    while (running < PAR && jobs.length) {
      const j = jobs.shift(); running++;
      const p = spawn(process.execPath, ["--max-old-space-size=4000", j.bundle || BUNDLE, ...j.args], { env: { ...process.env, ...(j.env || {}) }, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
      p.on("exit", (code) => {
        running--; done++; if (code) { failed++; console.error(`${j.args.join(" ")} FAILED ${code}: ${err.slice(-1500)}`); } else if (j.out) fs.writeFileSync(j.out, err);
        console.log(`${done} done, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s: ${j.args.join(" ")} ${err.trim().split("\n").slice(-1)[0] ?? ""}`);
        if (!jobs.length && !running) resolve(); else next();
      });
    }
  };
  if (!jobs.length) resolve(); else next();
});
