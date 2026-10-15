# Shipping P10b to the live app (decision-only)

What the user was promised, and what engine `p10b` now does:
- **P10b makes the decisions:**
  - the plan's start/sit and hold / lock / let-go at every tip-off;
  - the hold / lock / bench call for every held score (This week tab, notifier reminders);
  - replay.
- **Everything else stays on the current fast POLICY engine:** projections, win probability, Matchups (league),
  Waivers, IR, lock cut-offs, and the expected points shown next to each hold/lock/bench option.
  - These are the same computation as today (`simPolicy("p10b") === POLICY`), with the same cache entries.
  - Verified on the live data: identical numbers to the live code (see "Evidence").
- **`p10b-full`** is the old `p10b`, kept for comparison. It runs every mass simulation on P8f, which makes those
  views 5–20× slower. Do not use it live.
- **Default stays `p7h`.** Until the config says otherwise, the merged code behaves byte-for-byte like the live code.

## 1. Files changed vs branch `lockin-live`
`git diff --stat lockin-live...engine-v2 -- lib/ app/ scripts/ tests/` (no change to `app/`, `package.json`,
`package-lock.json`, `next.config.*` or `tsconfig.json`):

```
 lib/engine/core.ts          | 254 ++++++++++++++++++++++++-----
 lib/engine/human.ts         | 226 ++++++++++++++++++++++++++
 lib/engine/lagrange.ts      | 268 +++++++++++++++++++++---------
 lib/engine/moves.ts         |  53 ++++++
 lib/engine/p10.ts           | 223 +++++++++++++++++++++++++
 lib/engine/p11.ts           | 114 +++++++++++++
 lib/engine/p8.ts            | 388 ++++++++++++++++++++++++++++++++++++++++++++
 lib/live/advise.ts          |  80 +++++++--
 lib/live/cache.ts           |   8 +-
 lib/live/engine.ts          | 136 ++++++++++++++++
 lib/live/ir.ts              |   2 +-
 lib/live/league.ts          |   6 +-
 lib/live/opponent.ts        |  35 ++++
 lib/live/teamsim.ts         |  28 +++-
 lib/live/waivers.ts         |   2 +-
 scripts/notify.ts           |  31 +++-
 tests/engine_select.test.ts | 207 +++++++++++++++++++++++
 tests/p10.test.ts           | 151 +++++++++++++++++
 tests/p11.test.ts           | 132 +++++++++++++++
 tests/p8.test.ts            | 110 +++++++++++++
 tests/perf.test.ts          |  72 ++++++++
 21 files changed, 2379 insertions(+), 147 deletions(-)
```

What the changes are:
- **`lib/engine/*`:** engine v2.
  - P8 index policy, P10 race, P11 win objective, human opponent model, legal-move search.
  - Bit-identical speed-ups (task C) and the simulation-repeatability fix (task F).
- **`lib/live/engine.ts`:** engine selection (`p7h | p8 | p9 | p10 | p10b | p10b-full`).
  - `simPolicy` / `decisionPolicy`.
  - `engineDecidesHolds`, `replayIsSlow`.
  - Cache tags: `engineTag` for decisions, `simTag` for mass simulations.
- **`lib/live/advise.ts`:**
  - With p10b, each hold/lock/bench call is P10b's decision at the plan's first tip-off (`engineCall`).
  - The reason text starts with "P10b (complete decision for the … tip-off …)". It says so when the quick
    simulations disagree.
  - `computeAdvice` is exported (tests, measurements).
- **`lib/live/cache.ts`:** `fingerprint(x, "sim")` for mass-simulation results.
  - Callers: `teamsim.ts` (projections), `league.ts`, `waivers.ts`, `ir.ts`.
  - Advise and replay keep the decision-engine tag.
- **`scripts/notify.ts`:**
  - Logs `engine <name>: advice computed|cached in N s`.
  - With a race engine (p10b), during quiet hours it precomputes last week's replay once per week.
    - Marker file `~/.sleeper-lockin/replay-warm-<league>-<roster>-<week>-<engine>`.
    - Reason: a P10b replay takes 3–5 min.
  - With `p7h` the notifier does exactly what it does today.
- **Merge.** `lockin-live`'s only commit since the branch point (80192a5, the 9-min watchdog) is already in engine-v2
  as cbade41, with byte-identical content.
  - engine-v2's notify.ts changes avoid the lines around it.
  - The merge was rehearsed in a throwaway clone: clean, no conflicts.

## 2. The config change
In `~/.sleeper-lockin/config.json`, add one key (keep everything else):
```json
{ "leagueId": "...", "rosterId": 8, "engine": "p10b" }
```
- No restart is needed for the switch itself:
  - the web server re-reads the config every 30 s;
  - the notifier reads it on every run.
