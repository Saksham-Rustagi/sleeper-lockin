// Run a research bundle once per week in parallel and collect the output files.
// usage: node research/runpar.mjs <bundle.cjs> <outPrefix> <policies> [K] [extra env as KEY=VAL ...]
//   runs: node <bundle> <w> <w> <policies> research/out/<outPrefix>_<w>.json <K>   for w = 1..23 (WEEKS=a-b to limit)
// Uses SEASON=research/data/season.json unless set. Up to PAR (default 13) processes at once.
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const [bundle, prefix, pols, K = "200", ...kv] = process.argv.slice(2);
const env = { ...process.env, SEASON: process.env.SEASON || path.resolve("research/data/season.json") };
for (const x of kv) { const i = x.indexOf("="); env[x.slice(0, i)] = x.slice(i + 1); }
const [a, b] = (env.WEEKS || "1-23").split("-").map(Number); const PAR = Number(env.PAR || 13);
fs.mkdirSync("research/out", { recursive: true });
const weeks = []; for (let w = a; w <= (b ?? a); w++) weeks.push(w);
let running = 0, done = 0, failed = 0; const t0 = Date.now();
await new Promise((resolve) => {
  const next = () => {
    while (running < PAR && weeks.length) {
      const w = weeks.shift(); running++;
      const p = spawn(process.execPath, [bundle, String(w), String(w), pols, `research/out/${prefix}_${w}.json`, K], { env, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
      p.on("exit", (code) => { running--; done++; if (code) { failed++; console.error(`week ${w} FAILED (${code}): ${err.slice(-800)}`); } if (!weeks.length && !running) resolve(); else next(); });
    }
  };
  next();
});
console.log(`${done} weeks, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
