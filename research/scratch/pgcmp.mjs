// pregame old vs new outputs without timings (summary text has wall-clock seconds)
import fs from "node:fs";
const rd = (v) => JSON.parse(fs.readFileSync(`research/scratch/oldnew/pregame_5_${v}.json`, "utf8"));
const strip = (x) => JSON.stringify(x, (k, v) => (/^(ms|seconds|lineupSeconds|msFirst)$|_ms$|Ms$/.test(k) ? undefined : k === "summary" && typeof v === "string" ? v.replace(/[\d.]+ s;/g, "_ s;") : v));
const a = strip(rd("old")), b = strip(rd("new"));
console.log(a === b ? "pregame IDENTICAL (timings masked)" : "pregame DIFFER");
const o = rd("old"); console.log("check:", JSON.stringify(o.check).slice(0, 300));
