# Task W: which method should the Waivers page use? (season-long waiver backtest)

The design ("Pre-registered design", below) was committed before any real-outcome result existed (commit d5b9b38,
"task W pre-registration"). Everything changed or added after that is listed in "Changes after the pre-registration".

## Findings in plain English
Setup: every week, for every team, each method picks at most one add/drop from that week's real free agents before the
week starts. The edited roster is then played on the real games by P8 (the base policy of the live P10b engine) and
compared with the unedited roster. 880 team-week decisions: 220 in our real league (2025-26) and 660 in three
synthetic 2024-25 leagues. P8f ran on 220 + 110 of them.

1. **In our real league the page's suggestions would not have gained points.** The current method suggests a move
   in 86% of team-weeks.
   - Its own simulations promise +8.4 pts per pick.
   - On the real games: **−1.6 ± 3.6** pts over the 2 weeks it targets, and −0.9 ± 13.8 over the rest of the season
     with the pickup kept.
   - The perfect-hindsight measure (lower noise) gives +1.0 ± 1.8 over the 2 weeks and +2.8 ± 3.8 for the rest of
     the season.
   - So the gain is about zero, at most a couple of points.
2. **Where waivers have real value, the method works and its predictions hold.** The 2024-25 synthetic leagues are
   drafted and never managed, so good free agents (undrafted rookies, breakouts) are left lying around.
   - There the same method gains **+8.8 ± 3.7** pts over 2 weeks and **+32 ± 13** over the rest of the season.
   - Its predictions are roughly right: predicted +11.8, realized +8.9 (P8) and +9.7 (hindsight).
3. **Why our league is different: the free agents left are part-time players, and the pre-week model overrates them.**
   - The page's adds in 2025-26 played only **59%** of their games (2024-25 adds: 88%).
   - They averaged 9.0 pts/game against a projection of 23.9. 41% of their games were DNPs without any Sleeper
     projection row; the model counts those at the player's last projection and a ~93% chance of playing (if he
     played his last game).
   - The managers in our league already take the reliable free agents.
   - The live page has injury tags, which this backtest doesn't. That helps with injuries, but not with
     coach's-decision DNPs, which is what most of these were.
4. **No alternative beats the current method.** Pooled over both seasons, method minus current (pre-registered P8
   metric):

   | method | 2 weeks | rest of season |
   |---|---|---|
   | P8f simulations | +0.9 ± 2.2 | +1.4 ± 4.7 |
   | ROS term | −0.1 ± 1.4 | −0.8 ± 5.9 |
   | naive | −1.0 ± 2.1 | −1.3 ± 6.0 |

   - Where waivers matter (2024-25), the naive baseline is clearly worse: −20 ± 12 over the rest of the season. The
     sanity check passes.
   - The live code's N = 2000 vs the task's N = 300 (2025-26 only): +0.8 ± 2.0 / +3.7 ± 6.7, a tie at 6.5× the compute.
5. **"Drop X gains points" nonsense is common in the current valuation, and the search selects for it.**
   - The pick's drop is itself valued as a gain (removing a player "adds" points) in **58%** of picks in 2025-26 and
     **71%** in 2024-25.
   - **72% / 88%** of picks are worth more with the drop than the add alone. The search picks the max of 18 noisy
     moves, so it harvests POLICY's non-monotonicity and noise (a winner's curse).
   - At N = 2000 the bias is no longer hidden by noise: 4.3% of all drop evaluations show a significant gain.
   - P8f roughly halves it (drop-alone gain in 23% / 45% of picks; drop adds value in 41% / 63%). That doesn't
     show up as more real points.
6. **The exploratory fix did not replicate.** It capped each player's play probability at his recent played share
   (policyA). It was added after seeing the results:
   - 2025-26: +8.0 ± 5.5 pts vs current over the rest of the season.
   - 2024-25: −2.6 ± 3.8.
   - Pooled: +0.8 ± 3.1.
   - Not recommended on this evidence.