- An environment variable `LOCKIN_ENGINE` overrides the file. Make sure the launchd plists don't set it, and don't set
  `LOCKIN_OBJECTIVE` either. `"objective": "win"` (P11) stays a separate opt-in and is not part of this deployment.

## 3. Checklist (manager)
Pre-flight
- [ ] **Live checkout clean and on the right commit.** `cd ~/Desktop/Sleeper/sleeper-lockin && git status`: clean,
      on `lockin-live`. Note the rollback point: `git rev-parse HEAD` (expected `80192a5`).
- [ ] **No engine override in launchd.** The web and notifier plists don't set `LOCKIN_ENGINE` / `LOCKIN_OBJECTIVE`.
- [ ] **Shared disk cache.** Confirm the web service still sets `LOCKIN_CACHE_DIR=~/.sleeper-lockin/cache`. The
      notifier always uses that directory.
  - As seen tonight in the running web server's environment (`com.sleeper-lockin.web`), it does.
  - Because of that, the This week and Replay tabs serve the notifier's precomputed advice and replays (warm: ms).
  - If the web did not share the directory, each first web request would compute them itself (latency table below).

Deploy (default engine p7h; nothing changes for the user yet)
- [ ] **Merge:** `git merge --no-ff engine-v2 -m "Ship engine-v2 (P10b available; default engine p7h)"`.
      Expected: no conflicts.
- [ ] **Check:** `npx tsc --noEmit -p .` must be clean; `npm test` must show 71/71 passing.
- [ ] **Build both:**
  - `npm run build:notify` (notify.cjs **and** simworker.cjs; both must be rebuilt);
  - `npm run build` (web).
- [ ] **Restart** the web service and the notifier the usual way.
- [ ] **Smoke test on p7h:**
  - the app loads;
  - the next notifier log shows `engine p7h: advice ...`;
  - numbers equal what they were before the merge. Fingerprints are unchanged, so cached results remain valid.

Switch
- [ ] **Edit the config:** add `"engine": "p10b"` to `~/.sleeper-lockin/config.json`.
- [ ] **Within 30 s (web):** on the This week tab, held-score decisions read "P10b (complete decision for the …
      tip-off …)".
  - Matchups / Waivers / IR open instantly: their cache entries are shared with p7h.
- [ ] **Next notifier run:** the log shows `engine p10b: advice computed in N s`. Expected N:
  - 15–45 s on game days with held scores;
  - the whole run under ~2 min (watchdog: 9 min).
- [ ] **Optional dry tick:** `DRY_RUN=1 NO_COLLECT=1 FORCE=1 node scripts/dist/notify.cjs` prints the reminders
      without sending them.
- [ ] **First Monday morning (quiet hours):** the notifier log shows `replay of week N ready (… s)`.

## 4. Rollback
- **Engine only (instant, the normal way back).** Remove `"engine"` from config.json, or set it to `"p7h"`.
  - The web picks it up within 30 s; the notifier on its next run.
  - No cache cleanup is needed: p7h's entries were never touched. p10b shares only the mass-simulation entries, which
    are identical, and its advise/replay entries have their own key (`p10b+sim:p7h`).
- **Code (only if the merged code itself misbehaves, even on p7h).**
  1. In the live checkout run `git reset --hard 80192a5` (the rollback point noted above), or
     `git revert -m 1 <merge commit>`.
  2. Rebuild with `npm run build:notify && npm run build`.
  3. Restart both services.
  - Disk cache entries written by the new code on p7h have the same fingerprints and values as the old code's, so they
    remain valid.
  - p10b entries and the `replay-warm-*` marker files are just unused files and can stay.

## 5. Latency with p10b (measured 2026-10-15 on this Mac, live services running)
- **Setup.** Real league 1344387394811490304, roster 8, week 1 of 2026-27 (Tue Oct 20 – Sun Oct 25). One process per
  measurement with the app's 12 worker threads; cold = empty disk cache.
- **Tip-off ticks.** The real week hasn't started, so the "notifier tick at a tip-off" rows use week 1 simulated
  forward to 10 min before that day's first tip-off. Both teams are played by POLICY on one sampled scenario, so the
  held scores and locks are realistic.
- **Scripts.** `research/livecost_g.ts`, `research/livecost_g_run.mjs`, `research/scratch/g/notify_e2e.mjs`.

