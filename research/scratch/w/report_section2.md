
**Does a bigger budget change decisions, and is it better?**
- **Sample.** A paired backtest on real 2025-26 outcomes: 46 team-weeks, the Phase-2/3 model-study set (2 per week).
  Same seeds as the season run `s10`. `research/p10run.ts` with `DECLOG=1`, one process per team-week, 14 in parallel.
- **Noise baseline.** P10b with another race seed (`rseed=1`): the same race, the same budget, other scenarios.
  Needed because a longer race draws more from the race's random stream, so every later race sees different scenarios.
- **Research path is bit-identical.** P10b at the default budget reproduced `s10` on all 46 team-weeks.

| policy | pts/wk | paired diff vs P10b (256) | 95% CI naive | 95% CI week-clustered | better / worse weeks | win% vs real opp. |
|---|---|---|---|---|---|---|
| P10b (kMax 256) | 293.65 | | | | | 70.9% |
| P10b, another race seed (noise baseline) | 291.88 | −1.77 | ± 1.83 | ± 1.82 | 10/13 | 68.6% |
| P10b, kMax 512 | 294.87 | +1.22 | ± 1.96 | ± 1.79 | 9/7 | 73.3% |
| P10b, kMax 1024 | 291.82 | −1.84 | ± 2.21 | ± 2.35 | 10/12 | 70.9% |

| policy | raced / wk | scenarios per race: mean (share at kMax) | continuations / race | switches from P8 / wk | s per raced decision (1 thread, 14 jobs) |
|---|---|---|---|---|---|
| P10b (256) | 25.2 | 168 (49%) | 912 | 2.35 | 12.2 |
| another race seed | 25.3 | 162 (47%) | 896 | 2.41 | 9.7 |
| kMax 512 | 25.2 | 270 (34%) | 1,353 | 2.74 | 19.0 |
| kMax 1024 | 25.0 | 391 (20%) | 1,866 | 3.15 | 23.5 |

**Decisions on identical states.**
- On the real outcomes two runs face the same states until their first different decision. That decision was made on
  an identical state.

| vs P10b (256) | team-weeks with a different decision | decisions compared on identical states | different | at the first difference: the variant switches / keeps P8's |
|---|---|---|---|---|
| another race seed | 42/46 | 367 | 42 (11.4%) | 21 / 21 |
| kMax 512 | 44/46 | 415 | 44 (10.6%) | 32 / 12 |
| kMax 1024 | 45/46 | 405 | 45 (11.1%) | 34 / 11 |

**Reading.**
- **Monte-Carlo noise is as large as the budget effects.** One 256-scenario race re-run on other scenarios already
  makes a different call in ~11% of decisions and moves the week by −1.8 ± 1.8 pts.
  - kMax 512 / 1024 differ by the same amounts (10.6% / 11.1%, +1.2 / −1.8 pts), and not monotonically. On 46
    team-weeks no budget effect is visible.
- **What the budget does change: more switches from P8's decision** (2.35 → 2.74 → 3.15 per week).
  - With more scenarios, the significance gate (gain > 0.5 pt and > 2 se) passes smaller gains.
  - The noise baseline instead switches as often as it keeps (21 / 21 at the first difference).
  - Task H found that race gains shrink ~70% on fresh scenarios (winner's curse). So extra switches at small estimated
    gains are not clearly worth anything.
- **Resolution needed.** The paired real-outcome SD is ~6 pts per team-week. Resolving a 0.5-pt effect would take
  ~600 team-weeks: both seasons, ~11 h on 14 cores for kMax 1024.

**Recommendation.**
- **Ship the worker-thread race** (`DEPLOY_P10B.md` §8). Decisions are identical, so it carries no decision risk.
  - Tip-off advice takes ≤ 13 s instead of up to ~45 s; a cold replay ~30–40 s instead of 3–5 min.
  - Instant off-switch: `"raceWorkers": 0`.
- **Keep kMax = 256** (default unchanged).
  - With workers, 512 / 1024 cost little: +1.5–3.5 s at the busiest tick, +5–25 s per cold replay.
  - But this sample shows no benefit beyond Monte-Carlo noise.
  - A bigger budget mostly adds switches at small estimated gains, the kind task H found to shrink on fresh scenarios.
- **If pursued, measure per decision, not per week.** Where 256 and 1024 disagree on an identical state, score both
  choices with many fresh common-random-number continuations (as task H's runner-up re-evaluation did). That resolves
  the value of the budget with far fewer runs than a season backtest.
  - Better still for a budget increase: spend it on a confirmation batch for a switch (task H's "lock-aware race
    acceptance with a fresh confirmation batch"), not on a longer race.

**Not done.**
- `next build` was not rehearsed. This worktree's `node_modules` is a symlink into the live checkout, and a build could
  write caches there.
- The web-side change is a static `worker_threads` import plus `Atomics` in a server-only module, the same pattern as
  the existing `fs` / `os` imports and teamsim's worker pool.
- `tsc` (which covers the whole repo) is clean.

### Reproduce
```
npx esbuild scripts/simworker.ts --bundle --platform=node --format=cjs --outfile=research/dist/simworker_w.cjs --log-level=error
npx esbuild research/livecost_g.ts --bundle --platform=node --format=cjs --outfile=research/dist/livecost_g.cjs --log-level=error
node research/livecost_w_run.mjs p10b:tick:tww:DAY=2026-10-21 p10b:tick:t1w:LOCKIN_RACE_WORKERS=0,DAY=2026-10-21 \
  p10b:replay:rw12:WEEK=12 p10b:replay:r1w12:LOCKIN_RACE_WORKERS=0,WEEK=12 p10b:tick:tk1024w:DAY=2026-10-21,LOCKIN_RACE_KMAX=1024 ...
  # engine:view:cacheTag[:KEY=VAL,...] -> research/scratch/w/<engine>_<view>_<tag>.json (logs run1.log, run2.log)
node research/dist/memdiag.cjs <abs path>/research/dist/simworker_w.cjs 12   # race-worker memory on a random week (0 = one thread)
node research/scratch/w/chunks.mjs                                           # claim chunk 1 / 2 / 4
npx esbuild research/p10run.ts --bundle --platform=node --format=cjs --outfile=research/dist/p10run_w.cjs --log-level=error
node research/runtasks.mjs research/dist/p10run_w.cjs kmx "" "POLS=P10b;P10x:base=P8,kMax=512;P10x:base=P8,kMax=1024" DECLOG=1 PAR=14 TASKS=<the 46 gap4 team-weeks>  # 90 min
node research/runtasks.mjs research/dist/p10run_w.cjs kmxn "" "POLS=P10x:base=P8,rseed=1" DECLOG=1 PAR=14 TASKS=<same>   # 16 min
cd research/out && python3 ../summ_kmax.py kmx,kmxn P10b "P10x:base=P8,rseed=1;P10x:base=P8,kMax=512;P10x:base=P8,kMax=1024" s10
```
