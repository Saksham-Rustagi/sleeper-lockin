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
