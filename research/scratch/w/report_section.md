
## P10b on worker threads (overnight 2026-10-16, task "P10b decisions on worker threads")
**Goal.** P10b's race (up to 8 candidate decisions × 16–256 continuations each, played by P8) ran on one thread:
5–12 s per decision, up to ~45 s for a busy tip-off's advice, 3–5 min per replay. Move the continuations to worker
threads, with **bit-identical decisions**.

**Result.**
- The race itself is **~7–7.5× faster**: replays 202–290 s → 28–39 s, and the Wednesday tip-off race ~34 s → ~4.5 s.
- Whole views gain less, because work outside the race stays serial: Wednesday tip-off advice 38.4 → 8.7 s; the
  Tuesday plan is unchanged at 8.4 s, since it has hardly any race.
- **Identical decisions everywhere:**
  - unit tests with 1, 3 and 12 workers (decisions, final states, every race statistic);
  - the live advice path;
  - 7 of 7 views on the real league, single thread vs workers.
- Cost: +35–40% CPU time in total, and 1.2–2.2 GB RSS while racing.
- Not deployed. `DEPLOY_P10B.md` §8 lists the files, build, restart and rollback.

### Design (`lib/live/racepool.ts`, `lib/engine/p10.ts`, `lib/engine/p8.ts`)
**Synchronous, not async.** `E.simulate` and the hooks stay synchronous. Each racing round works like this:
1. The race draws the round's scenarios on the main thread, from its own random stream, exactly as before.
2. It hands the round to the pool.
3. The main thread posts the round to the workers, then plays continuations itself.
4. It blocks on `Atomics.wait` until all of the round's results are in a `SharedArrayBuffer`.
5. Only then does the race eliminate candidates, stop, or decide.

Why this instead of precomputing races asynchronously before each `simulate` step, or an async plan builder:
- **No API changes.** Every caller gets the speed-up with no plumbing: the plan, replay, the hold/lock/bench call, the
  notifier, P11.
- **Unchanged control flow.** The decision sequence is the same code path as the single-thread race, so the only
  difference can be *who* computes a continuation.
- **Blocking is no worse than before.** The main thread is busy anyway (as with the single-thread race, but ~7× shorter).
  Node allows `Atomics.wait` on the main thread, and workers start and run while it is blocked (checked).
- The asynchronous design needed stepping `simulate` event by event around every tip-off in `advise.ts`, plus a
  precompute hook. It would have kept the event loop free during a race, but no view needs that today.

**Determinism by construction.**
- **Pure continuations.** A continuation (`continuation()` in p10.ts) is a pure function of the team-week, the base
  policy, the decision state, the candidate, the scenario and the real decision's prices. Its price slot is seeded per
  continuation; the stopValue and re-solve memos are pure (task C).
- **Claiming and reduction.** Workers claim continuations from a shared counter and write each result at its own index
  (candidate-major). The race reads them in scenario order, as before. Elimination happens per round, after all results
  are in.
- **Scenarios** are always drawn on the main thread, in the old order, so the race's random stream (and therefore the
  next decisions) are untouched.
- **Price state (task-F rules).** The main thread exports the "top" slot's view: the minimiser's prices, the state it
  was solved from, t, tilt, day and ends (`exportPrices`). The worker rebuilds the view exactly (`importPrices`):
  `tables(prepare(fromState(st0, t0, tilt)), mu)`. Each continuation then seeds its own slot from it, as in the main
  thread.
  - Tested: every priced weight and P8's decision from the rebuilt view equal the original's.
- **Team-weeks** are sent once per worker. The main thread mirrors the workers' 2-entry list, so a team-week is resent
  whenever a worker may have dropped it. Contexts are sent once per decision; rounds are small.

**Fallbacks** (identical results, main thread):
- browser, `LOCKIN_NO_WORKERS`, `LOCKIN_RACE_WORKERS=0`, or `"raceWorkers": 0` in config.json (re-read every 30 s);
- no worker bundle, or a bundle without the race protocol (stale `simworker.cjs`), which is skipped up front;
- workers that don't answer the start-up handshake within 20 s;
- a worker exception, or no progress for 60 s. The round is replayed on the main thread and the pool is switched off.

**Memory.**
- The first version used 3.4–4.3 GB RSS: each worker held up to 1,000 memoised price views, the re-solve memo of task C.
- Workers now keep 100 (`setMemoMax`). On a P10b week that brought RSS from 4.3 to 1.7 GB, with the same result and
  speed (8.6–8.8 s vs 9.2 s).
- The main thread and research keep 1,000.
- The app's pool stops after 10 min unused and restarts in ~0.1 s.
- Claiming continuations in chunks of 2 or 4, for memo locality, was measured and is no faster. The default stays 1.

**Research is unchanged.** Backtests pass no pool, so they take the single-thread path. Its only change is that a
round's scenarios are drawn before its continuations are played, which consumes the same stream (continuations never
touch it).
- Checked on 46 real team-weeks below: P10b totals are identical to the Phase-3 season run `s10`.

### Tests (`tests/racepool.test.ts`; `npm test` 76/76, tsc clean)
- **Exact price views.** Every candidate's priced weights, P8's decision and its score are identical after
  export → structured clone → import.
- **Worker-count independence.** On random 9-slot weeks, P10b (P8 continuations, warm re-solves) and P10 (P8f) with
  1, 3 and 12 workers equal the single-thread race:
  - every decision, the total, the final state, and all race statistics (decisions, raced, candidates, switches,
    scenarios, continuations, per-race log);
  - with test settings (8 per round, up to 64) and with the defaults (16, up to 256).
