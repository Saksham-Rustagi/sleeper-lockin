// Task L latency runner (copy of livecost_w_run.mjs; output dir research/scratch/l, worker bundle simworker_l.cjs):
// research/dist/livecost_g.cjs steps, one process at a time (each uses the app's 12 worker threads).
// usage: node research/livecost_l_run.mjs <step> [<step> ...]   step = engine:view:cacheTag[:KEY=VAL,...]
// Steps sharing a cacheTag share a disk cache dir (research/scratch/l/cache_<tag>): a new tag = a cold start.
// Engine choice comes from LOCKIN_ENGINE only (LOCKIN_CONFIG_DIR is an empty scratch dir, never ~/.sleeper-lockin).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, ".."); const G = path.join(root, "research/scratch/l");
fs.mkdirSync(path.join(G, "cfg"), { recursive: true });
for (const step of process.argv.slice(2)) {
  const [engine, view, tag, extra] = step.split(":");
  const env = { ...process.env, LOCKIN_ENGINE: engine, LOCKIN_CACHE_DIR: path.join(G, `cache_${tag}`), LOCKIN_CONFIG_DIR: path.join(G, "cfg"), LOCKIN_SIMWORKER: path.join(root, "research/dist/simworker_l.cjs") };
  delete env.LOCKIN_OBJECTIVE;
  for (const kv of (extra || "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); env[k] = v; }
  const out = path.join(G, `${engine}_${view}_${tag}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, "research/dist/livecost_g.cjs"), view, out], { env, stdio: "inherit", timeout: 3 * 3600e3 });
  console.log(`[${new Date().toISOString()}] ${step}: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
console.log("ALL DONE");
