# Deploying the "Do now" lineup card (task U, 2026-10-21) - before the Wed Oct 21 7:00 PM ET tip

**Problem.** The Live page's "Do now" card was a list of engine calls in words ("HOLD X in a starting slot", "Before
7:00 PM: move held ... → PG", cut-offs). It said what the engine decided, not what to set in Sleeper.

**Now.** The card opens with **"Set your lineup to (before the <next tip-off>)"**: all 9 starting slots in Sleeper
order, each with player + short status + the change to make:

| status examples | meaning |
|---|---|
| `held 15.5 - keep, don't lock (lock-if 23.9) · next game Fri 9:30 PM` | held score the engine keeps |
| `plays 7:00 PM vs ORL (proj 35.9) · lock if ≥ 33.2` | starts at that tip-off |
| `plays 10:00 PM vs LAL (proj 19.4) · set now, slot unused before` | later starter today whose slot nobody needs before: set now |
| `free roll - Out, 3% to play (7:00 PM)` | Out player started only because nobody needs the slot |
| `LOCK now (41.5 ≥ lock-if 27.3)` | lock decision (plus a big purple banner: who, slot, deadline) |
| `locked 30.0` | fixed |
| `in game now (ends ~9:15 PM) · lock if ≥ 28.0` | pinned; his slot's change waits for the game end |
| `no game at 7:00 PM - can stay` / `empty until ~9:15 PM` | harmless idle player / empty slot filled later |

- Rows that need a change are highlighted: `change: swap Black (SG) ↔ Wallace (PG)`, `put Green in PF`,
  `bench Mobley (no game today)`, `move Wallace PG → UTIL 1 (held 15.5 - ... never via the bench)`.
- Below: **"Do now, in this order"** (benches first so slots are free, held players moved between starting slots, then
  swaps / new starters, locks last), or a green **"Your lineup is already correct - nothing to do until ~9:30 PM, when
  Garland's game ends."**
- **"Then"** timeline: per later tip-off / game end today, only the changes and when ("~9:30 PM, when Black & Johnson's
  games end (changes due before the 10:00 PM tip-off): Johnson: lock him if he scores ≥ 33.2; bench Black; put
  Gillespie in PG"), flagged *tentative* (median path, re-planned as games finish) and *tight* when the engine reuses a
  slot right at the next tip.
- **Bench** list (who sits at which tip-off and why, held scores the plan lets go).
- The old list of engine calls is kept under a collapsed "Details"; all other cards are unchanged. Mobile: rows stack
  (slot | player + status + change), stats are a 2-column grid on phones, the tab bar scrolls.

**Reminders** (`scripts/notify.ts`): the lineup reminder 75 min before a tip-off is now the concrete diff:
title `🏀 Before Wed 7:00 PM: PG Anthony Black (free roll), SG Cason Wallace (held 5.0), SF Jalen Johnson, PF Draymond
Green, UTIL 1 Caleb Wilson` (≤ 150 chars, "…" beyond), body = the ordered changes + the first "Then" step + lock
cut-offs (≤ 400 chars). Dedupe key `lineup|<tip>|<changed slots>` (same diff = no repeat). The `⚠️ X OUT →` prefix,
lock / hold / final-call reminders and the "lineup is set" cut-off reminder are unchanged (the lock title uses the
card's slot).

## How the target lineup is built (`lib/live/donow.ts`, pure)
Input: `me.slots` (Sleeper now), `plan` (engine lineup per tip-off, next 30 h), `decisions`.
1. Per tip-off: fixed occupants = locks (incl. the plan's new locks at that tip-off, exact slot from the engine state),
   players still in a game, that tip-off's starters; held scores are placed afterwards.
2. Starters of one tip-off are re-arranged among slots **of the same names** as the engine chose (they are all pinned
   for the same stretch, so this cannot change the future) to keep players where they sit and not push held scores out;
   a relabel (UTIL 1 ↔ UTIL 2) is carried to later engine placements while those players are in their game. A lock
   goes into his own slot when an identical one was chosen.
3. Held scores stay where they sit when that slot is free; the rest are matched to free slots they can play (engine's
   slot first); fallback: the engine's placement. A HOLD / LOCK call is never dropped.
4. Previous occupants the plan doesn't use stay when harmless (no game at that tip-off), a displaced one takes the
   newcomer's old slot (one swap); players the plan sits at that tip-off, forfeits and BENCH calls go to the bench.
5. Later starters today whose slot is unused until their game are set now.
6. Diff (swap / move / put in / bench / LOCK); a change touching a player in a game now, or his slot, waits for that
   game's end (closed under chains). Two passes: the second arranges later tip-offs around the first pass's lineups.

Server side (`lib/live/advise.ts`): `TipPlan` gains `locks` (new locks at that tip-off, exact slot), `playing` (players
still in an earlier game, slot, estimated end), starts get `opp` / `end`, benched gets `pid`, held players keep their
slot from the previous tip-off when free (`from` / `move` for every tip-off); `TeamView.slots` gains `gameEnd` /
`lockIf` for a player in a game; `Advice.doNow` is recomputed on every request (not served stale from the cache).
Advise cache version 13 → 14. Engine decisions are unchanged (display only).

## Files
`lib/live/donow.ts` (new), `lib/live/advise.ts`, `app/live/page.tsx`, `scripts/notify.ts`, `tests/donow.test.ts`
(new, 7 tests), `tests/notify.test.ts` (fixtures with slot names; assertions on the new reminder text),
`research/donow_live.ts` (live check).

## Checks
- `npx tsc --noEmit -p .` clean; `npm test` 106/106.
- Live (league 1344387394811490304, roster 8, Wed Oct 21 11:41 ET, own cache/config `research/scratch/donow/`):
  `node research/dist/donow_live.cjs 1344387394811490304 8` prints the card as text and the reminders
  (`research/scratch/donow/live_final.txt`); phone-width screenshot from a dev server on port 3107 with its own dirs
  (`research/scratch/donow/dev.sh`, `shot.sh` -> `live_phone.png`).

## Deploy
Merge the commit into lockin-live; `npx tsc --noEmit -p .`; `npm test`; rebuild and restart the app and the notifier
the usual way (DEPLOY_P10B.md section 8, incl. `npm run build:notify`). The cache version bump recomputes the advice once.

## Rollback
`git revert <this commit>` on lockin-live, rebuild, restart. The engine's decisions do not depend on this code.
