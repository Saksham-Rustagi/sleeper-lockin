// Old (pre-fix, HEAD~1) vs new engine bundles on the same tasks: outputs must be identical (timings ignored).
// usage: node research/scratch/oldnew.mjs   (bundles research/dist/<script>_old.cjs / _new.cjs)
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const SEASON = path.resolve("research/data/season.json");
const W = Object.keys(JSON.parse(fs.readFileSync(SEASON, "utf8")).weeks.find((w) => w.week === 9).teams);
const tasks = [
  ...[3, 9, 15].map((w) => ({ s: "p10run", args: [String(w), W[w % W.length]], env: { POLS: "P8;P8f;P9;P9b;P10", NSC: "2" } })),
  { s: "p10run", args: ["9", W[1]], env: { POLS: "P10b;P11", NSC: "0" } },
  { s: "p11run", args: ["9", W[2]], env: { POLS: "P10;P11:beta=300", M: "100" } },
  { s: "pregame", args: ["season", "9", W[3], "2"], env: { KMAX: "32", ROUND: "16", BUDGET_S: "100000", KEVAL: "30" }, outLast: true },
  { s: "gap", args: ["9", W[4]], env: { GAPPOLS: "P8,P8f", N: "20", N7: "2", ITERS: "20000" } },
];
fs.mkdirSync("research/scratch/oldnew", { recursive: true });
const run = (t, ver, i) => new Promise((res) => {
  const out = `research/scratch/oldnew/${t.s}_${i}_${ver}.json`;
  const args = t.outLast ? [...t.args, out] : [...t.args, out];
  const p = spawn(process.execPath, [`research/dist/${t.s}_${ver}.cjs`, ...args], { env: { ...process.env, SEASON, ...t.env }, stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 3000) err = err.slice(-3000); });
  p.on("exit", (code) => res({ out, code, err }));
});
const strip = (x) => JSON.stringify(x, (k, v) => (/^(ms|msFirst|msPrefix|msWeek|seconds|lineupSeconds|solveMs|t0wall)$|_ms$|Ms$/.test(k) ? undefined : v));
const jobs = tasks.flatMap((t, i) => ["old", "new"].map((ver) => ({ t, i, ver })));
const res = await Promise.all(jobs.map((j) => run(j.t, j.ver, j.i)));
for (let i = 0; i < tasks.length; i++) {
  const [o, n] = [res[2 * i], res[2 * i + 1]];
  if (o.code || n.code) { console.log(`${tasks[i].s} ${tasks[i].args.join(" ")}: FAILED old ${o.code} new ${n.code}\n${o.err.slice(-600)}\n${n.err.slice(-600)}`); continue; }
  const a = strip(JSON.parse(fs.readFileSync(o.out, "utf8"))), b = strip(JSON.parse(fs.readFileSync(n.out, "utf8")));
  let at = -1; if (a !== b) for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) { at = k; break; }
  console.log(`${tasks[i].s} ${tasks[i].args.join(" ")} ${JSON.stringify(tasks[i].env)}: ${a === b ? "IDENTICAL" : `DIFFER at char ${at}: old ...${a.slice(Math.max(0, at - 80), at + 80)}... new ...${b.slice(Math.max(0, at - 80), at + 80)}...`}`);
}
