// Start a long research job fully detached (own session/process group, survives the caller's exit).
// usage: node research/launch_detached.mjs <log file> <script.mjs> [args ...]
// e.g.   node research/launch_detached.mjs research/scratch/run_gap2.log research/runtasks.mjs research/dist/gap.cjs gap2 "" N7=20 PAR=13
import { spawn } from "node:child_process";
import fs from "node:fs";
const [log, ...args] = process.argv.slice(2);
const fd = fs.openSync(log, "a");
const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd, fd], cwd: process.cwd() });
child.unref();
fs.writeFileSync(log + ".pid", String(child.pid));
console.log(`started pid ${child.pid}, log ${log}`);
