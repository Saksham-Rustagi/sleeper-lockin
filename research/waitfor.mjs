// Wait until research/out holds at least N files starting with <prefix>_ (for unattended pipelines).
// usage: node research/waitfor.mjs <prefix> <N>
import fs from "node:fs";
const [prefix, n] = [process.argv[2], Number(process.argv[3])];
const count = () => fs.readdirSync("research/out").filter((f) => f.startsWith(prefix + "_")).length;
while (count() < n) await new Promise((r) => setTimeout(r, 5000));
console.log(`${prefix}: ${count()} files`);
