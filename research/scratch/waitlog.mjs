// node research/scratch/waitlog.mjs <file> <regex>: print the file once it matches the regex, then exit
import fs from "node:fs";
const [file, re] = process.argv.slice(2);
for (;;) {
  let s = ""; try { s = fs.readFileSync(file, "utf8"); } catch {}
  if (new RegExp(re).test(s)) { console.log(s); break; }
  await new Promise((r) => setTimeout(r, 10000));
}
