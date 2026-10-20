# Deploying the NBA roster check (task R, 2026-10-20) - before the Wed Oct 21 games

**Bug.** Kevin Porter Jr. (Sleeper pid 2009, roster 8) was waived by MIL on Oct 19. Sleeper still lists him on MIL and
has dropped his per-game projection rows, so buildWeek fell back to his season projection and planned him at 21.3 fp
for each of MIL's games (Oct 21/23/24), even though he can't play in them.

**Fix.** The app now reads current NBA rosters from ESPN (`site.api.espn.com/.../teams/{id}/roster`, 30 teams, cached
1 h; on disk too when `LOCKIN_CACHE_DIR` is set). A player whose Sleeper team's roster doesn't list him gets no games
for that team. The label reads "not on MIL roster (waived/released) - no games until he signs". It shows in the advise
notes, on the player row (`rosterNote`, red "not on roster" badge) and in Waivers (`rosterNote`). If ESPN lists him on
another team, that team's games are used from then on. This covers Sleeper still showing the old team, or no team.
It applies to every live path: This week (me and the opponent), start/sit, the P10b race, Waivers (the free-agent pool
and game counts), IR, league, and the opportunity scan (no candidate, surge or no-projection estimate built from his old
team's minutes). Replay is unchanged.

**Fail-safe.** If the ESPN fetch fails, nothing changes, and the failure is remembered for 5 min so buildWeek stays
fast. Nothing changes for a team that is missing or lists fewer than 13 players. Nothing changes for a player when
someone on his team's roster has the same last name (that could be a name variant, e.g. Nic / Nicolas). Games that
have already started or finished are never removed.

## Files
New: `lib/live/nbarosters.ts`, `tests/rostercheck.test.ts`, `research/r_live.ts`.
Changed: `lib/live/sources.ts` (`espnTeams`, `espnRoster`), `lib/live/override.ts` (switch `rosterCheck`, default
ON), `lib/live/week.ts`, `lib/live/waivers.ts`, `lib/live/oppscan.ts`, `lib/live/advise.ts`, `app/live/page.tsx`.
It uses `normName` from `lib/live/boxscores.ts` and `optionOn` from `lib/live/override.ts` (task O). If lockin-live
doesn't have task O yet, bring those two files along.
No package or config changes.

## Switch
Default **on**. To turn it off, set `"rosterCheck": false` in `~/.sleeper-lockin/config.json` (re-read every 30 s, no
restart), or set env `LOCKIN_ROSTER_CHECK=0`. Cached results recompute by themselves, because a player's games are part
of every fingerprint.

## Deploy
Merge the task-R commit into lockin-live. Then run `npx tsc --noEmit -p .` and `npm test` (96 tests), and rebuild and
restart the app and the notifier the usual way (DEPLOY_P10B.md section 8).

To check it on live data with a throwaway cache:
```
npx esbuild research/r_live.ts --bundle --platform=node --format=cjs --outfile=research/dist/r_live.cjs --log-level=error
node research/dist/r_live.cjs <leagueId> 8
```
Expected (2026-10-20): Porter "before: 2026-10-21 MIL vs WAS 21.3; 10-23 MIL vs CHI 21.3; 10-24 MIL vs PHI 21.3 /
after: no games". He is the only rostered player in the league that changes. After deploying, /api/advise should list
the note, and Porter should show no games.

## Rollback
Set `"rosterCheck": false`, or revert the commit.
