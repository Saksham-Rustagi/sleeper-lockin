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

## In-week free-agent streaming (tested, not adopted)
- Test: each game day, swap "dead" roster spots for the best free agent with games left.
  - Dead spot = a churnable player who is finished for the week, or (variant B) already locked.
  - Real FA pool and box scores, walk-forward, 230 team-weeks.
- Result: +0.29 ± 0.61 (A) and +0.25 ± 0.65 (B) pts/week.
- Even churning 10 roster players against a 60-FA pool: +0.44 ± 0.80 / +0.72 ± 1.09.
- Why: when a dead spot appears, the median team still has 14 usable players for 3 open slots. Rosters were thin (10 or fewer live players mid-week) in 1 of 230 team-weeks.
- Verdict: not worth roster churn. Manual tactic only after injury pile-ups.

## Learned lock rule: approximate policy iteration (tested, not adopted)
- Question: rollouts and cut-off sims play the rest of the week with the quick rule of thumb (which locks too early). Does that bias the answers?
- Method:
  - At all 7,535 lock decisions in the 2025-26 replay, measured the true cut-off by paired simulation (E[let go] − E[lock at 0], 400 scenarios each).
  - Fit cut-off = linear model of the rule-of-thumb value, own future value, open slots, eligible games per open slot, week left, own games left, and time interactions.
  - Cross-fitted: odd weeks → even weeks and vice versa. (`research/lockdata.ts`, `fitcut.py`, `cut/v1_*.json`)
- Decision level (held-out):
  - Cut-off error 3.5 → 2.4 pts.
  - Points lost to wrong-side decisions 3.8 → 1.0 per team-week.
- Real-season backtest (230 team-weeks, cross-fitted):

  | Policy | Pts/week | vs current |
  |---|---|---|
  | P2LA (current rule) | 270.8 | — |
  | P5 (learned rule) | 272.2 | +1.5 ± 1.8 |
  | P3LA (rollouts on the current rule; live app) | 274.2 | — |
  | P6 (rollouts on the learned rule) | 273.5 | −0.6 ± 0.9 vs P3LA |

- Tuesday Week 1 cut-offs with the rest-of-week rule swapped:

  | Player | Current rule | Learned rule |
  |---|---|---|
  | Hartenstein | 26.4 | 26.4 |
  | Wallace | 25.2 | 24.9 |
  | Castle | 27.8 | 28.0 |

- Why it doesn't matter:
  - Lock and wait are compared on the same scenarios with the same future play, so errors in imagined future decisions mostly cancel.
  - Each later decision gets its own full simulation when it actually comes up.
- Verdict: keep P3LA. Engine supports `Policy.cutoff`, off by default.

## Model & search variants (tested, none adopted)
Whole 2025-26 season, 230 team-weeks, paired against the same baseline.

**Per-game score model** (walk-forward, held-out prediction on 10,437 played games, weeks 3–23):

| Variant | Per-game error (RMSE) | Log-likelihood |
|---|---|---|
| Baseline | 10.214 | −2.8132 |
| Recent form (last 10 games, weight 0.16) | 10.176 | −2.8085 (better) |
| Per-player volatility (shrunk) | 10.214 | −2.8179 (worse) |

**Base strategy P2LA, points per week vs baseline:**
- Recent form: −2.26 ± 1.60. Better prediction, worse decisions.
- Per-player volatility: +0.46 ± 1.49.
- Skewed (empirical) residuals: −0.06 ± 0.36.
- Form + skew: −1.88 ± 1.61.

**Full simulation P3LA (baseline 274.2):**
- Wider simulation net (25-pt margin): −0.52 ± 1.14, at 4.4× the compute.
- 500 instead of 200 sims per decision: −0.03 ± 1.26, at 4.7× the compute.

**Verdict:** the current strategy is at a plateau for what the data can show. Remaining ideas not yet testable:
- simulation-based start/sit at crowded tip-offs
- injury-report inputs, once the live logger has a season of data

## Start/sit by simulation (ADOPTED)
- At each tip-off, the rule's lineup is compared with small changes:
  - sit one of the two weakest starters
  - start one of the two best benched players, in a free slot or in place of the weakest starter he can replace
- Each option gets 200 simulated rests-of-week (common random numbers). A change needs a >0.5 pt gain.
- Found because dropping Santi Aldama "gained" points: an early-week start by the rule rippled into worse later decisions.

| Policy | Pts/week | vs P2LA | Win% vs real opponent |
|---|---|---|---|
| P2LA (rule only) | 270.8 | — | 60.0% |
| P3LA (lock sims; previous app) | 274.2 | +3.4 | 59.3% |
| P2S (start sims only) | 276.9 | +6.1 ± 2.3 | 63.1% |
| **P7 (start + lock sims; live app)** | **278.5** | +7.7 ± 2.5 | 62.6% |

- P7 vs P3LA: +4.34 ± 1.97. Better in 112 team-weeks, worse in 62. Weeks 1–11 +3.5, weeks 12–23 +5.1.

### Start/sit refinement: never sit into an idle slot
Of 840 lineup overrides across 5,742 tip-offs:

| Override | Count |
|---|---|
| Swaps | 283 |
| Sits that freed a slot for a later tip-off that night | 456 |
| Sits where the slot then stayed empty for the whole game | 101 |

- The 101 empty-slot sits can't be right under good play: a started player's score is a free option you can let go.
- They came from the simulation dodging later mistakes by the rule of thumb that plays out the rest of the week.
- Banned them: P7 278.5 → 278.1 (−0.4 ± 1.5, noise), win% 62.6 → 63.1, still +3.9 ± 2.0 over P3LA. Shipped.

## Held scores yield to players tipping off (ADOPTED)
**Symptom:** the Waivers page said dropping Santi Aldama gained +1.6 (Wallace +0.9). A sound rule can't lose points from an extra player.

**Diagnosis (`research/monotone.ts`):** tested which rule change makes that effect vanish.
- **Cause:** at a tip-off, a held score (e.g. Monday's 25) competed for the slot with tonight's player. It could win and bench him without ever being compared with "lock the 25 and start him too".
- **Fix (`holdYield`):** a held score never keeps a slot that a tipping (or reserved) player wants. It must be locked or let go at that moment.

| Variant | Team total (weeks 1+2) | Drop Aldama | Drop Wallace |
|---|---|---|---|
| Before | 558.2 | +1.02 ± 0.66 | +0.65 ± 0.54 |
| holdYield | 560.6 | +0.17 ± 0.67 | +0.22 ± 0.45 |

**Season backtest (230 team-weeks):**

| | Before | holdYield | Change |
|---|---|---|---|
| Rule alone | 270.8 | 272.0 | +1.25 ± 1.92 |
| Live P7 | 278.1 | **280.3** | +2.23 ± 2.30 |
| Live win% | 63.1% | 64.0% | |

Positive in both halves of the season. Shipped as the default rule, which also drives projections, waivers and cut-offs.

**Note:** an earlier attempt clamped negative drop values to 0 on the Waivers page. That hid the symptom and was reverted.
