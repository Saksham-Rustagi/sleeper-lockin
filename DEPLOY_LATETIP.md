# Deploy: late tips and Out players in a game in progress (task T, urgent live fix)

## The bugs (live, Wed Oct 21, 7:36-7:44 PM ET)
1. CHI @ TOR was scheduled 7:30 PM but still "pre" at 7:40 (NBA tips run ~10 min late). The engine only plans events
   after "now", so the 7:30 tip-off group was skipped: its players never started in the plan, the card jumped to the
   8:00 PM tip and said "Bench Caleb Wilson (no game today)", "Bench Collin Murray-Boyles (no game today)",
   "Leonard Miller: no game at 8:00 PM - can stay". Following it forfeits their games.
2. Anthony Black (Sleeper Out) sat in a starting slot while ATL @ ORL was in progress: the card said "in game now
   (ends ~9:30 PM) - lock if >= 23.2" and the timeline "Anthony Black: lock him if he scores >= 23.2" (the injury tag
   was applied to his NEXT game, so tonight's was simulated as a normal game).

## The fix
- `lib/live/week.ts` (live mode only; replay / research unchanged):
  - `lateTip`: a game past its scheduled tip but still "pre" tips at max(scheduled, now) = the next 5-minute mark after
    now (stable across refreshes; 1 min before the next scheduled tip-off group so they aren't merged). `LiveGame.late`
    = the scheduled tip.
  - `expectedEnd`: a late tip ends ~2h15 after its expected tip (at least scheduled + 2.5 h); a game in progress ends
    from ESPN's period / clock (2.5 real s per game-clock s + 15 min halftime before it; at least 5 min from now), else
    scheduled + 2.5 h as before. (`lib/live/sources.ts`: `EspnGame.period / clock`.)
  - `outInGame`: Out / inactive / suspended tag and no stats (gp / sp / min) while his game is in progress -> that game
    is a DNP (`LiveGame.dnp`; the injury play probability applies to it - 0 - instead of to his next game). If he has
    stats he is treated normally.
- `lib/live/advise.ts`: `TipPlan.late` and "7:30 PM (late tip - not tipped yet)" as the tip-off name; Out-in-game slots
  get `dnp` / `team` and no lock cut-off; a 0 from a game he didn't play holds nothing in the plan (the slot is free).
  Advice cache version 14 -> 15 (recomputed once).
- `lib/live/donow.ts`: "plays 7:30 PM (late tip) vs TOR"; Out-in-game status "Out - scores 0; stuck in this slot until
  the ORL game ends ~9:30 PM (Sleeper locks him at tip)", no "lock him if" for him, his slot is reused after the game;
  "no game today" only when he has no game on that date ("next game 10:00 PM", "his game today is over" otherwise).
- Notifier (`scripts/notify.ts`, `lib/live/lineupnotify.ts`): the lineup memo and reminder keys of a late tip use its
  scheduled tip (its expected time moves every 5 min - no repeated reminders); an Out player stuck in a game in progress
  isn't listed as "scratched" (he can't be moved).
- Tests: `tests/latetip.test.ts` (helpers; the card for both cases; buildWeek + advice on a stubbed Sleeper + ESPN
  backend reproducing 7:40 PM Oct 21).

## Deploy
Merge the commit into lockin-live; `npx tsc --noEmit -p .`; `npm test`; rebuild and restart the app and the notifier
the usual way (DEPLOY_P10B.md section 8, incl. `npm run build:notify`).

## Known limits
- A late game's expected tip is a guess (next 5 min); if it slips further it moves on the next refresh. Moves that
  depend on it say "late tip" in the card - set the lineup now, don't wait.
- A held player whose next game is a late tip: the "final call" reminder key uses the decision's deadline, which moves
  with the expected tip (a repeat is possible during a long delay).
- "Out" with no stats is read as not playing; Sleeper / ESPN stats for a player who checks in late arrive within a
  minute or two, after which he is treated normally.

## Rollback
`git revert <this commit>` on lockin-live, rebuild, restart.
