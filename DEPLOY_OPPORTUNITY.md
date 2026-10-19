# Deploying opportunity alerts (task O, 2026-10-19)

Two features. Both are **off by default**: after the merge the app behaves exactly as before until the config turns
them on. Results and the backtest are in research/REPORT.md, "Opportunity alerts".

- **Opportunity alerts** (notifier): "🚀 Opportunity: <player> (<team>) - <starter> out, 24 mpg last 3, ~X fp/g est,
  free agent in your league - add before <next tip>". They fire when a rotation player (>= 20 mpg) is newly ruled out
  (Out / IR / suspended) or when a free agent's minutes surge. Also "📈 Role up: ... (yours) - start him" when one of
  your players is the one expected to absorb the minutes and the estimate beats Sleeper's projection by >= 5.
  Each reminder has a short "Why: ..." body. Deduped by the notifier's sent-log; the "newly out" state is kept in
  `~/.sleeper-lockin/opportunity-state.json`.
- **Minutes override** (simulations): flagged players get a minutes-based projection (shrunk recent fp/min x expected
  minutes) in place of Sleeper's. It applies to This week, start/sit, Waivers, IR and league. It is used only where it
  raises the projection. Labelled `projOverride: "projection override: based on last N games (...)"` in the API, and
  marked in the UI (amber badge / `*`).
- Always on, read-only: the Waivers tab gets an "Opportunities (minutes)" card, and there is a `GET /api/opportunity?league=..&roster=..`
  endpoint (the scan report). Both are display only and don't change any simulation unless `minutesOverride` is on.

**Recommendation from the backtest** (2025-26, pre-registered):
- The minutes calls are right: the top candidate gained +8.1 min and +4.8 fp/g.
- But acting on the alerts gained about 0 real points in our league: +1.4 ± 3.6 over 2 weeks.
- The override did not make the Waivers page's predictions better calibrated.
- So enabling `opportunityAlerts` is reasonable as an information feed: rare, and with a clear "why". Leave
  `minutesOverride` off.

## 1. Files (engine-v2 vs lockin-live)
New: `lib/live/opportunity.ts` (detector, surge watch, overrides, alert texts; pure), `lib/live/boxscores.ts` (ESPN
box-score store), `lib/live/oppscan.ts` (live scan), `lib/live/override.ts` (config switches + override hash),
`app/api/opportunity/route.ts`, `tests/opportunity.test.ts`, `tests/override_week.test.ts`.
Changed: `lib/live/week.ts` (override in buildWeek, live only), `lib/live/waivers.ts` (flagged free agents in the pool,
label), `lib/live/advise.ts` (labels), `lib/live/cache.ts` (override hash in fingerprints when on),
`lib/live/sources.ts` (ESPN `seasonType`, `pastWeekStats`, `preseasonStats`), `scripts/notify.ts` (alerts block),
`app/live/page.tsx` (card + labels). No package / config file changes.

## 2. Config keys (`~/.sleeper-lockin/config.json`, re-read every 30 s, no restart)
```
"opportunityAlerts": true     // notifier reminders (default false)
"minutesOverride": true       // minutes-based projections in the simulations (default false; not recommended)
```
Env overrides for testing: `LOCKIN_OPPORTUNITY_ALERTS=1|0`, `LOCKIN_MINUTES_OVERRIDE=1|0`.

## 3. Steps (manager)
1. Merge `engine-v2` into `lockin-live` in the live checkout. Then run `npx tsc --noEmit -p .` and `npm test`
   (91 tests).
2. `npm run build:notify` (the notifier bundle) and `npm run build` (the web app); restart the web app the usual way.
3. Optional: `DRY_RUN=1 FORCE=1 NO_COLLECT=1 LOCKIN_OPPORTUNITY_ALERTS=1 npm run notify` prints what it would send.
   - The first run with alerts on marks every current absence as old, so it sends no flood.
   - The first scan backfills the season's box scores into `~/.sleeper-lockin/cache/boxscores/<season>.json`, at most
     60 games per run. During the season that is ~6 MB.
4. Set `"opportunityAlerts": true` in the config.

## 4. Rollback
- Set `"opportunityAlerts": false` / `"minutesOverride": false`, or remove the keys. This takes effect within 30 s
  and needs no restart. With the override off, fingerprints and cached results are identical to before.
- Full rollback: revert the merge commit on `lockin-live`, rebuild (`npm run build:notify`, `npm run build`) and restart.
  The files `~/.sleeper-lockin/opportunity-state.json` and `~/.sleeper-lockin/cache/boxscores/` can be deleted.

## 5. Cost (measured on this Mac, 2026-10-19, real league, own cache dir)
- Cold scan: 11.1 s. That covers fetching 67 preseason box scores and last season's 25 weekly stat files (cached for
  7 days on disk).
- Warm scan: < 0.1 s, plus at most one ESPN scoreboard per day not yet complete.
- In the regular season expect ~5-8 new games per notifier run on game nights.
- The override, when on, costs one scan per league per 10 minutes, shared by every buildWeek call.
- ESPN parser check: on 1,952 preseason player-games against Sleeper's own stat rows, minutes are within 0.24 on
  average and league fp match exactly in 97.5%. The rest differ by technical fouls, which ESPN's box doesn't list.

## 6. Known behaviour
- **Preseason / first week:** with fewer than 3 regular-season games, minutes come from the preseason (flagged in
  the notes).
  - Preseason rotations are noisy, e.g. starters who rested show up as "absorbing" minutes.
  - The "only raise" rule keeps such cases from lowering a projection.
- **Depth chart:** Sleeper's `depth_chart_order` adds +1.5 min to the next player at the absent player's depth
  position. There is no history, so this part is not validated.
- **Name matching:** ESPN names are matched to Sleeper players by normalised name (suffixes and accents removed;
  ambiguous names by team). Unmatched names are listed in the scan's notes. On 2026-10-19: 14 of ~600, mostly
  two-way / camp players.
- **Example (the manager's Leonard Miller case, 2026-10-19):**
  - He played 14-23 min in preseason (20.7 mpg last 3, 30.6 fp/36 shrunk), and Sleeper has no week-1 projection row.
  - The calibrated surge model expects 16.7 min, about 14.2 fp/g. That is just under the pre-registered 15 fp/g floor,
    so there is no alert yet.
  - Recent minutes regress strongly in the 2024-25 data the model was fitted on; see the REPORT.
