# Deploying sticky lineups + reminders without flip-flops (task S, 2026-10-21)

**Problem (live, Wed Oct 21).** The notifier's lineup reminders flip-flopped before the 7:00 PM tip:
5:48 PM "PG Cason Wallace (held 5.0), SG Anthony Black (free roll), PF Draymond Green, C Collin Murray-Boyles";
6:08 PM the same with PF Jalen Johnson; 6:19 PM "lineup is set"; 6:24 PM "PG Anthony Black (free roll), SG Cason Wallace
(held 5.0)", a pure swap of two PG/SG players; at 6:27 the card said "no changes" again with the opposite arrangement.
The cause: the engine picks a slot among equally good ones arbitrarily (Monte-Carlo ordering, slot order). The card
only re-arranged players among slots *of the same name* (UTIL 1 ↔ UTIL 2), so a PG ↔ SG relabel became a "swap", and the
reminder key (changed slots) was new each time.

## 1. Sticky target lineup (`lib/live/donow.ts`)
The plan still decides **who** starts / holds / locks / sits at each tip-off. **Where** each one goes is re-solved per
tip-off by one search over the free slots (fixed: locks, players in a game, pinned where *we* put them), lexicographic:
1. as many of that tip-off's occupants placed as possible;
2. every later tip-off in the plan still placeable: a backtracking forward search (narrowest slot first, first
   feasible path wins; budgets 500 leaves per candidate, 20000 per tip-off, 20000 nodes). A slot is freed or a held
   player moved *now* only if a later planned move needs it;
3. as many players as possible stay where they sit (Sleeper now; later tip-offs: our previous lineup);
4. anyone who moves or comes in: the narrowest slot he fits (PG 1 position … UTIL 5), then the slot of a player going
   to the bench (one swap in Sleeper), then an empty slot, then Sleeper order.

The engine's slot is no longer a tie-break (it made the card follow the engine's relabels); it is used only for a lock
(the slot name is kept: a locked slot is consumed for the rest of the week) and for a player whose positions are
unknown. Replaces the old "same-name re-arrangement + held-score placement + relabel carry + second pass". New output:
`DoNow.target` (slot, player, kind, tip, expected points) for the notifier.

## 2./3. Materiality, hysteresis, reasons (`lib/live/lineupnotify.ts`, pure; `scripts/notify.ts`)
Per tip-off the notifier keeps a memo in `~/.sleeper-lockin/lineup-state.json` (recommended starters, expected points
tonight per player, injury tags, finished-game scores, the Sleeper lineup, what was last sent; pruned a day after the
tip-off; not written with DRY_RUN).
- **Materiality.** With sticky placement every proposed change alters who starts / holds / sits, or is a move a later
  planned move needs; pure relabels produce no change, hence no reminder.
- **Hysteresis (0.5 pts).** If the new starters differ from the reference (the last recommendation; first run: who is in
  Sleeper with a game tonight) only by swapping players whose expected points tonight (projection × play probability)
  are < 0.5 apart, and nothing about those players changed (injury tag, projection ≥ 0.5) and no game ended / lineup
  edit happened, the reference is kept and nothing is sent. 0.5 = P10b's race acceptance (`minGain`); smaller
  differences are inside Monte-Carlo noise.
- **After a reminder for this tip-off** ("set your lineup to" or "lineup is set"), a new change is sent only with a named
  reason: an injury tag changed, a game ended, a projection moved ≥ 0.5, or the Sleeper lineup changed. Title prefix
  🔄 (⚠️ when a starter is ruled out), body starts with "Changed because: Draymond Green questionable → out." The same
  change list is never re-sent (memo key + the sent-log); "lineup is set" is sent once per tip-off.
- Logged per run: `lineup: <why sent / not sent>` (e.g. `hysteresis: kept A (20.2) over B (20.4) …`).

Engine decisions are unchanged (display / notification only).

## Files
`lib/live/donow.ts`, `lib/live/lineupnotify.ts` (new), `scripts/notify.ts` (`messages(a, now, state?, notes?)`; the
old signature still works, stateless), `tests/donow.test.ts` (4 fixtures updated to sticky placement, 4 new),
`tests/lineupnotify.test.ts` (new, 4), `research/s_live.ts` (live check).

## Checks
- `npx tsc --noEmit -p .` clean; `npm test` 114/114.
- Live (read-only copies of the notifier's cached advice at 6:44 PM ET and today's `advice.jsonl`; nothing written
  outside the worktree): `npx tsx research/s_live.ts <advise cache json> <advice.jsonl> ./scratch/sticky/old_donow.ts`.
  Sleeper had PG Wallace / SG Black, the engine said PG Black / SG Wallace: old card "Swap Anthony Black (SG) ↔ Cason
  Wallace (PG)", new card only "Put Cedric Coward in SF" (8:00 PM starter into an empty slot nobody uses before).
  10 runs with the engine's slot labels re-drawn at random among valid placements: new card identical in all 10
  (old: 10 different change lists). Notifier replay of today's 41 logged plans + the live one: one reminder (6:08 PM),
  then nothing (6:19, 6:24, 6:44: "same changes as the last reminder"). doNow ≈ 15 ms on tonight's 8-tip-off plan.

## Deploy
Merge into lockin-live; `npx tsc --noEmit -p .`; `npm test`; rebuild and restart the app and the notifier the usual way
(DEPLOY_P10B.md section 8, incl. `npm run build:notify`). No cache version bump needed (doNow is recomputed per
request). The first notifier run per tip-off has no memo: it behaves as before except the hysteresis vs the Sleeper
lineup.

## Rollback
`git revert <this commit>` on lockin-live, rebuild, restart; delete `~/.sleeper-lockin/lineup-state.json` (optional,
ignored by the old code).
