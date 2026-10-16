// memdiag (random P10b week) on one thread vs 12 race workers with claim chunks 1 / 2 / 4 (env LOCKIN_RACE_CHUNK)
import { spawnSync } from "node:child_process"; import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, "../../.."); const W = path.join(root, "research/dist/simworker_w.cjs");
const run = (nw, chunk) => { const r = spawnSync(process.execPath, [path.join(root, "research/dist/memdiag.cjs"), W, String(nw)], { env: { ...process.env, LOCKIN_RACE_CHUNK: String(chunk) }, encoding: "utf8" }); return r.stdout.split("\n").filter((l) => !l.startsWith("[racepool]")).join(" | "); };
for (const [nw, c] of [[0, 1], [12, 1], [12, 2], [12, 4], [12, 1], [12, 2]]) console.log(`workers ${nw} chunk ${c}: ${run(nw, c)}`);