7. **The real-outcome metric is very noisy.** P8's play on real games is chaotic: one changed sit-out state moved a
   single team-week by 45 pts. Rest-of-season CIs are therefore ±10–17 pts per decision.
   - The hindsight evaluator's CIs are 2–4× tighter.
   - It agrees with every conclusion above: pooled method minus current is +0.3 ± 0.8 for P8f, −0.3 ± 1.0 for ROS
     and −0.5 ± 1.3 for naive over 2 weeks.

## Recommendation
- **Keep the current valuation (POLICY simulations).** Nothing passes the pre-registered rule:
  - P8f's pooled rest-of-season gain is +1.4 ± 4.7, so the CI includes 0.
  - P8f also costs 476 s per cold refresh on one thread. It would fit the 2-minute budget only with a new
    variant-parallel implementation (61 s on 12 workers).
  - The ROS term and the naive baseline are no better.
- **No config option was added.** The task asks for one only if a method wins. The default and the live app are
  untouched, and no lib/ code changed.
- For the user, no code change:
  - In our league, a "+3 pts" waiver reminder is worth about 0 on average. Treat it as a hint, not a sure gain.
    Moves for injured or fringe players' sit-outs that the page can't see are where it goes wrong.
  - The live default N = 2000 performs like N = 300 in this backtest (+0.8 ± 2.0), at 44 s vs 7 s of compute per
    cold refresh. Lowering it is a free speed-up if wanted. Not changed here.
- Next step worth testing with live data: free-agent availability (injury tags, recent minutes and DNPs) in the
  page's play probabilities. The collector logs injury reports. The backtest can't test this properly: it has no
  injury history, and its availability proxy didn't replicate.

## Results
Metrics (per team-week decision, edited minus unedited roster, real games):
- **H2**: the 2 weeks the methods target.
- **ROS**: weeks w..23, while the real roster still has the dropped player and lacks the added one.
- **ROSp**: ROS with weeks 18+ ×2.

They are computed under three evaluators:
- **P8** (pre-registered).
- **hindsight** (perfect-hindsight lineup ceiling; low noise).
- **POLICY** (the rule the page simulates with).

95% CIs are the wider of the week-clustered and team-clustered CIs. Pooled = inverse-variance mean of the two
seasons. P8f on 2024-25 = league A, odd weeks (110 decisions; compared with the current method on the same 110).

**2025-26 (our league): each method's pick minus no move**

| method | decisions | acts | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |
|---|---|---|---|---|---|---|---|---|---|
| policy (current) | 220 | 86% | −1.58 ± 3.64 | −0.90 ± 13.79 | −2.42 ± 20.83 | +1.01 ± 1.81 | +2.80 ± 3.84 | +3.45 ± 2.64 | +6.38 ± 5.14 |
| p8f | 220 | 93% | −0.19 ± 3.20 | +0.27 ± 17.39 | +0.77 ± 26.83 | +1.40 ± 2.19 | +3.49 ± 5.33 | +2.33 ± 2.54 | +2.12 ± 6.29 |
| ros | 220 | 97% | +0.72 ± 4.48 | +2.11 ± 17.00 | +1.31 ± 23.54 | +2.22 ± 3.21 | +3.72 ± 6.22 | +2.81 ± 3.37 | +2.43 ± 7.55 |
| naive | 220 | 100% | −0.83 ± 3.67 | +3.46 ± 14.24 | +5.59 ± 18.74 | +1.21 ± 2.58 | +2.80 ± 4.12 | +1.53 ± 3.08 | +0.56 ± 5.76 |
| policy2000 (live N) | 220 | 87% | −0.74 ± 3.09 | +2.78 ± 13.89 | +4.52 ± 20.73 | +1.45 ± 1.75 | +4.54 ± 6.63 | +3.12 ± 2.53 | +3.80 ± 6.65 |
| policyA (exploratory) | 220 | 95% | +1.76 ± 3.62 | +7.07 ± 14.44 | +10.96 ± 21.72 | +2.85 ± 2.21 | +8.93 ± 6.69 | +3.62 ± 2.32 | +8.57 ± 6.42 |