- **Many team-weeks.** One pool serving several team-weeks in turn, returning to older ones: identical, and no fallback.
- **Fallbacks.** A stale bundle is refused. A pool that fails mid-race (here, an uncloneable team-week) is switched off,
  and the race finishes on the main thread with identical results.
- **Live path (engine p10b).** `planHooks` driven tip-off by tip-off as the plan does, and the whole `computeAdvice`
  JSON: identical with 1, 3 and 12 race workers and with none, and with the config off-switch.

### Latency on the real league
- **Setup.** League 1344387394811490304, roster 8, 2026-27 week 1. One process per view, empty disk cache, the app's
  12 projection workers plus 12 race workers.
- **Tip-off ticks.** The week was simulated forward to 10 min before that day's first tip-off, as in task G.
- **"Before"** is the same build with `LOCKIN_RACE_WORKERS=0`, i.e. the shipped single-thread race. Its decisions equal
  "after" in every row.
- **CPU** is the whole process's (all threads). Run with no other heavy jobs; Spotlight was indexing in the background.
- **Scripts.** `research/livecost_g.ts` (now with CPU, RSS and full decision output) and `research/livecost_w_run.mjs`.
  Outputs are in `research/scratch/w/`.

| view | before: wall (CPU) | **after: wall (CPU)** | speed-up | RSS after | decisions |
|---|---|---|---|---|---|
| /api/advise, Tue noon, cold (plan for Tue night + 2 × 20k projections) | 8.4 s (29.7 s) | **8.4 s** (39.4 s) | 1.0× (≈ no race) | 0.86 GB | identical¹ |
| notifier tick, Wed 6:50 pm (3 held, 8 tip-offs in 30 h): total | 41.8 s (65.7 s) | **12.1 s** (86.0 s) | 3.5× | 1.9 GB | identical |
| … of which advice (P10b plan + calls) | 38.4 s | **8.7 s** | 4.4× | | |
| tick, Fri 6:50 pm (6 held, 3 locked, 9 tip-offs): total / advice | 8.4 / 6.8 s (15.0 s) | **5.4 / 3.9 s** (24.3 s) | 1.6× / 1.7× | 1.6 GB | identical |
| tick, Sat 5:50 pm (4 held, 5 locked, 7 tip-offs): total / advice | 4.3 / 3.3 s (9.1 s) | **4.0 / 2.9 s** (15.2 s) | 1.1× | 1.2 GB | identical |
| replay 2025-26 week 5, cold | 202.1 s (224 s) | **28.4 s** (316 s) | **7.1×** | 2.2 GB | identical (76 log lines) |
| replay week 12 | 290.1 s (320 s) | **38.6 s** (448 s) | **7.5×** | 2.1 GB | identical (91) |
| replay week 20 | 214.9 s (238 s) | **29.1 s** (329 s) | **7.4×** | 2.1 GB | identical (91) |

¹ Two runs 30 min apart differ only in the clock-relative time label ("Tue, Oct 20, 9:30 PM" vs "Tue 9:30 PM"). The run
pair made 9 s apart is byte-identical.

**Where the remaining time goes** (main-thread profile of the Wednesday tick with workers, 13.4 s):
- the race ~4.5 s (≈ 34 s single-threaded, ~7.5×): the main thread plays its share for ~4.0 s and waits ~2.4 s for
  round tails;
- the week-start price solve, 2.1 s (2 × 100k Adam iterations, sequential, once per team-week and process);
- the projections' share on the main thread, the options' quick simulations (~0.7 s), P8's own decisions and price
  re-solves at the plan's tip-offs.

So views with little race (Tuesday, Saturday) barely change. Further gains would come from caching the week-start
prices per team-week, which is pure, and from pipelining round tails.

**Speed-up ceiling.** The race reaches ~7–7.5× with 13 threads on this 14-core Mac.
- Total CPU is +35–40% (random-week check: 55 s single vs 83 s with 12 workers).
- Causes: work that the single-thread memo shared is now done per worker, and threads land on slower cores.
- Claim chunking didn't help.

### More rollouts per decision: kMax 512 / 1024
**Latency now** (with workers, same views; env `LOCKIN_RACE_KMAX`, a measurement knob with its own cache key; the
default stays 256):

| view | kMax 256 | 512 | 1024 |
|---|---|---|---|
| Tue plan, cold | 8.4 s | 8.5 s | 8.4 s |
| Wed tick: total / advice (CPU) | 12.1 / 8.7 s (86 s) | 14.1 / 10.7 s (113 s) | 15.5 / 12.2 s (132 s) |
| Fri tick | 5.4 / 3.9 s | 5.9 / 4.3 s | 6.3 / 4.7 s |
| Sat tick | 4.0 / 2.9 s | 3.8 / 2.8 s | 3.8 / 2.8 s |
| replay week 12 (CPU) | 38.6 s (448 s) | 43.0 s (502 s) | 64.0 s (771 s) |

- **Cheap now.** kMax 1024 would cost the busiest tick ~3.5 s more, and a cold replay ~25 s more. Single-threaded, the
  same would have been minutes.
- **The extra scenarios are few.** Only races still undecided at 256 continue, and by then 1–3 candidates are left.
- **Decisions on these live samples.** The first-tip-off calls (what the notifier says now) were the same at all three
  budgets. Later, tentative plan steps changed:
  - Wednesday: Thursday's slot arrangement;
  - Friday (1024): one start on Saturday night;
  - Saturday (512, 1024): a held 38.7 locked at a later tip-off instead of held on.
- **Replay of week 12:** 313.5 (256) → 318.5 (512) / 318.0 (1024).