| view | p7h (live) | **p10b** | p10b-full (old p10b) |
|---|---|---|---|
| /api/advise, Tuesday week 1 noon (full plan for Tue night + 20k-week projections of both teams), cold | 5.3 s | **13.6 s** | 136.7 s |
| /api/advise, now (plans opening night), cold / warm | 5.4 s / 2 ms | **14.1 s / 2 ms** | |
| notifier advise at a tip-off: Wed 6:50 pm, 3 held, 8 tip-offs in the 30-h plan, cold | 5.4 s | **42.1 s** (43.4 s with Matchups + Waivers computing concurrently) | 166.8 s |
| … Fri 6:50 pm, 6 held, 3 locked, 9 tip-offs | 2.6 s | **12.4 s** | |
| … Sat 5:50 pm, 4 held, 5 locked, 7 tip-offs | 1.1 s | **3.9 s** | |
| notifier full run end-to-end (advise + Waivers forced + IR), cold / next run | | **55.8 s / 0.5 s** | |
| Matchups (league, 10 teams × 20k), cold / warm | = p10b (shared entry: 0.4 s after p10b computed it) | **30.1 s / 6 ms** | ≈ p8's 782 s (Oct 14) |
| Waivers, cold / warm | = p10b (shared entry) | **36.4 s / 2 ms** | ≈ p8's 1,186 s |
| IR, cold / warm | = p10b (shared entry) | **5.6 s / 63 ms** | ≈ p8's 396 s |
| Replay of a finished week (2025-26 weeks 5 / 12 / 20), cold | 2.9 / 1.6 / – s | **198 / 292 / 210 s** | |
| Replay, warm | 6 ms | **0.3–0.4 s** | |

- **Notifier watchdog (9 min).**
  - The worst game-day run measured is advise ~43 s + Waivers ~36 s + IR ~6 s, about 1.5 min.
  - The quiet-hours replay precompute takes 3.3–4.9 min. Each week is attempted only once (marker file), so a run
    killed by the watchdog cannot repeat all night.
- **Web requests.**
  - `next start` (self-hosted) does not enforce the routes' `maxDuration = 120`. Today's p7h Waivers already took
    ~3 min on Oct 14. Browsers don't time out a pending fetch.
  - **Cold `/api/advise` under p10b:** 4–45 s, depending on the number of tip-offs in the next 30 h and the number
    of held scores.
  - **Replay:** a week not yet precomputed takes 3–5 min on its first view, then it is cached for good.
  - **Matchups, Waivers, IR:** unchanged from p7h.
- **Why p10b costs what it does.** All the extra time is the P10b race, ~1–7 s per tip-off in the plan.
  - Projections, cut-offs and the option simulations are p7h's.
  - The race is single-threaded, so it barely competes with the worker-thread views: 43.4 s vs 42.1 s under
    contention.

## 6. Evidence that only the decisions change
- **`research/scratch/g/p7h_equiv.ts`.** It loads lockin-live's `lib/` (extracted from git) and engine-v2's in **one
  process**, on the **same** live contexts: Tuesday noon, and the Wednesday tip-off tick with 3 held scores. 11/11
  checks pass:
  - **Projections (3,000 weeks):** live code = engine-v2 p7h = engine-v2 **p10b**, bit for bit.
  - **Full advice on p7h** (decisions, plan, cut-offs, actions, outlook): live code = engine-v2, byte-identical JSON.
  - **p10b's decision options** (expected points of hold / lock / bench) = live code's.
  - **Cache fingerprints:**
    - live code = engine-v2 p7h, for both scopes;
    - p10b's mass-simulation fingerprints = live code's;
    - p10b's advise / replay fingerprints differ.
- **Unit tests** (`tests/engine_select.test.ts`, 71/71 overall), for the split:
  - policies per engine;
  - p10b projections and cut-off simulations equal p7h's;
  - fingerprint scopes;
  - every p10b hold/lock/bench call equals the engine's own first-tip-off decision (reproduced independently) and
    agrees with the plan's holds / forfeits;
  - `replayIsSlow` only for race engines.
- **Deploy rehearsal** (`research/scratch/g/rehearse.mjs`): clone `lockin-live` into /tmp, then run exactly the
  steps of §3. **All OK.**
  - `git merge --no-ff engine-v2`: clean.
  - `tsc` clean, `npm test` 71/71, `build:notify` OK.
  - `next build` OK. It was built with webpack in the rehearsal because the clone's node_modules is a symlink, which
    turbopack refuses. The live checkout has a real node_modules, so `npm run build` (turbopack) applies there.

## 7. Known behaviour to expect
- **Holds and the plan agree.** With p10b the hold/lock/bench reminders match the plan's first tip-off: holds and
  forfeits.
  - With p7h they could disagree. Example from the Wednesday tick: p7h's decision block said HOLD Stephon Castle
    while its plan let him go.
- **The next game day and tentative tip-offs.** The call is P10b's decision at the next tip-off. Any game still in
  progress before then is taken at its median score, and the call is recomputed on every notifier run (the same holds
  for the plan's later, "tentative" tip-offs).
- **Near-ties.** P10b will sometimes let go of a low held score when slots are scarce, where the quick simulations
  call it a near-tie. Example from the Friday tick: three slots locked and four players tipping. The reason text then
  says "near-tie".
- **Lock cut-offs.** The "lock if ≥ X" cut-offs are still computed with POLICY (as promised). They are a guide; the
  actual lock call is P10b's.