**2024-25 (synthetic leagues): each method's pick minus no move**

| method | decisions | acts | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |
|---|---|---|---|---|---|---|---|---|---|
| policy (current) | 660 | 100% | +8.83 ± 3.65 | +32.32 ± 13.01 | +54.58 ± 20.43 | +9.63 ± 2.97 | +29.90 ± 10.47 | +10.18 ± 2.94 | +27.01 ± 10.12 |
| p8f | 110 | 100% | +4.40 ± 5.12 | +12.38 ± 17.75 | +19.62 ± 29.99 | +8.30 ± 2.97 | +27.55 ± 11.48 | +8.20 ± 4.27 | +27.60 ± 12.99 |
| ros | 660 | 100% | +8.25 ± 3.86 | +23.94 ± 12.33 | +41.39 ± 20.37 | +8.89 ± 3.15 | +23.98 ± 7.74 | +8.71 ± 3.22 | +19.71 ± 7.02 |
| naive | 660 | 100% | +3.03 ± 3.31 | +12.24 ± 14.73 | +18.77 ± 21.03 | +4.61 ± 2.85 | +15.00 ± 13.93 | +3.43 ± 3.40 | +15.22 ± 14.44 |
| policyA (exploratory) | 660 | 100% | +8.66 ± 3.04 | +29.71 ± 12.94 | +50.82 ± 20.43 | +9.16 ± 2.75 | +27.70 ± 10.02 | +9.62 ± 3.20 | +26.10 ± 9.63 |

**Method minus current (paired, same decisions)**

| method | season | decisions | same pick | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |
|---|---|---|---|---|---|---|---|---|---|---|
| p8f | 2025-26 | 220 | 41% | +1.39 ± 2.51 | +1.16 ± 5.45 | +3.20 ± 8.48 | +0.39 ± 0.89 | +0.69 ± 2.75 | −1.12 ± 2.09 | −4.26 ± 4.70 |
| p8f | 2024-25 | 110 | 27% | −0.68 ± 4.65 | +2.07 ± 9.12 | +2.08 ± 16.84 | +0.06 ± 1.77 | +3.56 ± 7.19 | −2.67 ± 4.16 | +0.76 ± 10.79 |
| **p8f** | **pooled** | | | **+0.92 ± 2.21** | **+1.40 ± 4.68** | +2.97 ± 7.57 | +0.32 ± 0.80 | +1.05 ± 2.57 | −1.43 ± 1.87 | −3.46 ± 4.31 |
| ros | 2025-26 | 220 | 27% | +2.30 ± 3.52 | +3.01 ± 7.21 | +3.74 ± 11.47 | +1.21 ± 2.14 | +0.92 ± 4.33 | −0.63 ± 2.54 | −3.95 ± 6.33 |
| ros | 2024-25 | 660 | 28% | −0.58 ± 1.55 | −8.38 ± 10.24 | −13.19 ± 15.40 | −0.74 ± 1.15 | −5.93 ± 8.50 | −1.47 ± 1.50 | −7.29 ± 8.75 |
| **ros** | **pooled** | | | **−0.11 ± 1.42** | **−0.76 ± 5.89** | −2.30 ± 9.20 | −0.31 ± 1.01 | −0.50 ± 3.86 | −1.26 ± 1.29 | −5.10 ± 5.13 |
| naive | 2025-26 | 220 | 31% | +0.75 ± 2.41 | +4.36 ± 6.78 | +8.01 ± 8.54 | +0.19 ± 1.43 | −0.00 ± 3.07 | −1.92 ± 2.13 | −5.83 ± 4.21 |
| naive | 2024-25 | 660 | 17% | −5.80 ± 3.93 | −20.08 ± 12.43 | −35.81 ± 19.96 | −5.03 ± 3.72 | −14.90 ± 11.05 | −6.76 ± 3.46 | −11.79 ± 12.48 |
| **naive** | **pooled** | | | **−1.04 ± 2.06** | **−1.25 ± 5.95** | +1.22 ± 7.85 | −0.48 ± 1.33 | −1.07 ± 2.95 | −3.24 ± 1.81 | −6.43 ± 3.99 |
| policy2000 | 2025-26 only | 220 | 63% | +0.84 ± 2.04 | +3.67 ± 6.67 | +6.95 ± 10.24 | +0.44 ± 0.65 | +1.74 ± 3.76 | −0.32 ± 1.65 | −2.59 ± 4.09 |
| policyA (exploratory) | 2025-26 | 220 | 47% | +3.34 ± 3.32 | +7.97 ± 5.47 | +13.39 ± 9.46 | +1.83 ± 1.27 | +6.13 ± 4.21 | +0.17 ± 1.54 | +2.19 ± 3.83 |
| policyA (exploratory) | 2024-25 | 660 | 57% | −0.17 ± 1.30 | −2.61 ± 3.76 | −3.76 ± 6.37 | −0.47 ± 0.55 | −2.20 ± 3.06 | −0.57 ± 1.11 | −0.91 ± 3.66 |
| policyA (exploratory) | pooled | | | +0.29 ± 1.21 | +0.79 ± 3.10 | +1.58 ± 5.28 | −0.11 ± 0.50 | +0.67 ± 2.47 | −0.31 ± 0.90 | +0.57 ± 2.65 |

