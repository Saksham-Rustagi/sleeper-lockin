// Copy branch lockin-live's lib/ (read from git objects, the live checkout is not touched) to research/scratch/g/live_src
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, "../../.."); const dst = path.join(root, "research/scratch/g/live_src");
const files = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", "lockin-live", "lib"], { encoding: "utf8" }).trim().split("\n");
for (const f of files) {
  const out = path.join(dst, f); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, execFileSync("git", ["-C", root, "show", `lockin-live:${f}`]));
}
console.log(`${files.length} files from lockin-live (${execFileSync("git", ["-C", root, "rev-parse", "--short", "lockin-live"], { encoding: "utf8" }).trim()})`);
