// Wait until research/out has at least N files with the given prefix (or maxSec passes); print the count and time.
// usage: node research/scratch/w/waitn.mjs <prefix> <N> <maxSec>
import fs from "node:fs";
const [pre, N, max] = process.argv.slice(2); const t0 = Date.now();
const count = () => fs.readdirSync("research/out").filter((f) => f.startsWith(pre + "_")).length;
while (count() < Number(N) && Date.now() - t0 < Number(max) * 1000) await new Promise((r) => setTimeout(r, 15000));
console.log(`${count()} ${pre} outputs at ${new Date().toISOString()}`);