**Selection rule check:**
- P8f: pooled ROS +1.40 ± 4.68, CI includes 0. Fails. It also fails the cost limit without a new implementation.
- ros: −0.76 ± 5.89. Fails.
- naive: −1.25 ± 5.95. Fails.
- **The current method stays.**

The POLICY evaluator favours the current method (e.g. P8f − current −1.4 ± 1.9 over 2 weeks). That is expected: the
page simulates with POLICY, so its picks fit POLICY's own quirks. It is also why the P8 metric, played the way the
live engine plays, was pre-registered as the judge.

### Does the page's own valuation make sense? ("drop X gains points")
For each method's acted picks, from its own simulations:
- **drop-alone gain**: removing the dropped player by itself raises the simulated total. A sound policy can't lose
  points from an extra player.
- **drop adds value**: the move (add X, drop Y) is valued above adding X alone.
- **significant drop gains**: share of all drop evaluations whose gain is > 2 se and > 0.5 pts.

| season | method | picks | drop-alone gain (> 0 / > 2 se) | drop adds value | significant drop gains, all evaluations | compute / team-week (1 core, 12 jobs running) |
|---|---|---|---|---|---|---|
| 2025-26 | policy (N = 300) | 190 | 58% / 4.7% | 72% | 72 / 4,180 (1.7%) | 8 s |
| 2025-26 | policy2000 | 191 | 63% / 26% | 75% | 181 / 4,180 (4.3%) | 52 s |
| 2025-26 | p8f (N = 400) | 204 | 23% / 2.0% | 41% | 37 / 4,180 (0.9%) | 621 s |
| 2025-26 | ros | 213 | 40% / 0.9% | 41% | (= policy's sims) | +1 s |
| 2024-25 | policy | 657 | 71% / 7.3% | 88% | 251 / 12,540 (2.0%) | 7 s |
| 2024-25 | p8f | 110 | 45% / 3.6% | 63% | 26 / 2,090 (1.2%) | 547 s |
| 2024-25 | ros | 660 | 56% / 2.7% | 59% | (= policy's sims) | +1 s |

- Drop-alone gains are rare overall (1–2% significant) but concentrated in the picks. The search ranks drops by
  their (noisy, sometimes biased) value and takes the cheapest, then takes the best of 18 noisy moves.
- With 2,000 scenarios the bias becomes significant: dropping a player really does raise POLICY's expected total in
  ~4% of cases. This is the known POLICY non-monotonicity (REPORT "Held scores yield"; holdYield reduced it but did
  not remove it).
- P8f's index policy is closer to monotone, but its picks don't do better on real games.

### Predicted vs realized gain (why the real league gains nothing)
Acted picks by predicted 2-week gain, from the method's own simulation; realized H2 under each evaluator:

| season | method | predicted bin | n | predicted | real P8 | hindsight | POLICY |
|---|---|---|---|---|---|---|---|
| 2025-26 | policy | 3–5 | 51 | 4.2 | −6.4 ± 5.6 | +1.1 ± 2.6 | +1.3 ± 3.9 |
| 2025-26 | policy | 5–8 | 57 | 6.3 | −0.4 ± 5.4 | +1.4 ± 1.9 | +6.8 ± 4.3 |
| 2025-26 | policy | 8–15 | 59 | 10.8 | +1.6 ± 5.3 | +1.9 ± 2.3 | +4.3 ± 4.9 |
| 2025-26 | policy | 15+ | 23 | 17.0 | −4.1 ± 6.0 | −1.1 ± 1.0 | +2.3 ± 6.0 |
| 2025-26 | policy | all | 190 | 8.4 | −1.8 ± 2.9 | +1.2 ± 1.2 | +4.0 ± 2.4 |
| 2025-26 | p8f | all | 204 | 8.6 | −0.2 ± 2.8 | +1.5 ± 1.2 | +2.5 ± 2.2 |
| 2024-25 | policy | 5–8 | 99 | 6.7 | +5.3 ± 4.9 | +6.8 ± 1.3 | +6.7 ± 3.6 |
| 2024-25 | policy | 8–15 | 402 | 11.3 | +8.7 ± 2.3 | +9.3 ± 1.0 | +10.9 ± 1.9 |
| 2024-25 | policy | 15+ | 138 | 17.8 | +12.4 ± 3.9 | +13.4 ± 1.6 | +10.9 ± 3.8 |
| 2024-25 | policy | all | 657 | 11.8 | +8.9 ± 1.8 | +9.7 ± 0.7 | +10.2 ± 1.6 |
| 2024-25 | p8f | all | 110 | 12.0 | +4.4 ± 4.3 | +8.3 ± 1.6 | +8.2 ± 3.9 |

- In 2024-25, 75–80% of the predicted gain is realized, and the realized gain rises with the predicted gain.
- In 2025-26 nothing is realized at any predicted size, so a higher reminder threshold would not help.

The added and dropped players' games in the 2 target weeks (`research/w_diag.py`; projection = the pre-game
projection the model uses):

| season | method | role | games | projection / game | actual / game | played | actual when played |
|---|---|---|---|---|---|---|---|
| 2025-26 | policy | add | 1,243 | 23.9 | 9.0 | 59% | 15.3 |
| 2025-26 | policy | drop | 1,211 | 16.0 | 10.7 | 76% | 14.0 |
| 2025-26 | p8f | add | 1,352 | 23.5 | 9.5 | 60% | 15.7 |
| 2025-26 | policyA | add | 1,391 | 22.7 | 10.9 | 66% | 16.5 |
| 2025-26 | naive | add | 1,453 | 24.9 | 6.6 | 43% | 15.3 |
| 2024-25 | policy | add | 4,343 | 25.4 | 18.1 | 88% | 20.7 |
| 2024-25 | policy | drop | 4,195 | 12.5 | 7.0 | 64% | 11.0 |
| 2024-25 | naive | add | 4,290 | 29.4 | 10.0 | 45% | 22.2 |

- In 2025-26, 514 of the policy adds' 1,243 games were DNPs **without** a Sleeper projection row. In the backtest
  they are valued at the player's last projection. Only 1 DNP had a projection.
- The most-picked adds were rotation players: Paul Reed 43× (a projection row in 39 of his team's 74 games),
  Luke Kornet 20×, Dominick Barlow 11×, Alondes Williams 10× (4 games played all season).
- Live, projection presence and injury tags give the page part of this information. The backtest can't use
  presence: in the stored data it leaks sit-outs (REPORT, data section).

### Live cost (cold Waivers refresh on this Mac)
Measured with `research/w_latency.ts` on 2025-26 week 10, team 1, at week start (both weeks fully ahead = the most
work), idle machine. The page's search covers 52 roster variants × 2 weeks; data fetching is not included.

| valuation | how it runs | compute |
|---|---|---|
| POLICY, N = 300 (task's "current") | one thread | **6.7 s** |
| POLICY, N = 2000 (live code default; workers only split scenarios when N >= 4000) | one thread | **43.6 s** |
| P8f, N = 400, as the live code would run it (each variant's week-start price solve, ~3 s, on one thread) | one thread | **476 s** |
| P8f, N = 400, roster variants spread over 12 worker threads (new code needed) | 12 workers | **61 s** |

## Changes after the pre-registration
- **lambda** (ROS weight) 0.25 → 0.08 before any real outcome was computed, calibrated on model simulations only
  (see the ROS method below; commit d5b9b38 already has 0.08).
- **P8f sample on 2024-25**: P8f valuation costs ~600 s per team-week with 12 processes running (the week-start price
  solve per roster variant dominates), so 2024-25 league A was cut from all 22 weeks to the 11 odd weeks (110 decisions;
  2025-26: all 220). The pooled P8f comparison uses those 110.
- **Secondary evaluators (added after seeing the P8 metric's noise)**: every scored roster-week is also valued by
  (a) the perfect-hindsight lineup ceiling of the real games (`E.hindsight`: each player's best game, max-weight slot
  assignment; no decision path, so a roster change moves it only through the players involved) and (b) POLICY played on
  the real games (the rule the page simulates with). They are reported next to the pre-registered P8 metric; the
  selection rule uses P8 only.
- **Exploratory method policyA (added after the results, not eligible under the selection rule)**: the page's search
  with each player's P(play | played last) capped by his recent played share (`availability` below: share of his last
  <= 10 team games played, shrunk toward 0.9 with 3 pseudo-games) in the simulations and in the free-agent ranking.
  It tests the diagnosis in "Predicted vs realized gain".

## Pre-registered design

### Question
The Waivers page (`lib/live/waivers.ts`) values each "add free agent X, drop Y" by simulating the rest of this week and
all of next week with the fast rule (POLICY), paired draws per player, and the notifier reminds when the best
confident move is worth >= +3 pts. Does that valuation pick better pickups over a season than the alternatives?

### Data (`research/w_build.py` -> `research/data/w/all2025.json`, `all2024.json`, not committed)
- Every NBA player's games in weeks 1-23 (rostered and free agents), one game per scheduled game of his team (team per
  date: his own Sleeper row that day, else his nearest earlier row), DNP = no row or gp = 0. `season_all.json` alone is
  not usable: it lists only games with a Sleeper row, so a free agent's DNPs would be missing (a look-ahead leak).
  - 2025-26: 596 players, 44,599 games; team schedules / tip-offs from the union of all rows; rostered players' games
    are season.json's unchanged (the reconstruction differs from them on 41 of 15,444 games).
  - 2024-25: 590 players, 44,229 games from `research/data/raw2024` (identical to season2024.json on all 16,866 shared games).
- Rosters: 2025-26 = our real league's weekly rosters (season.json); 2024-25 = the three synthetic 10-team leagues of
  season2024.json (drafted rosters, lost-for-season replacements only). Free-agent pool of a team in week w = every
  player with a game in weeks w..w+1 who is on no roster of THAT league in week w.
- Ages: Sleeper birth dates (exact age on the week's first day). Dynasty ADP: Sleeper's season projections
  (`adp_dynasty`) for that season **as fetched now** (no history exists; current values, as the task allows).
- League settings (fetched): 9 starters + 10 bench = 19 active spots, 2 IR spots, playoffs from week 18.

### Simplifications (the same for every method)
- **One decision per team-week, before the week starts** (decision time = 1 h before the week's first tip-off),
  on the team's real roster of week w. Each team-week is an independent what-if (no accumulation of edits).
- **No waiver contention**: every team may claim any free agent (no priority, no 2-day waiver clock).
- **IR**: a roster with n > 19 players has n - 19 on IR = the players with the longest current sit-out streak; they
  can't be dropped for an active spot. All rosters have >= 19, so every add needs a drop (open spots: none).
- **Information at decision time**: walk-forward model (fitted on earlier weeks only, `btcommon.fitModel`), Sleeper
  per-game projections for weeks w and w+1 (the page uses next week's projections too; they may contain a few days
  of later news), the played-last-game sit-out chain. No injury tags (the data has none).
- **Dynasty protection** as on the page: never drop age <= 23 or dynasty ADP <= 120.

### Methods (all share the page's search unless stated: top 12 free agents by expected points of their games in
weeks w..w+1, every non-IR player's drop value, top 6 adds x 3 cheapest unprotected drops; pick = best move with
total > max(1, 2 se) and total >= 3, else no move - the notifier's reminder rule)
1. **policy**: POLICY simulations, weeks w and w+1, N = 300 paired scenarios (the task's "current"; NB the live code
   default is N = 2000, run as **policy2000** on 2025-26 for information).
2. **p8f**: the same search valued with P8f simulations (`simPolicy('p8')`: P8f, prices re-solved after new results,
   fresh price slot per run; week-start prices solved once per roster variant), N = 400.
3. **ros**: the page's 2-week POLICY value (the same simulations as method 1) **plus a rest-of-season term**
   `ROS(X, Y) = 0.08 * (R_X - R_Y)`, with
   `R_p = sum over weeks w' = w+2..23 of c(w') * games(team_p, w') * max(0, a + b * ppg_p) * avail_p`,
   c = 1 for weeks <= 17 and **2 for playoff weeks 18+**; team_p = his team at decision time, games = his team's
   scheduled games that week; ppg_p = mean pre-game projection of his games in weeks w..w+1 (else his latest
   projection); a, b = the walk-forward model's projection correction; avail_p = share of his last <= 10 team games
   he played, shrunk toward 0.9 with 3 pseudo-games. lambda = the share of the raw projected-points difference that
   becomes lineup points. First set to 0.25 by judgement; before any real outcome was computed it was calibrated on
   the method's own **model simulations** (weeks 3-4 of both seasons, 720 candidate moves: 2-week sim gain vs the raw
   2-week projected-points difference of the pair: slope 0.062 through 0, 0.14 / 0.10 / 0.085 / 0.058 for raw
   differences of 0-20 / 20-40 / 40-80 / 80+ pts) and fixed at **lambda = 0.08**: a future week is valued like the
   2 simulated ones. The ROS term enters the
   ranking of adds (top 6) and drops (3 cheapest) too; the free-agent pool adds the top 6 by 2-week value +
   ROS term to the page's 12.
4. **naive**: the free agent with the highest projected points per game (ppg as above, at least one game in week w)
   replaces the lowest-ppg unprotected non-IR roster player, position-agnostic, whenever the difference is > 0.

### Scoring (real outcomes)
- The edited roster and the unedited roster are each played by **P8** (the live P10b engine's base policy; P10b
  itself costs minutes per team-week and the evaluation needs ~10^4 roster-weeks) on the **real** games, with the
  walk-forward model of each week. Deterministic: no seeds.
- **H2** = sum over weeks w, w+1 of (edited - unedited) real points.
- **ROS** = the same over weeks w..23 while the pickup is "kept": week w' counts only while the real roster of w'
  still has Y and still lacks X (once the real manager drops Y or adds X himself, the what-if ends: diff 0 after).
  Edited roster of week w' = real roster of w' + X - Y. No move = 0.
- ROSp (secondary): ROS with playoff weeks 18+ weighted 2.
- "Nonsense" (method's own valuation): share of picks whose drop alone is valued as a gain (dropOnly > 0, and
  > 2 se), share of all drop evaluations with a significant gain (> 2 se and > 0.5 pts), and the share of picks whose
  add+drop is worth more than the add alone (pair excess > 0) - an extra player can't lower a sound policy's value.

### Selection rule (fixed now)
A method replaces (1) only if, **pooled over both seasons** (inverse-variance mean of the two seasons' estimates),
its **ROS** gain over (1) per team-week decision has a 95% CI excluding 0 (CI = the wider of week-clustered and
team-clustered), its H2 gain is not significantly negative, and a cold Waivers refresh with it fits in ~2 min on
this Mac with workers (measured). P8f costs ~2.9 s per week-start price solve x ~100 roster variants per
team-week (~400 s per team-week on one core): it is run on all of 2025-26 and on 2024-25 league A (220 + 220
team-week decisions); the other methods on all 220 + 660.

## Files and reproduce
- `research/w_build.py`: datasets (every player's games, rosters per league, ages, dynasty ADP), from
  `research/data/season*.json`, `season_all.json`, `raw2024/` and `research/data/w/{players_nba,league,sproj_2024,sproj_2025}.json`
  (Sleeper public API, fetched 2026-10-16).
- `research/wcommon.ts`: walk-forward projections, team-weeks for any roster, paired per-player scenarios, protection.
- `research/waivers_bt.ts`: `decide` (every method's pick for a week) and `score` (real-outcome totals; EVAL=hp:
  hindsight + POLICY).
- `research/w_run.mjs`: parallel runner. `research/w_pipeline*.mjs`: the runs as executed.
- `research/w_summ.py`: tables (also `research/out/w/w_tables.md`, `w_summary.json`). `research/w_diag.py`: the
  players' projection vs actual. `research/w_latency.ts`: live cost.
```
python3 -I research/w_build.py
npx esbuild research/waivers_bt.ts --bundle --platform=node --format=cjs --outfile=research/dist/waivers_bt.cjs --log-level=error
node research/w_run.mjs decide w25 2025 METHODS=policy,ros,naive,policy2000      # 21 min (12 processes)
node research/w_run.mjs decide w24 2024 METHODS=policy,ros,naive                 #  9 min
node research/w_run.mjs decide w25p8f 2025 METHODS=p8f SPLIT=team                # 3.3 h
node research/w_run.mjs decide w24p8f 2024 METHODS=p8f SPLIT=team LEAGUES=0 WEEKLIST=1,3,5,7,9,11,13,15,17,19,21   # 1.5 h
node research/w_run.mjs decide w25a 2025 METHODS=policyA; node research/w_run.mjs decide w24a 2024 METHODS=policyA
node research/w_run.mjs score w25 2025 DEC=w25,w25p8f,w25a; node research/w_run.mjs score w24 2024 DEC=w24,w24p8f,w24a   # 25 + 70 min
node research/w_run.mjs score2 w25 2025; node research/w_run.mjs score2 w24 2024
python3 -I research/w_summ.py && python3 -I research/w_diag.py
npx esbuild research/w_latency.ts --bundle --platform=node --format=cjs --outfile=research/dist/w_latency.cjs --log-level=error
node research/dist/w_latency.cjs 10 1 12; node research/dist/w_latency.cjs 10 1 1
```
