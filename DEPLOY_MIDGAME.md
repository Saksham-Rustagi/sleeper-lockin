# Deploy: mid-game moves and Out players in a game in progress (task T2)

Sleeper rules confirmed by the user (supersede "pinned until his game ends"):
(a) a player can be moved at any time, also after his game has started; (b) moving him between STARTING slots keeps
that game (lockable after it ends); (c) BENCHING him mid-game forfeits that game and frees the slot at once for someone
whose game hasn't started; (d) he must be in the starting lineup before his game to count; lock-in is chosen after the
game, before his next one.

## What changes in the live advice
1. **Out / inactive in a game in progress** (`LiveGame.dnp`: injury tag Out-like, no stats): he scores 0 whether he
   stays or not, so benching him forfeits nothing. `buildWeek` no longer pins him (`st.inGame` / `st.pinned` unset,
   the game is marked started) -> his slot is free for the plan right now. The slot row still shows him (state
   "playing", `dnp`, stateText "out (scores 0 - bench him, forfeits nothing)"); the card says
   "Bench X now (Out - not playing in his game in progress, scores 0: benching him forfeits nothing)" followed by the
   player who uses the slot - immediately, not after his game ends. If nobody needs the slot he may stay
   ("... bench him any time - forfeits nothing, the slot is free now"). The notifier title flags him (⚠️ X OUT →).
   The old "stuck in this slot until the game ends (Sleeper locks him at tip)" text is gone.
