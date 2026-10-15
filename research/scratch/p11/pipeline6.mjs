// Phase 5 pipeline 6: after pipeline 5, rule check of P11 on simulated weeks: 23 model weeks of 2025-26 (one team per
// week), P10 and P11 beta 1000 each run from scratch through the invariant checker (CHECKBRANCH; also re-verifies that
// the shared-prefix continuation equals the from-scratch run).
import { execFileSync } from "node:child_process";
const busy = () => { try { return execFileSync("pgrep", ["-f", "research/scratch/p11/pipeline5.mjs"]).toString().trim().length > 0; } catch { return false; } };
while (busy()) await new Promise((r) => setTimeout(r, 15000));
const run = (...a) => { console.log(new Date().toISOString(), "START", a.join(" ")); execFileSync(process.execPath, ["research/runtasks.mjs", ...a], { stdio: "inherit" }); console.log(new Date().toISOString(), "DONE"); };
run("research/dist/p11run3.cjs", "p11/chk", "sim", "TASKS=1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,11:1,12:2,13:3,14:4,15:5,16:6,17:7,18:8,19:9,20:10,21:1,22:2,23:3", "POLS=P10;P11:beta=1000", "CHECKBRANCH=1", "KC=1", "PAR=14");
console.log("PIPELINE6 DONE");
