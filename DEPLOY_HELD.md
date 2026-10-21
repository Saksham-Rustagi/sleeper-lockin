# Deploying "held vs locked" (task L-held, 2026-10-21) - before the Wed Oct 21 7:00 PM ET tip

**Bug.** In live mode `lib/live/week.ts` treated every starting slot with nonzero Sleeper `starters_points` as LOCKED.
Sleeper's API has no lock flag, and in Lock-In a finished game's score is only HELD until the player's next tip-off.
Live on Wed 00:39 ET: my Cason Wallace 5.0, Isaiah Hartenstein 7.0 and Stephon Castle 15.5 (Tue games, next games
Thu/Thu/Fri) were locked, so three slots were dead for the week (win 0.5% in our check, 2.6% in the app). The opponent's
Shai Gilgeous-Alexander 42.5 and Paul George 46.5 (next games Thu / Fri) were locked too. A live game with points would
also have been read as locked instead of in progress.

**Fix.** `inferSlot` (lib/live/week.ts) reads each slot from evidence, for both teams:
1. a user lock toggle wins (lock = locked at Sleeper's score; unlock = never inferred locked);
2. his game is in progress -> in game (pinned), unless the slot still shows an EARLIER game's nonzero score while the
   live game's points differ -> locked;
3. last game finished, next game not tipped -> HELD at Sleeper's slot score: the engine decides lock / hold / let go
   (P10b for me, the opponent policy for the opponent); no game left -> the held score is final -> locked ("final");
4. locked only with evidence: a later game has finished but the slot still shows an earlier game's score.
Edge cases: a slot score of 0 is never inferred locked; a score equal to both the last and an earlier game is read as
held (reversible, noted); a score matching no game (stat correction) is held at Sleeper's number (noted); slot 0 after
a nonzero game = he wasn't started for it, holds nothing. Unusual readings are listed in the advise notes.

**Out players.** The plan's median path now treats a game the injury report makes unlikely (Out 3%, Doubtful 25%) as a
DNP (it used to "play" him and then show him holding his projection). Plan rows for such a player carry
`playProb`, `expected` and a label ("Out - 3% to play (exp 0.6)"); he stays listed as a start only as a **free roll**
(no player likely to play who fits his slot is benched at a tip-off before his game ends); otherwise he moves to the
bench list with "don't start (PG is needed by X)", and the actions say so. Out applies to the next game only (as
before); the sit-out chain then gives 24% for the game after a DNP, and Sleeper's tag is re-read before each tip-off.

**UI.** Slot badges show "held (decide by Thu 7:30 PM)", "locked", "locked (final game)", "locked (marked by you)";
the card shows held points separately from locked points; the toggles still read "mark locked" (held / idle slot) and
"mark unlocked" (locked slot). Plan rows show the Out label; the notifier's start message includes it.

## Files
Changed: `lib/live/week.ts` (`inferSlot`, slot loop, note), `lib/live/advise.ts` (TeamView `state: "held"`,
`stateText`, `heldUntil`; plan median path, Out labels, free-roll check, actions; advise cache version 13),
`app/live/page.tsx`, `scripts/notify.ts`.
New: `tests/held.test.ts`, `research/held_live.ts` (live check).
No package or config changes. Replay and the research backtest are unchanged (live-only code; the backtest bundle has
no `lib/live` input).

## Deploy
Merge the commit into lockin-live; `npx tsc --noEmit -p .`; `npm test`; rebuild and restart the app and the notifier
the usual way (DEPLOY_P10B.md section 8, incl. `npm run build:notify`). The advise cache version bump makes cached
advice recompute on the first view.

Check on live data with a throwaway cache and config (never the live app's):
```
npx esbuild research/held_live.ts --bundle --platform=node --format=cjs --outfile=research/dist/held_live.cjs --log-level=error
LOCKIN_CACHE_DIR=/tmp/held/cache LOCKIN_CONFIG_DIR=<dir with a copy of config.json> node research/dist/held_live.cjs <leagueId> <rosterId>
```

## Rollback
`git revert <this commit>` on lockin-live, rebuild, restart. Short of that: the lock toggles in the UI can mark any
slot locked / unlocked by hand (that path is unchanged).
