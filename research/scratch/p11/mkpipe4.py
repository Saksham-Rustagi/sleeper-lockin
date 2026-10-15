# Writes research/scratch/p11/pipeline4.mjs for the arm chosen by the pre-registered rule (argv[1], e.g. "P11:beta=300").
# Stages (sequential): (a) real 2025-26 season vs the real opponents (the chosen arm, with the variance-reduction
# diagnostic vr=64, which uses its own random stream and does not change decisions); (c) risk response on 46 real states;
# (b) confirmation on fresh model weeks: 2024-25 leagues B and C (460 team-weeks, j=0) and 2025-26 (230, j=1), arms P10
# and the chosen one, KC=6.
import sys
arm = sys.argv[1]
armvr = arm + (',' if ':' in arm else ':') + 'vr=64'
bc = ','.join(f'{w}:{r}' for w in range(1, 24) for r in range(11, 31))
t46 = ','.join(f'{w}:{r}' for w in range(1, 24) for r in ((w - 1) % 10 + 1, (w + 4) % 10 + 1))
src = f'''// Phase 5 pipeline 4 (sequential), chosen arm {arm} (pre-registered rule on the tuning set p11/u25 + p11/u24).
import {{ execFileSync }} from "node:child_process";
const run = (...a) => {{ console.log(new Date().toISOString(), "START", a.join(" ")); execFileSync(process.execPath, ["research/runtasks.mjs", ...a], {{ stdio: "inherit" }}); console.log(new Date().toISOString(), "DONE"); }};
run("research/dist/p11run2.cjs", "p11/a25", "real", "POLS={armvr}", "PAR=14");
run("research/dist/p11risk.cjs", "p11/risk", "", "TASKS={t46}", "PAR=14");
run("research/dist/p11run2.cjs", "p11/c24", "sim", "SEASON=research/data/season2024.json", "TASKS={bc}", "POLS=P10;{arm}", "KC=6", "PAR=14");
run("research/dist/p11run2.cjs", "p11/c25", "sim", "POLS=P10;{arm}", "S0=1", "KC=6", "PAR=14");
console.log("PIPELINE4 DONE");
'''
open('research/scratch/p11/pipeline4.mjs', 'w').write(src)
print('ok', arm)
