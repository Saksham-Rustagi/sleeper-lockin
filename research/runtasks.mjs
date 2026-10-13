// Run a research bundle once per TEAM-week in parallel (finer-grained than runpar.mjs, for expensive per-team jobs).
// usage: node research/runtasks.mjs <bundle.cjs> <outPrefix> [mode] [KEY=VAL ...]
//   runs: node <bundle> <week> <rid> research/out/<outPrefix>_<week>_<rid>.json [mode]   for every team-week
//   env WEEKS=a-b limits weeks, PAR (default 13) parallel processes, TASKS=w:rid[:PLAYERS],... explicit task list
//   (PLAYERS is passed to the task as env PLAYERS, '+'-separated). Existing outputs are skipped (resumable).
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const [bundle, prefix, mode = "", ...kv] = process.argv.slice(2);
const env = { ...process.env, SEASON: process.env.SEASON || path.resolve("research/data/season.json") };
for (const x of kv) { const i = x.indexOf("="); env[x.slice(0, i)] = x.slice(i + 1); }
const S = JSON.parse(fs.readFileSync(env.SEASON, "utf8"));
const [a, b] = (env.WEEKS || "1-23").split("-").map(Number); const PAR = Number(env.PAR || 13);
let tasks = [];
if (env.TASKS) tasks = env.TASKS.split(",").map((t) => { const [w, r, pl] = t.split(":"); return { w: Number(w), r, pl: pl ? pl.split("+").join(",") : undefined }; });
else for (const W of S.weeks) if (W.week >= a && W.week <= (b ?? a)) for (const r of Object.keys(W.teams)) tasks.push({ w: W.week, r });
fs.mkdirSync("research/out", { recursive: true });
const outOf = (t) => `research/out/${prefix}_${t.w}_${t.r}.json`;
tasks = tasks.filter((t) => !fs.existsSync(outOf(t)));
const total = tasks.length; let running = 0, done = 0, failed = 0; const t0 = Date.now();
await new Promise((resolve) => {
  if (!tasks.length) return resolve();
  const next = () => {
    while (running < PAR && tasks.length) {
      const t = tasks.shift(); running++;
      const args = [bundle, String(t.w), t.r, outOf(t)]; if (mode) args.push(mode);
      const p = spawn(process.execPath, args, { env: t.pl ? { ...env, PLAYERS: t.pl } : env, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
      p.on("exit", (code) => {
        running--; done++; if (code) { failed++; console.error(`w${t.w} r${t.r} FAILED (${code}): ${err.slice(-800)}`); }
        if (done % 10 === 0 || done === total) console.log(`${done}/${total} done, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        if (!tasks.length && !running) resolve(); else next();
      });
    }
  };
  next();
});
console.log(`${done} tasks, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
