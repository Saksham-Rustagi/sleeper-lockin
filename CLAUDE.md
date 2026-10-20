# Sleeper Lock-In engine (branch engine-v2)

You are working in an ISOLATED git worktree (`~/sleeper-engine-v2`, branch `engine-v2`). The live app runs from
`~/Desktop/Sleeper/sleeper-lockin` (branch `lockin-live`) - NEVER edit, build, or restart anything there, never run
`launchctl`, never `git push`. Commit your work on `engine-v2` in small, described commits.

## Commands
- Type check: `npx tsc --noEmit -p .`   Unit tests: `npm test` (must stay green; 96 tests today)
- Bundle a research script: `npx esbuild research/X.ts --bundle --platform=node --format=cjs --outfile=research/dist/X.cjs --log-level=error`
- Season backtest (2025-26, 23 weeks x 10 teams = 230 team-weeks), parallel over the 14 cores:
  `node research/runpar.mjs research/dist/backtest.cjs <outPrefix> <POLICY,POLICY,...> 200 KS=200`
  then summarize: `python3 research/summ2.py <outPrefix> <POLICIES> <BASELINE>` run from `research/out/` (paired diffs ± 95% CI).
  A full P7H run takes ~5 min wall clock. Data: `research/data/season.json` (do not commit).
- Results/notes go in `research/REPORT.md` (append a section per experiment, with tables).

## Code map
- `lib/engine/core.ts`: event-driven week simulator + policies. Events: game end (kind 0), "next tip deadline" for a held
  player (kind 1), tip-off group (startGroup). `evalLock` (lock-vs-continue heuristic), `stopValue` (single-player optimal
  stopping DP), `assignExact` (max-weight slot assignment), `startGroup`, `applyStarts`, `lockAwarePlacement`,
  `rolloutHooks` (Monte-Carlo lock decisions), `startRolloutHooks` (Monte-Carlo start/sit), `holdYield`.
- `lib/engine/model.ts`: per-game score distribution / play probabilities.
- `lib/live/*`: live app (uses `POLICY` from `lib/live/week.ts` = P2 + lockAware + holdYield, with start and lock rollouts
  at decision time). `lib/live/teamsim.ts`: shared simulation + worker threads. `lib/live/racepool.ts`: P10/P10b race
  continuations on their own worker threads (synchronous, bit-identical; research passes no pool = single thread).
- `research/backtest.ts` + `research/btcommon.ts`: walk-forward backtest (no look-ahead; model fit on prior weeks only).
- `research/waivers_bt.ts` + `research/wcommon.ts` + `research/w_run.mjs`: season-long waiver backtest of the Waivers
  page's valuation (task W, `research/WAIVERS_W.md`; datasets from `research/w_build.py`).
- P10c / engine option `p10c` (task L, REPORT "P10b acceptance fix"; not shipped, gate not met): P10b + a fresh
  confirmation batch for the race's best challenger (`confirm*` in `P10Opts`, `P10C_OPTS`). Probes on races:
  `research/lprobe.ts` (tuning data `research/l_tune.ts`/`.py`; task H's runner-up statistic via `p10run` env FRESH=96).
- Opportunity alerts (task O, REPORT "Opportunity alerts", `DEPLOY_OPPORTUNITY.md`; both switches default off):
  `lib/live/opportunity.ts` (pure: replacement detector, surge watch, overrides, alert texts, `OPP` parameters fitted on
  2024-25), `lib/live/boxscores.ts` (ESPN box-score store), `lib/live/oppscan.ts` (live scan, `minutesOverrides`),
  `lib/live/override.ts` (config `"opportunityAlerts"` / `"minutesOverride"`, override hash in fingerprints). Research:
  `research/o_fetch.py` (Sleeper minutes data -> `research/data/o/`), `o_common.ts`, `o_val.ts` (absences / surges /
  week-start alerts), `o_value.ts` + `o_pipeline*.mjs` (value + calibration via the task-W framework; `waivers_bt.ts`
  env OVR / OVR_MAX), `o_summ.py`, `o_vsumm.py`, `o_tune*.py`, `o_live.ts` (live scan + ESPN parser check). Task O2: "no projection" override (`noProjection` in opportunity.ts, source `noProjection`;
  live check `research/o2_live.ts`).
- NBA roster check (task R, REPORT "NBA roster check", `DEPLOY_ROSTERCHECK.md`; switch `"rosterCheck"`, default ON):
  `lib/live/nbarosters.ts` (ESPN team rosters -> `rosterCheck` fixes: waived = no games for his Sleeper team, signed
  elsewhere = new team's games; fail-safe), used by buildWeek / Waivers / oppscan. Live check `research/r_live.ts`.
- `tests/*.test.ts`: node:test unit tests.

## Sleeper Lock-In rules (verified: Sleeper support article 6522833 + community; all must be modeled)
1. A game counts only if the player was in a STARTING slot at tip-off. Bench at tip-off = that game doesn't count.
2. While his game is in progress he is pinned to his slot (can't move).
3. After the game ends he holds that score; he may be LOCKED into any open starting slot he is eligible for, any time
   before his next tip-off. Locked = score fixed for the week, slot consumed for the rest of the week, no more games.
4. A held (unlocked) player can be MOVED between starting slots freely; moving him to the BENCH forfeits the held score.
5. At his next tip-off, if he is still in the lineup unlocked, the new game replaces the held score.
6. Unlocked starter at week end: his final game counts automatically (0 if DNP).
7. A slot can host several players on the same day if their games don't overlap (slot reuse after a game ends).
8. Positions: slots PG, SG, G(PG/SG), SF, PF, F(SF/PF), C, UTIL, UTIL; players have 1-3 eligible positions.
9. Sleeper moves are moves/swaps between eligible slots; a player in a live game or a locked player cannot move.
10. Scoring is per game (league scoring_settings); DNP risk (injury tags, sit-out chain) is in the model.
Objective: maximize expected weekly points (tested: optimizing win probability vs the opponent was no better).

## Current baseline (must be beaten before anything ships)
| policy | pts/wk | win% vs real opp |
| P2LA rule only | 270.8 | 60.0% |
| P2LAH (+holdYield) | 272.0 | 61.0% |
| P3LA (+lock rollouts) | 274.2 | 59.3% |
| **P7H (live: holdYield + start rollouts + lock rollouts)** | **280.3** | **64.0%** |
| humans 232.5, perfect hindsight 317.5 |
Known flaws: holdYield forbids "keep holding and bench tonight's player" (sometimes right); start alternatives are only
"sit 1 of 2 weakest / start 1 of 2 best benched"; placement & move-reachability are heuristic; lock and start decisions are
separate searches; the rollout base rule (static assignment valuation) locks too early (~2.4 pts) and has been biased.
See ENGINE_V2.md for the plan.
