// End-to-end notifier run (task G): the real scripts/notify.ts bundle, HOME = a scratch dir whose
// .sleeper-lockin/config.json selects the engine (the live ~/.sleeper-lockin is never read or written), DRY_RUN
// (reminders printed, sent.json / data log not written), NO_COLLECT, WAIVERS forced. Runs it N times in a row.
// usage: node research/scratch/g/notify_e2e.mjs <tag> [N=2] [KEY=VAL ...]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const G = path.resolve(new URL(".", import.meta.url).pathname); const root = path.resolve(G, "../../..");
const [tag, n = "2", ...extra] = process.argv.slice(2);
const env = { ...process.env, HOME: path.join(G, "home"), DRY_RUN: "1", NO_COLLECT: "1", WAIVERS: "1", LOCKIN_SIMWORKER: path.join(root, "research/dist/g/simworker.cjs") };
delete env.LOCKIN_ENGINE; delete env.LOCKIN_CONFIG_DIR; delete env.LOCKIN_CACHE_DIR; delete env.LOCKIN_OBJECTIVE;
for (const kv of extra) { const [k, v] = kv.split("="); env[k] = v; }
for (let i = 1; i <= Number(n); i++) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, "research/dist/g/notify.cjs")], { env, encoding: "utf8", timeout: 20 * 60e3 });
  const s = (Date.now() - t0) / 1000; const log = `${r.stdout}${r.stderr}`;
  fs.writeFileSync(path.join(G, `notify_e2e_${tag}_${i}.log`), log);
  console.log(`run ${i}: exit ${r.status} in ${s.toFixed(1)} s\n${log}`);
}
