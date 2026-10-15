// Phase 5 pipeline 5: after pipeline 4, the real 2025-26 season again with the opponent model refit on the team-weeks
// that had an opponent (HUMAN / HUMAN_RESID of lib/engine/human.ts; bundle research/dist/p11run3.cjs). Secondary (a2):
// the refit was made after (a)'s calibration table showed the all-weeks model ~16 pts low on real opponents.
import { execFileSync } from "node:child_process";
const busy = () => { try { return execFileSync("pgrep", ["-f", "research/scratch/p11/pipeline4.mjs"]).toString().trim().length > 0; } catch { return false; } };
while (busy()) await new Promise((r) => setTimeout(r, 15000));
console.log(new Date().toISOString(), "pipeline4 finished");
const run = (...a) => { console.log(new Date().toISOString(), "START", a.join(" ")); execFileSync(process.execPath, ["research/runtasks.mjs", ...a], { stdio: "inherit" }); console.log(new Date().toISOString(), "DONE"); };
run("research/dist/p11run3.cjs", "p11/a25m", "real", "POLS=P11:beta=1000,vr=64", "PAR=14");
console.log("PIPELINE5 DONE");
