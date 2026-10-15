// Wait until <dir> holds at least N files starting with <prefix>_ (pipelines writing into subdirectories of research/out).
// usage: node research/scratch/p11/wait.mjs <dir> <prefix> <N> [timeout minutes]
import fs from "node:fs";
const [dir, prefix, n, tmo] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5] || 600)];
const count = () => fs.readdirSync(dir).filter((f) => f.startsWith(prefix + "_")).length;
const t0 = Date.now();
while (count() < n && Date.now() - t0 < tmo * 60e3) await new Promise((r) => setTimeout(r, 10000));
console.log(`${prefix}: ${count()} files after ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
