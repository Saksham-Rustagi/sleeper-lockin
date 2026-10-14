// Runs research/dist/livecost.cjs for every engine x view, one process at a time (each uses all worker threads).
// usage: node research/livecost_run.mjs [engines=p7h,p8,p9] [views=sims,advise,waivers,league,ir]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const engines = (process.argv[2] || "p7h,p8,p9").split(","), views = (process.argv[3] || "sims,advise,waivers,league,ir").split(",");
fs.mkdirSync("research/out", { recursive: true });
for (const e of engines) for (const v of views) {
  const out = `research/out/livecost_${e}_${v}.json`; if (fs.existsSync(out)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["research/dist/livecost.cjs", v, out], { env: { ...process.env, LOCKIN_ENGINE: e, LOCKIN_SIMWORKER: new URL("../scripts/dist/simworker.cjs", import.meta.url).pathname }, stdio: "inherit", timeout: 3 * 3600e3 });
  console.log(`[${new Date().toISOString()}] ${e} ${v}: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log("ALL DONE");
