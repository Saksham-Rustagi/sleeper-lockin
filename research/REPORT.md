# Lock-In algorithm research: backtest on the real 2025-26 season

**Data:** league "late night fun" (1213196707089616896). 23 weeks × 10 teams = **230 real team-weeks**.
- Each week's real roster comes from Sleeper's matchup history.
- Real per-game fantasy points, calculated with your league's scoring.
- Sleeper's per-game projections from that season.
- ESPN tip-off times for all 166 game days.
- The managers' real weekly scores.

**Rules modelled:** Sleeper support article 6522833, plus behaviour confirmed by Sleeper staff in community threads.
- A game is lockable only if the player started it.
- He is stuck in his slot while his game is in progress.
- You can lock any time before his next tip-off, unless he touches the bench.
- A slot can be reused later the same day.
- An unlocked starter's final game of the week counts automatically.

**No look-ahead:** each week's projection correction, score spread and sit-out model are fitted only on earlier weeks.
- Sleeper's stored projections leak sit-outs: a projection exists for 99.5% of games that were played and only 2% of games that weren't. So the bots never see whether a projection exists. Sit-out odds come only from whether the player played his last game (P(play | played last) ≈ 0.93).
- The projection values correlate 0.50 with actual scores, which is normal for single-game forecasts.

## Policies
| | Description |
|---|---|
| APP | Your current app's logic: shortcut lineup matching, raw projections, lock if score ≥ best future projection |
| P1 | Exact lineup matching + "option value" lock rule (includes sit-out odds) + same-day slot reuse |
| P2 | P1 + hold players and decide at the deadline + save slots for overlapping later games |
| P2_NOCHAIN | P2 without same-day slot reuse |
| **P3** | **P2 + Monte-Carlo simulation (200 runs of the rest of the week) at every close lock decision, maximizing points** |
| P4 / P4S | Same as P3 but maximizing the chance of beating the opponent's simulated week (straight win/loss count / smoothed) |

## Results (paired: same team, same week, same real games)
| | Pts/week | vs APP | Win% vs real opponent's actual score |
|---|---|---|---|
| Human managers (actual) | 232.5 | — | 50.0% |
| APP (current) | 262.5 | — | 55.4% |
| P1 | 270.3 | +7.7 ± 3.6 | 57.9% |
| P2 | 271.0 | +8.5 ± 4.3 | 59.8% |
| **P3** | **274.6** | **+12.1 ± 4.0** | **60.3%** |
| P4S (smoothed win chance) | 272.2 | +9.7 ± 4.1 | 60.3% |
| Perfect hindsight (not achievable) | 317.5 | | |

- Same-day slot reuse is worth **+8.7 ± 2.4** (P2 vs P2_NOCHAIN).
- Simulation adds **+3.6 ± 2.0** over the best rule-based policy.
- Against a strong bot opponent (P2), P3 wins **56.1%**.
- Short weeks (All-Star/holiday, 5 days or fewer): APP 213 → P3 239.
- P3's weekly average beat APP's in 20 of 23 weeks.
- Optimizing win chance directly was no better than optimizing points. Straight win/loss counts are too noisy at 200 runs, and smoothing only matched P3. In head-to-head weekly matchups, expected points is the right target, with win chance as an optional tilt late in the week.
- Your team (roster 8) in 2025: you scored 257.8/week; P3 would have averaged 287.6, beating your real score in 15 of 23 weeks.
- P3 captures 86.5% of the hindsight ceiling (APP: 82.7%). Hindsight is a loose bound, so the true remaining headroom is smaller.

## Caveats
- The backtest has no pre-game injury news or inactive lists. The real app gets Sleeper injury status and can swap before tip-off, so live results should be at least this good.
- Game end is assumed to be tip-off + 2.5h. The live app should use ESPN's game status.
- Positions come from current player data, which is approximate for 2025.
- Single team-weeks are noisy: P3 loses to APP in about a third of team-weeks. The edge shows up over a season.

## Reproduce
`python3 /root/sleeper/research/fetch_season.py && python3 /root/sleeper/research/build_dataset.py`
then `npx tsx research/backtest.ts 1 23 APP,P1,P2,P3,P4S research/out/x.json 200` and `python3 research/analyze.py research/out/x.json`.
Engine: `research/engine.ts`.

## Lock-aware placement (added later)
- Starters are placed in the slot where they'd be locked after a good game.
- When a lock in the player's current slot is within noise of the best slot, he's locked in place. UTIL 1 and UTIL 2 count as interchangeable.
- Full strategy with simulation: locks needing a slot move first fell from 58% to 35%. Points/week 274.2 vs 274.6 (−0.5 ± 1.25, not significant).
