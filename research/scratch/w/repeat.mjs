// Repeat one livecost_g view N times (fresh cache each), each with a time limit: hang hunting.
// usage: node research/scratch/w/repeat.mjs <N> <limitSec> <view> [KEY=VAL ...] [--prof]
import { spawnSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, "../../.."); const W = path.join(root, "research/scratch/w");
const [N, lim, view, ...rest] = process.argv.slice(2); const prof = rest.includes("--prof");
const env = { ...process.env, LOCKIN_ENGINE: "p10b", LOCKIN_CONFIG_DIR: path.join(W, "cfg"), LOCKIN_SIMWORKER: path.join(root, "research/dist/simworker_w.cjs") };
for (const kv of rest.filter((x) => x.includes("="))) { const i = kv.indexOf("="); env[kv.slice(0, i)] = kv.slice(i + 1); }
for (let i = 0; i < Number(N); i++) {
  const cache = path.join(W, `cache_rep${i}`); fs.rmSync(cache, { recursive: true, force: true }); env.LOCKIN_CACHE_DIR = cache;
  const args = [...(prof ? ["--cpu-prof", `--cpu-prof-dir=${path.join(W, "prof")}`] : []), path.join(root, "research/dist/livecost_g.cjs"), view, path.join(W, `rep_${view}_${i}.json`)];
  const t0 = Date.now(); const r = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: Number(lim) * 1000, killSignal: "SIGKILL" });
  const line = (r.stdout || "").split("\n").find((l) => l.includes("coldMs")) ?? "";
  console.log(`run ${i}: status ${r.status} signal ${r.signal} ${((Date.now() - t0) / 1000).toFixed(1)}s ${line.slice(0, 200)}`);
  if (r.signal) console.log((r.stdout || "").slice(-1500), (r.stderr || "").slice(-1500));
  fs.rmSync(cache, { recursive: true, force: true });
}