2. **Players actually playing**: the Do-now card re-solves their slot like everyone else's (they must keep *a* starting
   slot, sticky to where they sit): "Move X UTIL 2 → PG (in his game now - moving between starting slots keeps it)" can
   be done now / before the next tip-off instead of waiting for his game to end. Only changes that take a player in a
   game out of the lineup or lock him wait for the game end (a lock is only possible after it; benching mid-game would
   forfeit it). The card never benches a player who is playing (that's task T3).

Files: `lib/live/week.ts` (dnp not pinned), `lib/live/advise.ts` (`teamView` state for a dnp occupant),
`lib/live/donow.ts` (placement, waits, texts), `lib/live/lineupnotify.ts` (dnp in the ⚠️ list). Tests:
`tests/latetip.test.ts`, `tests/donow.test.ts` (updated to the rules above). No engine/policy change: backtests and
fingerprints unchanged.

## Not changed (known limitation)
The engine itself (`lib/engine/core.ts` `startGroup`, P8/P10 candidates via `unpinnedOpen`) still treats a playing
player's slot as taken until his game ends, so its plan doesn't *count on* moving him to free a slot of a particular
position for a later tip-off. The card's placement does the repacking when the plan's line-up fits; a plan start that
only fits by moving a playing player is not found by the engine. Fixing that is an engine change (affects backtests),
left for a separate, backtested task.

## Deploy (lockin-live; the manager does this, not the overnight run)
1. `git merge engine-v2` (or cherry-pick the task T2 commit) into lockin-live; `npx tsc --noEmit -p .`; `npm test`.
2. Rebuild + restart the web app and the notifier as usual. No config switch, no cache migration (cached advice that
   still lists a dnp player under `playing` is tolerated).
3. Live check (own dirs, read-only): `npx esbuild research/donow_live.ts --bundle --platform=node --format=cjs
   --outfile=research/dist/donow_live.cjs --log-level=error && node research/t2_live.cjs`.

# Task T3: the mid-game FORFEIT option (bench a player whose game is in progress)

Rule (c) above, used by the engine: benching a player mid-game forfeits that game (he keeps his later games) and frees
his slot at once. Since T3 the engine evaluates that action and recommends it when it clearly pays.

## What changes (switch `"midgameForfeit"`, default ON; `LOCKIN_MIDGAME_FORFEIT=0/1` wins over the file)
1. **In-game estimate** (`lib/live/ingame.ts`, used by `buildWeek` for both teams): a player who has played in a game in
   progress gets his FINAL score for that game as the engine's model of it: points so far (league scoring of Sleeper's
   live stats = the matchup's players_points) + remaining minutes x points per minute, both shrunk to the pre-game
   projection (share of minutes prior 12 game-minutes, rate prior 20 minutes; Sleeper's projected seconds), sd scaled to
   the remaining minutes; play probability 1 (he has played). Out for the rest of the game (no remaining minutes):
   ejected (ESPN box score), fouled out (6 fouls), Sleeper tag Out/Inactive while he has stats and ESPN doesn't show him
   on the court, or ESPN's injury list reporting him Out after the tip. ESPN summaries of the games in progress of my and
   my opponent's players are fetched (1-min cache). Rows show "in game now (6.0 so far, ~13.5 expected; ends ~10:15 PM)".
   Without the switch (or without stats yet) the pre-game model is used exactly as before.
2. **Engine** (`lib/engine/midgame.ts`, `core.ts` `forfeitGame` + `beforeGroup` hook, `Game.pPlay` / `Game.live`): at the
   plan's first tip-off, every player of mine in a game in progress with in-game information whose game ends after that
   tip-off is evaluated (up to 4, lowest expected final first): the engine's own complete decision at the tip-off with him
   kept vs with him benched now (each by a fresh copy of the engine's hooks with the same seed - for p10b the full race),
   scored by 256 paired continuations played by the engine's base policy (p10b: P8 on the race workers). Recommended only
   if the gain is > max(1 pt, 2 se) AND the freed slot changes this tip-off's decision (someone starts / locks / keeps a
   held score); a gain that only comes at a later tip-off is "deferred" (keep him for now; re-checked when that tip-off is
   the next one), because benching earlier only gives up what the rest of his game shows. One forfeit per refresh.
3. **Timing**: a forfeit serves the tip-off it frees the slot for, so it is due at the last moment before it: the card says
   "Bench X at the last moment before 10:00 PM (...; re-checked until then)" while that tip-off is more than 20 min away,
   "Bench X now (...)" within 20 min.
4. **UI / notifier**: Do-now card: red banner "⚠️ BENCH X NOW / AT THE LAST MOMENT (forfeits his 6.0)" with the reason
   ("Bench Collin Murray-Boyles now - forfeits his 6.0 so far; frees C for Donovan Clingan at 10:00 PM, +1.9 exp pts"),
   the bench move in the change list (now, not after his game), the newcomer into the slot, no lock check for him; kept /
   deferred players as "In-game: Keep X in UTIL 1 for now ... may be worth +2.2 before the 10:30 PM tip-off" notes.
   Notifier: "⚠️ BENCH X NOW (forfeits his 6.0) → Y in C", sent once per player and tip-off in the last 20 min before it
   (earlier, the lineup reminder carries the change). `actions` lists it too.
5. Fingerprints: the advice fingerprint adds `midgame: 1` while the switch is on (off = the old fingerprints); team
   fingerprints add the in-game estimate's key (mean / sd rounded to 0.5 + out flag) of games in progress, so advice and
   projections are recomputed as a game in progress moves (about every 0.5 pt of expected final).
6. Also fixed: `scripts/notify.ts` set `LOCKIN_CACHE_DIR` to the live cache when merely imported (tests / research
   scripts importing `messages()` then read and could write the live app's disk cache); it is now set in `main()` only.

## Backtests are unchanged by construction (and checked)
Historical data has no in-game states: no `Game.live`, so `beforeGroup` finds no candidate and returns; `Game.pPlay` is
never set. Checked: backtest smoke (weeks 1-2, P2LAH + P7H, MIDGAME=1 at every tip-off) identical to the previous
bundle; the standard P10b season backtest with MIDGAME=1 identical to the published `s10` run (REPORT "Mid-game forfeit").

## Rollback
`"midgameForfeit": false` in `~/.sleeper-lockin/config.json` (re-read every 30 s, no restart) or env
`LOCKIN_MIDGAME_FORFEIT=0`: no in-game estimate, no mid-game check, the old fingerprints (cached results from before T3
are valid again). Code rollback: revert the T3 commits (engine changes are no-ops without in-game information).

## Deploy T3 (the manager)
1. Merge engine-v2 into lockin-live; `npx tsc --noEmit -p .`; `npm test` (134+ tests).
2. `npm run build:notify` (the race workers' bundle `scripts/dist/simworker.cjs` must include the new engine: in-game
   games carry `pPlay`; a stale bundle would play continuations without it) + rebuild/restart the web app and notifier.
3. Live check (own dirs, read-only): `npx esbuild research/t3_live.ts --bundle --platform=node --format=cjs
   --outfile=research/dist/t3_live.cjs --log-level=error && npx esbuild scripts/simworker.ts --bundle --platform=node
   --format=cjs --outfile=research/dist/simworker_t3.cjs --log-level=error && node research/dist/t3_live.cjs <league> <roster>`
   (or `REPLAY=research/scratch/t3/rec/rec_<ms>.json.gz node research/dist/t3_live.cjs - -` for a recorded moment).
