// Deploy rehearsal (task G): a throwaway clone of branch lockin-live in /tmp, merge engine-v2 exactly as DEPLOY_P10B.md
// says, then type-check, unit tests, `next build` and the notifier bundles. The live checkout is never touched.
// usage: node research/scratch/g/rehearse.mjs [dir=/tmp/g_deploy]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const repo = path.resolve(new URL(".", import.meta.url).pathname, "../../.."); const dir = process.argv[2] || "/tmp/g_deploy";
const run = (cmd, args, cwd = dir, env = {}) => {
  const t0 = Date.now(); const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 28 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  console.log(`\n$ ${cmd} ${args.join(" ")}  -> exit ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n${out.split("\n").slice(-25).join("\n")}`);
  if (r.status !== 0) { console.log("REHEARSAL FAILED"); process.exit(1); }
  return out;
};
// turbopack refuses a node_modules symlink that points outside the project: `next build` gets an APFS clone (cp -c)
const realModules = () => {
  const nm = path.join(dir, "node_modules");
  if (fs.existsSync(nm) && fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm);
  if (!fs.existsSync(nm)) run("cp", ["-cR", fs.realpathSync(path.join(repo, "node_modules")), nm], "/tmp"); // (read only)
};
if (process.argv[3] === "--build-only") { realModules(); run("npm", ["run", "build"], dir, { NEXT_TELEMETRY_DISABLED: "1" }); console.log("REHEARSAL BUILD OK"); process.exit(0); }
if (fs.existsSync(dir)) { console.log(`${dir} exists - remove it or pass another dir`); process.exit(1); }
run("git", ["clone", "-q", "--no-hardlinks", "-b", "lockin-live", repo, dir], "/tmp");
run("git", ["config", "user.name", "rehearsal"]); run("git", ["config", "user.email", "rehearsal@localhost"]);
run("git", ["log", "--oneline", "-1"]);
run("git", ["merge", "--no-ff", "origin/engine-v2", "-m", "Ship engine-v2 (P10b available; default engine p7h)"]);
run("git", ["diff", "--stat", "HEAD~1", "HEAD", "--", "lib", "app", "scripts", "tests", "package.json"]);
fs.symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
run("npx", ["tsc", "--noEmit", "-p", "."]);
run("npm", ["test"]);
run("npm", ["run", "build:notify"]);
// --webpack: keep the node_modules symlink and build with webpack (cloning node_modules takes > 15 min here); the
// live build uses turbopack (`npm run build`) - same app code, same type check
if (process.argv[3] === "--webpack") run("npx", ["next", "build"], dir, { NEXT_TELEMETRY_DISABLED: "1" });
else { realModules(); run("npm", ["run", "build"], dir, { NEXT_TELEMETRY_DISABLED: "1" }); }
console.log("REHEARSAL OK");
