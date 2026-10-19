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

## Engine v2 — Phase 1: invariants and optimality gap
Phase 1 of `ENGINE_V2.md` measures two things before any engine changes:
- Does the engine obey the Sleeper rules?
- How far are P2LAH (rule only) and P7H (live) from the best possible play under the score model?

Engine behaviour was **not** changed. All bugs below are reported, not fixed.

### 1. Rule / legality / sanity checker (`research/invariants.ts`, `tests/invariants.test.ts`)
**How it works**
- **Stepping:** the engine is run one event at a time through its own `simulate()`.
- **Observe-only hooks:** they wrap the policy's own hooks and return exactly what those hooks return.
- **State diffs:** each event's state change is checked against the rules.
- **Physical lineup:** a separate model records where every in-game, held and locked player actually sits. The engine itself only tracks pinned and locked slots.
- **Moments:** decisions taken at the same instant (deadline locks/releases of players tipping at t, plus the tip-off at t) form one "moment". Let-go players are benched first; then a BFS over legal Sleeper moves (move into an empty eligible slot, or swap two movable starters each eligible for the other's slot) must reach the engine's lineup with every kept held score still in a starting slot and every lock in place.
- **Recount:** the week total is recomputed independently (locked scores + held final games) and compared with the engine total.

**Non-interference check:** the instrumented runs reproduce the season backtest exactly. 230 team-weeks × {P2LAH, P7H}: 0 totals differ from `research/out/base_hy_*`.

**Unit tests** (`tests/invariants.test.ts`, deterministic) cover:
- BFS reachability: a 3-cycle with no spare slot is unreachable; with a spare slot it takes 4 moves;
- clean engine weeks pass every check, and the recount equals the engine total;
- illegal hook decisions are caught: ineligible lock, start into an occupied slot, ex-ante idle benching;
- the hidden-forfeit lock (bug B1 below) is detected;
- the negative week-end count (B2) is documented.

**Data checked:**
- **Real outcomes:** all 230 team-weeks, for both P2LAH and P7H.
- **Model scenarios:** 200 per team-week for P2LAH (46,000 weeks).
- **P7H on model scenarios:** 20 per team-week, run through the checker inside the gap study (results are added to the table when that study finishes).

Key prefixes:
- `L_` = rule violation;
- `F_` = a held score given up, by reason (all explicit engine choices);
- `S_` = dominated or doubtful action;
- `I_` = information only.

Cells show count (count per week; points of held score involved per week). Keys that never fired on any data set
are omitted: unreachable lineup or lock, ineligible / occupied / duplicate start, lock of an unstarted or stale score,
locked or pinned player moved, locked player started, held score vanishing without a decision, non-final game counted
at week end, ex-ante idle-slot benching.

| check | P2LAH real (230 wk) | P7H real (230 wk) | P2LAH sim (46,000 wk) |
|---|---|---|---|
| L_held_stranded (hidden forfeit, bug B1) | 1 | 1 | 121 (0.26% of weeks) |
| L_count_forfeited (engine counts a forfeited score) | 0 | 0 | 1 |
| L_total_mismatch (engine total ≠ legal recount) | 0 | 0 | 1 |
| S_forfeit_unforced (held score > 0 let go while it could stay, bug B3) | 0 | 180 (0.78/wk; 16.5 pts/wk) | 3 |
| S_weekend_negative (negative held score counted, bug B2) | 7 (0.10 pts/wk) | 6 (0.07 pts/wk) | 639 (0.04 pts/wk) |
| S_lock_wider (lock into a wider slot while a narrower eligible one was open) | 131 (0.57/wk) | 105 (0.46/wk) | 24,918 (0.54/wk) |
| S_lock_zero (lock of a 0, e.g. a DNP) | 0 | 1 | 99 |
| F_yield_idle (let go although he could stay without displacing anyone) | 0 | 201 (0.87/wk) | 4 |
| F_yield_reserved (let go for a later-tonight player's reserved slot) | 2,904 (12.6/wk; 137.6 pts/wk) | 3,021 (13.1/wk; 153.4 pts/wk) | 533,274 (11.6/wk; 126.7 pts/wk) |
| F_yield_tipping (let go to seat tonight's starters or locks) | 2,697 (11.7/wk; 69.1 pts/wk) | 2,778 (12.1/wk; 85.2 pts/wk) | 516,603 (11.2/wk; 67.3 pts/wk) |
| F_deadline_benched (let go at his own tip-off, then sat) | 77 (0.33/wk; 3.0 pts/wk) | 91 (0.40/wk; 3.5 pts/wk) | 12,865 (0.28/wk; 2.7 pts/wk) |
| F_deadline_replaced (let go at his own tip-off, new game started) | 292 (1.27/wk) | 309 (1.34/wk) | 53,035 (1.15/wk) |
| I_idle_bench_expost (sat; an eligible slot then went unused for his whole game, but someone could have used it) | 217 (0.94/wk) | 310 (1.35/wk) | 38,079 (0.83/wk) |
| I_lock_moved (lock needed a move first) | 433 (1.9/wk) | 550 (2.4/wk) | 84,246 (1.8/wk) |
| I_lock_final_game (lock of a final-game score; equal in value to holding it) | 457 (2.0/wk) | 510 (2.2/wk) | 82,575 (1.8/wk) |
| I_start_override (P7H simulations changed the rule's lineup) | — | 656 of 5,786 tip-offs | — |

#### Engine rule bugs found (not fixed)
**B1. A lock can strand a held teammate: hidden forfeit, sometimes counted anyway.**
- **Cause:** `evalLock` offers every unpinned open slot (`unpinnedOpen`). Its valuation assigns all players' *future* values and ignores that each held teammate must occupy a starting slot *right now*.
- **Effect:** locking into the "wrong" slot can leave a held player with nowhere to sit. Sleeper would bench him, forfeiting his score, but the engine keeps him as held. Usually he is let go later anyway.
- **Real example** (w4 r10, Thu 19:00 ET):
  - 6 open slots (PG, SG, PF, F, C, UTIL) and 6 held players: Adams C, Porziņģis C, Ball PG/SG/SF, Collins PF/C, Williamson SF/PF, Johnson SG/SF/PF.
  - Ball is the only one who can play PG.
  - `evalLock` locks Ball into **F**: lockBest 154.6 vs continue 150.4, because the PG slot is "worth" more kept open for a bench guard's later games.
  - The 5 remaining held players cannot fit into PG, SG, PF, C, UTIL: one of them (score 0–2) is physically benched.
- **Sim example where the engine counts the forfeited score** (w4 r4, scenario 30): Kevin Durant's 26.6 is locked after an earlier lock left him without a slot. Engine total 277.0, legal total 250.4.
- **Frequency:** 0.26% of simulated weeks, about 0.01 pts/wk on average. Rare and cheap, but it breaks rule 4. The fix belongs in `evalLock`: only allow lock slots that leave the held + in-game players placeable.

**B2. Negative held final-game scores are counted at week end.**
- Rule 4 lets the user bench a held player, giving 0. The engine's week-end auto-count (`simulate`, the `assignExact` over pending players) counts e.g. −6 or −7.
- Cost: 0.04–0.10 pts/wk.

**B3. P7H's start/sit simulations don't re-seat held scores that the rule let go.**
- `startRolloutHooks` builds alternatives from the rule's map. If an alternative sits one of the rule's starters, the slot he would have used stays free. Any held score that lost that slot is still forfeited by `applyStarts`.
- **Example** (w1 r5, Fri 17:30 ET, real outcomes): Davis 29, Zubac 26, Duren 19 and Avdija 15 are all let go. After P7H's lineup change one of them could have kept holding in the freed slot.
- **Counts:** 201 such let-gos in 230 real P7H weeks, 180 of them with a positive score (16.5 pts/wk of held score). P2LAH: 0 real, 4 in 46k simulated weeks.
- What is lost is the option value of those scores, not the full 16.5 pts. The simulations also score their alternatives with this flaw built in.

**Valuation note (not a rule bug).** `stopValue` uses the *unconditional* play probability for each later game. The true DP conditions on the observed DNP state; the Lagrangian unit test exposed this.
- Example: player 1 of that test (games μ 18 and 22, sd 8; missed his previous game), p1 = 0.9, p0 = 0.3.
- With p1 = p0 = 1 the two agree exactly.
- With the chain they differ by several points for players coming off a DNP: the exact DP gives 77.2, `stopValue` 80.2, summed over the three test players. `stopValue` over-values option value here because it treats later plays as independent.

#### Sanity findings (policy weaknesses, not rule violations)
**S1. Monotonicity fails for P2LAH: extra players often hurt.**
- **Test:** for every team-week and every player with games, compare E[total] with and without him on 1000 paired (common random number) model scenarios.
- **Result:** dropping the player *raises* the expected total by more than 3 SE in **288 of 4,727** (team-week, player) cases (6.1%). About 6.4 would be expected by chance. 150 of 230 team-weeks have at least one such player; the mean gain in those cases is +1.6 pts.
- **Gain distribution:** p50 −1.75, p90 +0.63, p99 +2.23, max +5.20.

| team-week | dropped player | games | change in E[total] if dropped (95% CI) |
|---|---|---|---|
| w23 r3 | Kyrie Irving | 3 | +5.20 ± 0.90 |
| w7 r6 | Aaron Nesmith | 3 | +4.28 ± 0.85 |
| w12 r10 | Cameron Johnson | 4 | +3.84 ± 0.88 |
| w7 r6 | Coby White | 4 | +3.82 ± 0.85 |
| w23 r3 | Bennedict Mathurin | 4 | +3.70 ± 0.97 |
| w7 r6 | Dereck Lively | 4 | +3.55 ± 0.79 |
| w23 r3 | Jalen Smith | 4 | +3.50 ± 0.92 |
| w7 r5 | Bradley Beal | 4 | +3.30 ± 0.84 |
| w7 r3 | Jrue Holiday | 4 | +2.08 ± 0.84 |

Two mechanisms show up when the same 1000 scenarios are run with and without the player through the checker:
- **Deadline/start inconsistency** (Holiday w7 r3, Nesmith w7 r6). The lock-or-let-go decision at a held player's own deadline assumes he will start tonight. Then the separate start decision gives his slot to someone else, and he is let go *and* sat.
  - Holiday: let go and sat goes from 0.27 to 2.28 pts/wk with him on the roster.
  - Nesmith: 6.3 → 10.8 pts/wk.
  - This is the "lock and start decisions are separate searches" flaw from CLAUDE.md, now measured.
- **Reserved slots beat held scores** (Kyrie Irving w23 r3, projection 10). With holdYield, a held score's slot weight is 1e-9, so it loses its slot to *any* reserved later-tonight player however weak.
  - Kyrie adds about 1.1 forfeits per week to "yield to reserved" and 1.2 to "yield to tonight's starters".
  - Result: 285.3 with him vs 290.5 without.

P7H monotonicity on the worst cases: see the placeholder in section 3 (it runs after the gap study).

**S2. Premature let-gos.** At an early tip-off, held scores give up a slot that is only *reserved* for a player tipping later that night (F_yield_reserved).
- Volume: 12.6 per week for P2LAH, worth 138 pts/wk of held score. Many are 0s from DNPs, and most would be let go anyway.
- Keeping them until the reserved player's own tip-off is never worse: same options later, plus the results of the games then in progress.

**S3. Let go at his own deadline, then sat** (F_deadline_benched): 0.33/wk (3.0 pts/wk of held score) for P2LAH, 0.40/wk for P7H. See S1.

**S4. Weakly dominated lock slots** (S_lock_wider), about 0.5/wk.
- A lock into e.g. UTIL while the narrower C slot (also eligible) was open. Locking into the narrower slot keeps strictly more options.
- Almost all come from `lockAware`'s "lock where he already sits if within 0.25 pt", a deliberate trade for fewer moves in the app.

**S5. No idle-slot benching ex ante** (S_idle_bench_exante = 0 everywhere).
- About 1 tipping player per week sits while an eligible slot then stays unused for his whole game (I_idle_bench_expost).
- In every case some later-tipping or held player *could* have needed that slot. They are reasonable ex-ante trade-offs, not dominated choices.

**S6. Reachability is not a problem in practice.**
- Every lineup and lock the engine assumed was reachable by legal moves without benching a held player (L_lineup_unreachable = 0), in every data set.
- About 2 locks per week need a move first.

### 2. The Lagrangian upper bound (`lib/engine/lagrange.ts`)

**The problem being bounded.** One team-week under the backtest's walk-forward model: player p has games
k = 1..n_p with tip τ_pk and end e_pk = τ_pk + 2.5 h; he plays with probability p1 / p0 after playing / missing his
previous game (Markov chain, observed after every game, benched or not; a per-game override replaces it when the live
app has an injury tag); if he plays he scores X_pk = max(−5, μ_pk + σ_pk Z), Z ~ N(0,1) (or the empirical residual
quantiles when `RESID` is set); players are independent. This is exactly what `sampleScenario` draws.
OPT = the best expected weekly total over all non-anticipative policies that obey the rules (1)–(9) in CLAUDE.md.

**Relaxation.** The only coupling between players is capacity: slot s holds at most one player at a time, where
"holds" means in a game (pinned), holding a finished score, or locked. Time is cut into buckets
b = [t_b, t_{b+1}) between consecutive distinct values of {all tips, all ends, week end T}. That is about
35–60 buckets per team-week, and every occupancy interval below starts and ends on a bucket boundary, so **no time
discretisation error** arises. For prices μ_sb ≥ 0 (points charged for occupying slot s during bucket b), and with
m_p(b) = min over slots s eligible for p of μ_sb, every player solves his own exact problem:

| player's situation | action | charge |
|---|---|---|
| tip-off of game k, nothing held | bench | 0 (play/DNP still observed, chain moves on) |
| | start (pinned to one eligible slot for the game) | G_k = min_s Σ_{b ⊂ [τ_k, e_k)} μ_sb |
| game k ended with score x (0 if DNP), k < n | let go | 0, continue to game k+1 |
| | keep: hold to his next tip-off (may move between eligible slots), lock just before it | H_k + L_{k+1}, with H_k = Σ_{b ⊂ [e_k, τ_{k+1})} m_p(b) and L_{k+1} = min_s Σ_{b ⊂ [τ_{k+1}, T)} μ_sb; reward x, no further games |
| final game ended with score x | let go | 0 |
| | hold to week end (auto-count, rule 6) | Σ_{b ⊂ [e_n, T)} m_p(b); reward x |

V_p(μ) = optimal value (reward − charges) of this DP. The state is (game index, played-last flag), with closed forms
E[max(v, X)] = emax(μ, σ, max(v, −5)) and P(X > v), so the DP is exact. Then

  **bound(μ) = Σ_p V_p(μ) + Σ_{s,b} μ_sb  ≥  OPT  for every μ ≥ 0.**

**Proof.** Fix any rule-abiding policy π and write o_psb ∈ [0,1] for the fraction of bucket b that p spends in slot s.
Capacity holds on every sample path, so Σ_p o_psb ≤ 1. Hence
E[W(π)] ≤ E[W(π)] + Σ_sb μ_sb (1 − Σ_p E[o_psb]) = Σ_p (E[W_p(π)] − E[C_p(π)]) + Σ μ_sb,
where W_p is what p contributes and C_p = Σ_sb μ_sb o_psb is his charge. It remains to show
E[W_p(π)] − E[C_p(π)] ≤ V_p(μ) for each p.
*(i) Information.* Under π, p's actions depend on his own history and on the others' history. The others' processes
are independent of his, so to p's own problem they are an independent randomisation that reveals nothing about his
future. A randomised policy can't beat the optimal deterministic one, so only p's own information matters.
*(ii) Every rule-abiding behaviour of p is dominated, path by path, by a DP action with ≥ reward and ≤ charge.*
- A game he didn't start pays and earns nothing.
- A started game pins him to one eligible slot for [τ_k, e_k), so he pays ≥ G_k.
- After the game, his score x ends in one of three ways:
  - (a) He locks it at some u ≤ τ_{k+1} (≤ T for the final game; rule 3) into a slot s'. He pays ≥ Φ(u) := ∫_{e_k}^{u} m_p + Σ_{b ⊂ [u,T)} μ_{s'b}.
    Φ is non-increasing in u: delaying the lock replaces a charge of μ_{s'b} by m_p(b) ≤ μ_{s'b}. So Φ(u) ≥ Φ(τ_{k+1}) = H_k + L_{k+1}, which is the DP's "keep" charge for the same reward x.
    For the final game, Φ(u) ≥ the hold-to-week-end charge.
  - (b) It counts at week end (final game only). He pays at least the hold-to-week-end charge.
  - (c) It is given up: benched, replaced by his next game (rule 5), or never counted. Reward 0, charge ≥ 0. The DP's "let go" at e_k gets the same continuation at zero charge.
- Sitting in a slot while holding nothing earns nothing and only adds charge.

So V_p(μ) ≥ E[W_p(π) − C_p(π)], and summing over players gives bound(μ) ≥ E[W(π)] for every π, in particular the optimal
one. ∎

What the relaxation gives away is precisely the capacity coupling. It is a "fluid" bound: by LP duality,
min_μ bound(μ) = max Σ_p E[reward of a randomised single-player policy] subject to Σ_p E[o_psb] ≤ 1, i.e. capacity
holds **in expectation, not on every sample path**. It is loose where contention varies between scenarios (DNPs,
several big games on one night). Note also that the relaxation counts a negative final game as 0 (bench him), and
that each player's lock deadline is his own next tip-off (in reality, too).

**Minimising it.** bound(μ) is convex: each V_p is a maximum over policies of functions affine in μ. A subgradient is
∂bound/∂μ_sb = 1 − Σ_p P(p occupies s during b under his optimal relaxed policy), computed by a forward pass over
the DP. Ties in the argmin slot pick any optimal slot; the finite-difference unit test confirms the formula.
Minimisation uses projected Adam steps (`tightBound`: 200k iterations at rate 0.3, then 200k from the best point at
rate 0.03, ~10 s per team-week). Every μ evaluated gives a valid bound and the lowest is reported, so convergence
affects only tightness, not validity. On sampled team-weeks the result is within 0.01 pts of 1M-iteration runs.
Plain Polyak / level-target steps converged far worse (1–40 pts above). The only numerical approximation is the
Abramowitz–Stegun normal CDF inside `emax` (absolute error < 1e−7 per term).

**Validation on tiny weeks** (`tests/lagrange.test.ts`, `research/lagtiny.ts`). OPT is computed by exact
expectimax over the real rules (`research/bruteforce.ts`), with these rules:
- decisions at every tip-off: start/bench with a slot; each held score keep / lock into an open eligible unpinned slot / let go;
- a held player tipping off must lock or let go;
- held players may be rearranged in any feasible way;
- discrete scores, DNP chain.

Instances are 1–2 slots, 2–3 players, 2–3 games each:

| 300 random tiny weeks | mean |
|---|---|
| exact optimum | 24.86 |
| Lagrangian bound | 25.29 (+0.43 pts, +1.7%; median 0%, p90 4.6%, max 11.6%) |
| bound exact (within 0.01) | 154 / 300 |
| bound < optimum | **0 / 300** |
| no-slot-limit relaxation (μ = 0) | 33.09 |
| E[perfect hindsight] | 27.11 |
| bound > E[hindsight] | 8 / 300 |

The 8 cases are all 1–2 slot weeks with contention that varies a lot between scenarios. "bound ≤ E[hindsight]" is
therefore **not a theorem**: the two are different relaxations, one drops capacity-on-every-path, the other drops
non-anticipativity. Both are valid upper bounds, so the tightest bound is the smaller of the two. Without contention
(one UTIL slot per player) the bound equals the brute-force optimum exactly.

### 3. Optimality gap on the 2025-26 season (`research/gap.ts`)
For each team-week, under the walk-forward model fitted on earlier weeks (as in `btcommon`):
- **Bound:** `tightBound` (one value per team-week).
- **E[P2LA], E[P2LAH], E[perfect hindsight]:** 2000 model scenarios.
- **E[P7H]:** the first 20 of those scenarios (common random numbers), each also run through the invariant checker. E[P7H] is estimated as E_2000[P2LAH] + mean_20(P7H − P2LAH), a control variate with the CI reported.

**Results on the fixed engine** (`research/out/gap2_*`, all 230 team-weeks; policies with all Phase-1 fixes including
B4 heldTie). A legacy-engine sample (52 team-weeks) is in "Phase 1 fixes: season results" below.

| quantity (model expectation, mean per team-week) | value | gap to bound |
|---|---|---|
| no-slot-limit relaxation (μ = 0) | 439.4 | |
| E[perfect hindsight] (upper bound) | 320.1 | |
| **Lagrangian bound** (upper bound) | **301.4** | 0 |
| E[P7H] (20 sc./wk, CRN control variate) | 289.7 ± 0.5 | **11.7 ± 0.5** (3.9%) |
| E[P2LAH] (2000 sc./wk) | 283.2 ± 0.1 | 18.2 (6.0%) |
| E[P2LA] (2000 sc./wk) | 282.3 | 19.1 |

**Gap distribution per team-week:**
- bound − E[P2LAH]: p10 14.5, p50 18.3, p90 22.1, max 28.1.
- bound − E[P7H]: p10 6.7, p50 12.2, p90 16.4, max 22.5.

**Sanity:**
- bound < E[P2LAH] − 3 SE in **0** team-weeks;
- bound > E[hindsight] in **0** (so on real weeks the Lagrangian is the tighter of the two upper bounds by 18.7 pts);
- bound below the noisy E[P7H] estimate in 0.

**Model vs real outcomes.**
- Under the model, P7H − P2LAH is +6.45 ± 0.47. On the real outcomes it is +8.30 (legacy engine) and +5.68 (fixed engine).
- Model expectations are ~10 pts above the real-outcome backtest (P2LAH 283.2 vs 276.8). The walk-forward model is optimistic, which is a projection-calibration question, not a policy one.

| weeks | team-weeks | bound | E[hindsight] | E[P7H] | E[P2LAH] | gap P7H | gap P2LAH |
|---|---|---|---|---|---|---|---|
| 1–6 | 60 | 304.6 | 323.5 | 292.9 | 287.3 | 11.6 | 17.3 |
| 7–12 | 60 | 303.7 | 322.2 | 292.1 | 286.0 | 11.6 | 17.7 |
| 13–18 | 60 | 294.8 | 313.7 | 283.7 | 277.2 | 11.1 | 17.6 |
| 19–23 | 50 | 302.9 | 321.0 | 290.1 | 282.3 | 12.9 | 20.6 |

Worst team-weeks by gap to P2LAH (E[P7H] with its own 95% CI; per-week P7H estimates are noisy):

| team-week | bound | E[hindsight] | E[P2LAH] | E[P7H] | gap P2LAH | gap P7H |
|---|---|---|---|---|---|---|
| w21 r5 | 303.4 | 314.9 | 275.3 | 289.2 ± 9.1 | 28.1 | 14.3 |
| w21 r4 | 300.4 | 312.8 | 272.7 | 289.6 ± 7.8 | 27.7 | 10.8 |
| w21 r9 | 336.9 | 349.3 | 310.3 | 319.6 ± 7.5 | 26.5 | 17.3 |
| w22 r9 | 323.5 | 345.3 | 298.5 | 310.2 ± 9.1 | 25.1 | 13.3 |
| w19 r4 | 289.3 | 302.5 | 264.6 | 275.8 ± 5.3 | 24.7 | 13.5 |
| w23 r4 | 295.6 | 313.7 | 271.5 | 286.9 ± 7.9 | 24.1 | 8.6 |
| w21 r1 | 288.3 | 301.1 | 264.6 | 270.7 ± 8.0 | 23.7 | 17.5 |

Smallest gaps (P2LAH): w17 r7 (bound 265.7, E[P2LAH] 256.3), w8 r9 (272.1 / 262.6).

**Interpretation.**
- The live rule-plus-simulation policy (P7H) is within **11.7 pts (3.9%)** of an upper bound on the best possible expected week under the model. The rule alone (P2LAH) is within 18.2 (6.0%).
- The true optimum lies somewhere in between: the bound is a fluid relaxation, and on tiny weeks it exceeds the optimum by ~1.7% on average (≈ 5 pts at this scale).
- So the realistic remaining headroom for better algorithms is roughly **5–10 pts/wk** over P7H. That is worth Phase 2 (a better base rule closing part of the 18-pt gap that rollouts can then build on), but not unlimited.

**P7H invariant checks on the 4,600 model weeks of this run:**
- 0 rule violations;
- S_forfeit_unforced 159 (0.03/wk, the reserved-slot re-seat gap noted below);
- S_idle_bench_exante 14;
- S_lock_wider 0.54/wk.

The P7H monotonicity subset was not run: the fixes changed the engine, and Phase 2 re-tests monotonicity on the new base rule.

### Reproduce
```
npx esbuild research/invariants.ts --bundle --platform=node --format=cjs --outfile=research/dist/invariants.cjs --log-level=error
npx esbuild research/gap.ts --bundle --platform=node --format=cjs --outfile=research/dist/gap.cjs --log-level=error
node research/runtasks.mjs research/dist/invariants.cjs inv main          # ~15 min on 13 cores
node research/runtasks.mjs research/dist/gap.cjs gap "" N7=20             # ~2 h
cd research/out && python3 ../summ_phase1.py                              # tables; writes mono7_tasks.txt
node research/runtasks.mjs research/dist/invariants.cjs mono7 mono7 N7=20 TASKS=<contents of mono7_tasks.txt>
npx tsx research/lagtiny.ts 300                                           # bound vs brute force on tiny weeks
```

### Phase 1 fixes (engine changed; effects TBD by backtest)
All rule bugs found in Phase 1 are fixed in `lib/engine/core.ts`, test-first (`tests/fixes.test.ts`). The old behaviour
stays runnable for measurement:
- `Policy.legacyBugs: true` re-enables all of them; a list re-enables only those (e.g. `["strand", "stop"]`).
- Backtest / research policy names: `P2LAH_L`, `P7H_L` (all legacy), or `P7H_Lreseat`, `P2LAH_Lstrand+negEnd`, etc.
- `P2LAH_L` and `P7H_L` reproduce the Phase-1 backtest exactly: 230/230 real team-weeks for P2LAH, and week 1 for P7H, against `base_hy`.

| flag | bug | fix |
|---|---|---|
| `strand` | B1: a lock could take the slot a held teammate needs now (hidden forfeit, once counted: 93 reported vs 48 legal in the unit test) | `lockFeasible` / `heldSeatable`: `evalLock`, the lock rollouts' alternatives, and every place a lock is applied (`legalLock`: an infeasible hook slot falls back to the rule's slot, else no lock) only use slots that leave every other held player seatable |
| `negEnd` | B2: negative held final-game scores counted at week end | benched to 0 at week end; `stopValue` values a final game as E[max(X, 0)] |
| `reseat` | B3: a lineup changed by start/sit simulation left held scores forfeited although a slot had become free | `reseatHeld` (applied in `startGroup` and to every alternative the start simulations score): seated held players stay; let-go ones are re-seated in slots the lineup leaves free, best scores first |
| `heldTie` | **B4 (new, found while fixing B3)**: with holdYield every held score had the same 1e-9 slot weight, so on a crowded night which held scores kept a slot was arbitrary. Example w1 r1 Thu: a held 0 and 5.5 kept slots while a held 14 and 10.5 were let go | held weights stay below any tonight/reserved player's but are ordered by the held score |
| `stop` | valuation: `stopValue` used unconditional play probabilities for later games | exact DP over the DNP chain (one emax per game, as before). `skipValue` (bench tonight) and the in-game branch of `playerValue` also condition on whether he plays the current game |

**Unit tests** (`tests/fixes.test.ts`): every bug is reproduced with its legacy flag and shown fixed.
- B1: a hook-forced strand; the rule's own strand found by random search (Lonzo-Ball-style); the 93-vs-48 accounting case.
- B2, B3, B4: one case each.
- `stopValue` equals the brute-force expectimax optimum on four single-player weeks with the DNP chain; the legacy marginals differ from it.
- `npm test`: 40/40 pass.

**Checker re-run (single process, preliminary; not a backtest):**

| data | legacy (`_L`) | fixed |
|---|---|---|
| P2LAH, 230 real team-weeks | 272.00 pts/wk; L_held_stranded 1, S_weekend_negative 7 | **276.78**; no L_ violations, recount = engine total everywhere, 5 negative scores benched |
| P2LAH, 23,000 model weeks (100 per team-week, same scenarios) | 280.27; L_held_stranded 56, L_count_forfeited 1, S_weekend_negative 335 | **283.30**; no L_ violations, no unforced let-gos |
| P7H, week 1 real (10 team-weeks) | 281.10; 3 idle let-gos (52.5 pts) | 281.55; no L_ violations, no unforced let-gos |

Fixed P7H is about 20% slower per week: the exact valuation calls `stopValue` twice in a few places.

**Still to do (CPU is busy with the gap run):**
- Paired season backtest of P2LAH / P7H vs `_L`, and one flag at a time (`P7H_Lstrand`, `_LnegEnd`, `_Lreseat`, `_LheldTie`, `_Lstop`) to measure each fix.
- The gap tables above are for the legacy engine.
- Not yet fixed (policy weaknesses, not rule bugs): premature yields to reserved players (S2), let go then sat (S3), the deadline/start inconsistency behind most monotonicity failures (S1).

### Phase 1 fixes: season results
**Backtest.** Paired season backtest on the real 2025-26 outcomes: 230 team-weeks, same seeds, K = KS = 200.
- `_L` = legacy (all fixed bugs re-enabled; reproduces the Phase-1 numbers exactly).
- `_L<flag>` = all fixes except that one.
- Win% = share of team-weeks beating the real opponent's actual score (as in `summ2.py`).
- Commands: `research/summ_fix.py` (run from `research/out`) on the `fix_*` outputs.

| policy | pts/wk | vs | paired diff (95% CI) | weeks 1–11 | weeks 12–23 | better/worse weeks | win% (vs baseline) |
|---|---|---|---|---|---|---|---|
| **P2LAH** (all fixes) | **276.8** | P2LAH_L 272.0 | **+4.78 ± 2.50** | +3.11 ± 3.17 | +6.32 ± 3.79 | 122/86 | 63.6% (61.0%) |
| **P7H** (all fixes) | **282.5** | P7H_L 280.3 | +2.16 ± 2.41 | +1.12 ± 3.16 | +3.12 ± 3.59 | 117/88 | 65.0% (64.0%) |
| P7H − P2LAH, fixed | | | +5.68 ± 2.33 | +7.05 ± 3.21 | +4.43 ± 3.36 | 138/75 | |
| P7H − P2LAH, legacy | | | +8.30 ± 2.68 | +9.03 ± 3.62 | +7.64 ± 3.91 | 153/67 | |

**One fix reverted at a time** (positive = reverting it gains points):

| reverted | P2LAH: change vs fixed | P7H: change vs fixed |
|---|---|---|
| `strand` (B1) | +0.17 ± 1.01 | +0.22 ± 1.68 |
| `negEnd` (B2) | +0.02 ± 0.43 | +0.70 ± 1.15 |
| `reseat` (B3) | 0.00 (never triggers without simulations) | +0.76 ± 1.01 |
| `heldTie` (B4) | +0.52 ± 0.79 | **+1.94 ± 1.90** |
| `stop` (exact DNP-chain DP) | **−3.84 ± 2.28** | **−2.39 ± 2.27** |

**Reading:**
- **The exact `stopValue` is the real gain.** Reverting it costs 3.8 pts/wk (P2LAH) and 2.4 (P7H), in both halves of the season.
- **The three rule-correctness fixes (strand, negEnd, reseat) are point-neutral, as expected.** They are rare: strand happened in 0.26% of weeks, and a negative final score costs ≈ 0.05 pts/wk. Their effects are inside the ≈ ±1 pt "butterfly" noise. Any change to one decision reshuffles all later rollout draws, which is why reverting negEnd can appear to *gain* +0.7 even though it only removes negative points.
- **The heldTie ordering does not help and may hurt P7H** (+1.94 ± 1.90 when reverted, positive in both halves).
  - Plausible mechanism: when held scores are ordered by size, the big ones keep holding at a crowded tip-off and skip the lock-or-let-go evaluation. Under the arbitrary order, some big ones lose the tie, get evaluated, and are locked at a good moment.
  - Caveat: the legacy tie-break is roster index order, which follows the league's own roster listing.
  - All fixes except heldTie (`P7H_LheldTie`): **284.4 pts/wk, +4.10 ± 2.30 vs P7H_L (280.3)**, weeks 1–11 +2.82 ± 3.26, weeks 12–23 +5.28 ± 3.23, win% 67.8% vs 64.0%. For P2LAH the same variant is +5.30 ± 2.47 vs legacy.
  - This variant was picked as the best of 7 after seeing the data, so its CI is optimistic.
- **Shipping recommendation:**
  - Ship strand, negEnd and reseat (they make the engine legal; points neutral) and stop (+2.4 to +3.8).
  - Do not ship heldTie as is: leave the old tie-break (`legacyBugs: ["heldTie"]`) until a better held-score priority is tested. The heldTie fix is a policy choice, not a rule correction.
  - The bar from ENGINE_V2 ("beats P7H 280.3, paired CI") is met by P7H-without-heldTie (+4.10 ± 2.30), and only weakly by P7H with all fixes (+2.16 ± 2.41).

**Invariant checker, full season, fixed engine** (`inv2_*`).
- The instrumented totals equal the fixed backtests in 460 / 460 runs.
- **Rule violations: 0** in every data set: real P2LAH, real P7H, and 46,000 simulated P2LAH weeks. Before the fixes there were 1 + 1 real and 121 + 1 simulated.

| sanity / forfeit check | P2LAH real: legacy → fixed | P7H real: legacy → fixed | P2LAH 46k sim: legacy → fixed |
|---|---|---|---|
| L_* rule violations | 1 → **0** | 1 → **0** | 123 → **0** |
| S_forfeit_unforced (held score let go though it could stay) | 0 → 0 | 180 (16.5 pts/wk) → **9 (0.81 pts/wk)** | 3 → 0 |
| S_weekend_negative (negative score counted) | 7 → 0 (5 benched) | 6 → 0 | 639 → 0 |
| S_idle_bench_exante | 0 → 0 | 0 → 1 | 0 → 0 |
| S_lock_wider | 0.57 → 0.61/wk | 0.46 → 0.47/wk | 0.54 → 0.65/wk |
| F_deadline_benched (let go at own tip-off, then sat) | 0.33 → 0.20/wk | 0.40 → 0.30/wk | 0.28 → 0.20/wk |
| F_yield_reserved (premature let-go) | 12.6 → 10.9/wk | 13.1 → 13.0/wk | 11.6 → 10.1/wk |
| monotonicity: dropping a player significantly raises E[total] (P2LAH, 1000 paired scenarios) | 288 / 4,727 (6.1%), max +5.20 → **66 (1.4%), max +2.99** | not run | |

**Remaining (not fixed, documented):**
- **9 P7H let-gos** (w13 r10 Wed 21:30 ET: Drummond, C, held 11):
  - P7H sat a starter, and Drummond could have stayed if the two reserved later-tonight players (Bridges SG/SF/PF, Collins PF/C) had shifted one slot.
  - `reseatHeld` keeps reserved players on their exact slots, while the checker lets them move. Follow-up: let reserved players move inside `reseatHeld`.
  - Kept as is so the code matches the backtest above.
- **1 ex-ante idle bench** (w22 r9, Draymond Green): P7H sat him to free his slot for later tip-offs, while a different eligible slot stayed empty and unusable for his whole game.
- **Policy weaknesses unchanged:** premature yields to reserved players (S2), and the deadline/start inconsistency (S3, smaller now). Remaining monotonicity failures are 66, about 10× the 6.4 expected by chance.

**Gap study.**
- **Legacy engine, partial:** the run on the legacy engine was stopped by the manager. Its finished team-weeks are kept as a sample in `research/out/gap_oldengine/`: 52 valid team-weeks from weeks 1–6, 20 P7H scenarios each.
  - Another 11 files in that directory named `gap_6_*` / `gap_7_*` are invariants-format outputs, not gap results, and are skipped.
  - Summary command: `python3 ../summ_gapdir.py 'gap_oldengine/*.json'`.

| legacy engine, 52 team-weeks (weeks 1–6) | mean |
|---|---|
| no-slot-limit relaxation | 445.1 |
| E[perfect hindsight] | 322.8 |
| **Lagrangian bound** | **303.8** |
| E[P7H] (control variate, 20 sc.) | 290.9 ± 1.1 |
| E[P2LAH] (2000 sc.) | 284.2 |
| E[P2LA] | 282.7 |

  - bound − E[P2LAH]: mean 19.5 (p10 15.3, p50 19.7, p90 23.2, max 24.6).
  - bound − E[P7H]: mean 12.8 (p10 7.3, p50 12.5, p90 18.9, max 22.2).
  - Sanity: bound < E[P2LAH] in 0 team-weeks; bound > E[hindsight] in 0.
- **Fixed engine, full season:** see section 3 (`research/out/gap2_*`).

## Engine v2 — Phase 2: Lagrangian index policy (P8) and rollouts on it (P9)

### Design (`lib/engine/p8.ts`; tests `tests/p8.test.ts`)
**Prices.**
- Slot prices μ (points per slot and time bucket) are the minimiser of the Phase-1 Lagrangian bound for the team-week.
- `lagrange.ts` can now build the relaxed problem from any engine state (`fromState`): held scores, in-game players pinned to their slot, locked slots removed (their points a constant), the DNP chain carried over. This gives the relaxed rest of the week at time t; the bound proof of Phase 1 applies unchanged.
- **Week start:** `tightBound`, 2 × 100k Adam iterations, ~5 s per team-week.
- **Decision times:** a warm-started re-solve. New buckets are unions of old ones, so the old prices carry over exactly.

**Decision at each tip-off.** One exact max-weight assignment over the free slots (bitmask DP, at most 9 slots; checked against brute force). The weights are each player's priced DP advantage:

| candidate | slot-using actions (value) | baseline |
|---|---|---|
| player tipping off | start in s: his DP value of starting, net of the price of s for the length of his game | bench (his DP value of skipping tonight) |
| held score whose own game tips now (his deadline) | lock in s: x minus the price of s to week end; or start the new game in s | let go and bench |
| other held score | hold: slot-independent, his best hold value (held players can be rearranged freely); or lock in s, only with a real priced advantage | let go (his DP value from his next game on) |

- Deadline lock-or-let-go and tonight's starts are therefore **one joint decision**.
- **"Keep holding and sit tonight's player"** happens whenever the prices say so: there is no blanket holdYield or reserve rule, and later tip-offs are reserved through the prices.
- **A held score with a non-positive advantage** still keeps a free slot nobody else values (a tiny weight; staying put breaks ties).
- **Idle-slot fill:** after the assignment, leftover tipping players are started in free slots that no later-tipping player could use during their game. At equilibrium prices competing candidates are near indifferent, and "advantage > 0" alone left slots idle.

**Rules by construction.**
- Every kept held score and every lock is seated by the assignment, so a lock can't strand a teammate.
- The rearrangement must be reachable by legal moves (rule 9): `reachable()` runs the checker's BFS (`lib/engine/moves.ts`) from where held players sit.
- If unreachable, P8 uses an equivalent reachable seating; if none exists, it re-decides with held players staying put.

**P9.** P8 decisions, plus rollouts at every tip-off over the index decision and up to 4 alternatives within 10 index points:
- seat or unseat each candidate in turn;
- swap lock ↔ play/hold for held scores.

Each is scored by K continuations of the week (common random numbers). A change needs a > 0.5 pt gain.
- **P9:** continuations played by P8f, K = 200.
- **P9b:** continuations played by P8 itself (prices re-solved inside the rollout), K = 50.

Rollouts run on their own price state, seeded from the real decision's prices.

### Tuning (model scenarios, common random numbers)
Design choices were tested under the model on 46 team-weeks (2 teams per week) × 20–40 paired scenarios, with the real outcomes of those team-weeks alongside (`research/p8exp.ts`, `research/summ_exp.py`). Gains are vs P2LAH_LheldTie (model E 281.8–282.1).

| variant | model gain (95% CI) | ms per simulated week | note |
|---|---|---|---|
| week-start prices only (P8s), no idle fill | −5.23 ± 1.90 | 1.2 | stale prices: e.g. a week-end slot "costs" ~20 pts even when half the slots are empty, so good final games are sat |
| week-start prices + idle fill | −2.17 ± 1.62 | 1.0 | |
| re-solve daily (3000 iters) | +5.87 ± 1.26 | 324 | |
| **re-solve every tip-off (3000 iters)** | **+9.38 ± 1.06** | 1501 | |
| re-solve every tip-off, 100 iters | +9.13 ± 1.42 | 43 | 100 warm-started iterations suffice |
| re-solve every tip-off, 30 / 10 iters | +7.09 / +4.30 | 27 / 10 | |
| re-solve only after new results (`info`), 100 / 30 / 10 iters | +7.33 / +5.69 / +3.43 | 19 / 7.4 / 3.8 | our own starts move the prices too |
| fill idle slots with any leftover starter ("all") | −2 vs "idle" | | reservation through prices matters |
| keep bonus for held scores 0.03 / 0.1 / 0.3 / 1 pt | −1.0 / −1.6 / −3.7 / −8.2 vs none | | sticky held scores block later starters |
| **final P8**: slot-independent hold weight, keep 0, every tip-off, 100 iters | **+9.66 ± 1.36** | 43 | |
| **final P8f**: same, after new results only, 30 iters | **+7.07 ± 1.57** | 7.5 (2.6× P2LAH) | |

**Cost.**
- P2LAH costs 2.3–3 ms per simulated week (measured while 12 jobs ran).
- P8 costs ~40 ms per simulated week (≈ 15×), dominated by ~30 re-solves × 100 iterations × 10–40 µs.
- P8f stays within the requested 2–3× (7.5 ms).
- The week-start price solve adds ~5 s per team-week (once).
- For the live app, P8 is cheap: about 1 s for a whole week's decisions.

### Season backtest (real 2025-26 outcomes, 230 team-weeks, paired, same seeds; `research/summ_season.py s8,s9 ...`)
Baselines are the live policy and its rule, `P7H_LheldTie` and `P2LAH_LheldTie`. They reproduce the Phase-1 numbers exactly.

| policy | pts/wk | vs | paired diff (95% CI) | weeks 1–11 | weeks 12–23 | better/worse weeks | win% (baseline) |
|---|---|---|---|---|---|---|---|
| **P8** (rule, no rollouts) | **284.4** | P2LAH_LheldTie 277.3 | **+7.08 ± 3.07** | +8.58 ± 4.26 | +5.71 ± 4.40 | 143/82 | 66.8% (63.6%) |
| P8f (fast rule) | 282.3 | P2LAH_LheldTie 277.3 | +4.95 ± 3.00 | +5.85 ± 4.14 | +4.12 ± 4.32 | 136/90 | 64.7% (63.6%) |
| P8s (week-start prices only) | 272.6 | P2LAH_LheldTie 277.3 | −4.66 ± 3.55 | −2.60 | −6.55 | 105/124 | 60.5% |
| P8 | 284.4 | **P7H_LheldTie 284.4 (live)** | −0.02 ± 2.40 | +0.15 ± 3.40 | −0.18 ± 3.40 | 114/103 | 66.8% (67.8%) |
| **P9** (P8 + rollouts, P8f continuations, K = 200) | **284.9** | P7H_LheldTie 284.4 | +0.50 ± 2.23 | −0.72 ± 3.06 | +1.62 ± 3.21 | 107/106 | 65.4% (67.8%) |
| P9b (P8 + rollouts, P8 continuations, K = 50) | 284.5 | P7H_LheldTie 284.4 | +0.11 ± 2.30 | −0.53 ± 3.35 | +0.70 ± 3.16 | 114/98 | 67.5% (67.8%) |
| P9 | 284.9 | P8 284.4 | +0.53 ± 1.43 | −0.87 ± 1.88 | +1.81 ± 2.11 | 63/66 | |
| P9b | 284.5 | P8 284.4 | +0.13 ± 2.03 | −0.68 ± 2.39 | +0.88 ± 3.21 | 90/94 | |
| (P7H_LheldTie vs its rule P2LAH_LheldTie) | 284.4 | 277.3 | +7.10 ± 2.31 | +8.43 | +5.89 | 145/74 | |

(The tuning pass before the final P8 scored P8 283.5 and P9 283.3 on the same season, `s8`. The final P8 changes, slot-independent holds and the reachability guard, were chosen on model scenarios, not on these outcomes.)

### Rules and sanity (full-season checker, `inv4`; P7H / P2LAH from `inv2`)
| check | P8 real | P9 real | P9b real | P8 model (11,500 wk) | live P7H real | P2LAH real |
|---|---|---|---|---|---|---|
| **L_* rule violations** | **0** | **0** | **0** | **0** | 0 | 0 |
| S_forfeit_unforced (held score > 0 let go though it could stay) | 0 | 0.16/wk | 0.53/wk | 0 | 0.04/wk | 0 |
| S_idle_bench_exante | 0 | 1 | 29 | 0 | 1 | 0 |
| S_lock_wider (lock into a wider slot than needed) | 0.06/wk | 0.08/wk | 0.07/wk | 0.08/wk | 0.47/wk | 0.61/wk |
| F_yield_reserved (premature let-go for a later player) | 0 | 0 | 0 | 0 | 13.0/wk | 10.9/wk |
| F_deadline_benched (let go at own tip-off, then sat) | 0.60/wk | 0.64/wk | 0.72/wk | 0.58/wk | 0.30/wk | 0.20/wk |
| F_deadline_replaced (let go at own tip-off for the new game) | 3.23/wk | 3.24/wk | 3.61/wk | 3.12/wk | 1.62/wk | 1.21/wk |
| I_lock_final_game (locks of a final-game score) | 0 | 0 | 0 | 0 | 2.00/wk | 1.49/wk |
| I_start_override (rollouts changed the decision) | — | 1.71/wk | 4.26/wk | — | 1.68/wk | — |

- P8 obeys every rule, including reachability, on 230 real and 11,500 simulated weeks. That includes 2 unreachable rearrangements found by the checker during tuning, now handled by `reachable()`.
- It makes no dominated choices (no unforced let-go, no idle benching), never yields prematurely and never locks a final-game score early.
- P8 plays differently from the rule: about twice as many held scores are given up at their own tip-off (deadline), 3.2/wk vs 1.6/wk for P7H.
- The rollouts reintroduce dominated actions: P9b, with only K = 50, picks 0.53 unforced let-gos and 0.13 idle benchings per week.

### Monotonicity (an extra player never hurts)
Measured on the 46 cases where the old rules failed worst (top 24 drop gains of the legacy rule from `inv`, top 24 of the fixed rule from `inv2`): 300 paired scenarios each, `research/invariants.ts` mode `monoP`.

| dropping the player (46 cases) | P2LAH_LheldTie | P8 |
|---|---|---|
| raises E[total] by > 3 SE | 13 / 46 | **1 / 46** |
| raises E[total] at all | 37 / 46 | 15 / 46 |
| mean change in E[total] | +1.08 | **−0.24** |
| worst case | +3.33 (w8 r8 Vince Williams) | +2.50 ± 1.57 (w12 r10 Cameron Johnson) |

P8 removes almost all of the "an extra player hurts" effect: its decisions are joint (deadline and start in one assignment), and held scores no longer yield to any reserved player.

### How much of the gap closes (model, `gap3` / `gap4` / `gap5`; `research/summ_gap8.py`)
**All 230 team-weeks**, the same 2000 model scenarios per team-week as the Phase-1 gap study (P7H on the first 20):

| quantity (model, mean per team-week) | value | gap to bound |
|---|---|---|
| E[perfect hindsight] | 320.1 | |
| **Lagrangian bound** | **301.4** | 0 |
| **E[P8]** | **291.8** | **9.6** (p10 7.4, p50 9.6, p90 12.4, max 15.6) |
| E[P8f] | 289.6 | 11.9 |
| E[P7H] (Phase-1 fixes incl. heldTie) | 289.7 | 11.7 |
| E[P2LAH] (Phase-1 fixes) | 283.2 | 18.2 |

- P8 − P2LAH: +8.53 ± 0.06 (2000 paired scenarios).
- P8 − P7H: +2.40 ± 0.47 (20 paired scenarios).
- P8, the rule alone, closes **47%** of the rule's 18.2-pt gap to the bound; P7H closes 35%. P8's gap is smaller in every season block (weeks 1–6 / 7–12 / 13–18 / 19–23: 8.9 / 9.6 / 10.0 / 10.3 vs P7H 11.6 / 11.6 / 11.1 / 12.9).
- Sanity: the bound is never below E[P8].

**Against the live policy itself** (46 team-weeks × the first 10 scenarios, all paired; bound 300.4):

| policy | model E | gap to bound | vs live P7H_LheldTie (95% CI) |
|---|---|---|---|
| **P8** | **289.2** | **11.3** | **+2.11 ± 1.34** |
| P9 (P8 + rollouts) | 288.4 | 12.0 | +1.38 ± 1.35 |
| live P7H_LheldTie | 287.0 | 13.4 | 0 |
| P2LAH_LheldTie | 281.3 | 19.2 | −5.79 ± 1.36 |

P9 − P8 under the model: −0.73 ± 0.94.

### Why P9 does not beat the live algorithm on the season
1. **P8 itself is about 2 pts better than live under the model**, but one real season can't resolve 2 pts. The paired real-season CI vs P7H_LheldTie is ±2.4, and the real outcome is a tie: 284.39 vs 284.41. Under the model, the difference is +2.11 ± 1.34 on paired scenarios, and +2.4 ± 0.5 over the larger set against fixed P7H. Model expectations also run ~7 pts above real outcomes (P2LAH 283.2 vs 277.3), so part of P8's model edge may come from trusting the model's price of future contention more than the real season rewards.
2. **The rollouts make P8 slightly worse, not better** (−0.73 ± 0.94 under the model; +0.53 ± 1.43 on the season).
   - A one-step rollout is guaranteed to improve only on the policy that plays the continuations. P9's continuations are played by P8f (cheaper, about 2 pts weaker), so they judge P8's decisions with a weaker yardstick.
   - P9b plays them with P8 itself, but can afford only K = 50. With 4–5 alternatives per decision the best-scoring one is often best by noise (winner's curse).
   - Evidence: P9b changes 4.3 decisions/wk, and 0.53/wk of the changes are dominated let-gos plus 0.13/wk idle benchings. P8 alone makes none of either.
3. **P8 and live play very differently** for the same total on real outcomes (`research/decstats.ts`, `research/summ_dec.py`, per week):

| decision | P2LAH_LheldTie | live P7H_LheldTie | P8 |
|---|---|---|---|
| games started | 31.3 | 35.9 | 39.7 |
| starts that were DNPs | 6.2 | 7.4 | 8.6 |
| locks | 8.3 | 8.1 | 5.6 |
| locks before the player's own deadline | 6.3 | 5.5 | 0 |
| locks of a final-game score | 1.5 | 2.1 | 0 |
| points from locks | 264.2 | 268.7 | 201.3 |
| held scores counted at week end | 0.6 | 0.8 | 3.1 |
| points from week-end holds | 13.1 | 15.7 | 83.1 |
| held scores let go at their own tip-off | 1.4 | 1.8 | 3.8 |
| tipping players sat (their points) | 23.4 (231) | 20.7 (190) | 17.9 (155) |
| week total | 277.3 | 284.4 | 284.4 |

- P8 keeps options open: no early locks, final games held to week end, more games started.
- It gives back held scores at deadlines twice as often, about 3.5 pts/wk let go at deadlines, then sat (F_deadline_benched 0.60/wk vs 0.30).
- These are exactly the decisions whose value depends on how accurate the model's future-contention prices are. On the real season the extra starts and the extra let-gos roughly cancel.

### Cost (single process; `research/scratch/simcost.ts`, 20 team-weeks × 50 model weeks)
| policy | ms per simulated week | vs P2LAH | per decision (≈ 30 tip-offs/week) | real week, top level |
|---|---|---|---|---|
| P2LAH_LheldTie | 1.19 | 1× | 0.04 ms | 0.01 s |
| P8s (week-start prices) | 0.61 | 0.5× | | |
| P8f | 7.8 | 6.6× | 0.26 ms | |
| P8 | 42 | 35× | 1.4 ms (≈ 1 re-solve of 100 iterations) | 0.05 s |
| live P7H_LheldTie | | | ≈ 0.4 s | 12.9 s |
| P9 / P9b | | | ≈ 2.2 s / 2.7 s | 67 s / 82 s |

- Under the 12-way parallel load of the tuning runs, the ratios were lower (P8f 2.6×, P8 15×).
- P8 and P8f also need the week-start price solve: ≈ 5.3 s once per team-week (per roster), cached for the week.

### Recommendation
**Do not replace the live P7H with P8 or P9 yet: the gate (beat 284.4 on the season) is not met.**
- P8 ties live on real outcomes (284.4 vs 284.4, −0.02 ± 2.40) and P9 is +0.50 ± 2.23.
- There are no rule violations, no dominated actions and far fewer monotonicity failures, so nothing blocks shipping on correctness.

P8 is nevertheless the strongest result of the phase:
- it is the best policy under the model (+2.1 ± 1.3 vs live on paired scenarios; 47% of the rule's gap to the optimum closed);
- it matches live P7H on real outcomes at 1/250 of the compute;
- it obeys every rule;
- it nearly fixes monotonicity (1/46 vs 13/46 failures).

Suggested next steps:
- **Keep P8 in the engine** (`Policy.index`), and consider it as a cheap fallback when P7H's simulations can't run.
- **Validate on more data.** A second season, or the 2024-25 season, would show whether P8's +2 model edge holds up on real outcomes.
- **Better rollouts on P8.** If rollouts are kept, they must be played by P8 itself, with enough rollouts per alternative and fewer, better alternatives (Phase 3's racing / successive halving), not a weaker base.

**P8 inside Waivers / Matchups / projections: not as is.**
- These views simulate the rest of the week 20,000 times per team (projections, matchups), 2,000 per roster variant (Waivers) and 6,000 per lock cut-off.
  - With P8 (42 ms per simulated week), a team projection goes from ~24 s to ~14 min, and every roster variant on the Waivers page needs its own ~5 s price solve.
  - P8f (7.8 ms) is the only candidate: ~2.6 min per 20k-sim projection plus the price solve, i.e. it would need 5× fewer simulations or worker-thread budget.
- What makes it attractive for Waivers specifically is monotonicity: P8's "an extra player never hurts" behaviour removes most spurious "drop X gains points" effects (1/46 vs 13/46 on the worst cases).
- Recommended experiment: P8f-based Waivers with N = 400 simulations and the cached price solve, compared against the current P2LAH-based Waivers values.

### Reproduce
```
npx esbuild research/p8exp.ts --bundle --platform=node --format=cjs --outfile=research/dist/p8exp.cjs --log-level=error   # (+ invariants, gap, decstats)
node research/runtasks.mjs research/dist/p8exp.cjs s9 "" 'POLS=P8;P8f;P9;P9b' NSC=0                     # season (real outcomes)
node research/runtasks.mjs research/dist/invariants.cjs inv4 main POLS_REAL=P8,P9,P9b SIMPOL=P8 NSIM=50 NMONO=2
node research/runtasks.mjs research/dist/invariants.cjs monoP monoP TASKS=<research/out/monoP_tasks.txt> MONOPOLS=P2LAH_LheldTie,P8 NMONO=300
node research/runtasks.mjs research/dist/gap.cjs gap3 "" GAPPOLS=P8,P8f N=2000 N7=0
node research/runtasks.mjs research/dist/gap.cjs gap4 "" TASKS=<46 team-weeks> GAPPOLS=P8 N=10 N7=10 GAP7=P9
node research/runtasks.mjs research/dist/gap.cjs gap5 "" TASKS=<same> GAPPOLS=P2LAH_LheldTie N=10 N7=10 GAP7=P7H_LheldTie
cd research/out && python3 ../summ_season.py s8,s9 P8:P2LAH_LheldTie,... && python3 ../summ_inv.py inv4:P8,... && python3 ../summ_gap8.py && python3 ../summ_dec.py
```
Long runs: `node research/launch_detached.mjs <log> <script> ...` (survives the caller).

## Live policy recommendation (overnight 2026-10-14)
The candidates as live engines (`LOCKIN_ENGINE` / `"engine"` in `~/.sleeper-lockin/config.json`, see below):
- **P7H_LheldTie** (= `p7h`, live now): the rule plus start and lock simulations.
- **P8** (= `p8`): the index policy.
- **P8f**: P8's fast variant; it is what `p8`/`p9` use inside the app's mass simulations.
- **P9 / P9b** (= `p9` uses P9): P8 plus rollouts.

| | P7H_LheldTie (live) | P8 | P8f | P9 | P9b |
|---|---|---|---|---|---|
| **real season** (230 team-weeks, pts/wk) | **284.4** | **284.4** (−0.02 ± 2.40 vs live) | 282.3 | **284.9** (+0.50 ± 2.23) | 284.5 (+0.11 ± 2.30) |
| win% vs real opponents | **67.8%** | 66.8% | 64.7% | 65.4% | 67.5% |
| model, paired vs live (46 tw × 10 sc.) | 0 | **+2.11 ± 1.34** | (≈ −0.1)¹ | +1.38 ± 1.35 | n/a |
| model gap to the Lagrangian bound | 13.4 (subset) / 11.7² | **11.3 / 9.6** | 11.9 | 12.0 (subset) | n/a |
| rule violations (checker, season) | 0 | 0 | 0³ | 0 | 0 |
| dominated actions per week (unforced let-go + ex-ante idle bench) | 0.04 | **0** | 0³ | 0.16 | 0.66 |
| monotonicity failures (46 worst cases, > 3 SE) | 13/46⁴ | **1/46** | n/a | n/a | n/a |
| decision compute per real week | 12.9 s | **0.05 s** | 0.02 s | 67 s | 82 s |

Notes:
1. P8f's model E is 289.6 vs P7H 289.7 (all fixes) on the full 230-team-week study.
2. The second figure is P7H with all Phase-1 fixes (gap2), on the full study.
3. P8f was measured on model scenarios only (it is P8 with a cheaper price schedule).
4. Measured for the rule P2LAH_LheldTie that P7H uses for its continuations.

**Live app cost per view** (current league data, league 1344387394811490304, roster 8, week 1 of 2026-27 with 53 of the week's games still to play; 12 worker threads as in the app; one fresh process per measurement, `research/livecost.ts`, `research/livecost_run.mjs`):

| view | p7h (live) | p8 | p9 |
|---|---|---|---|
| projection (teamSims, 20k simulated weeks) | 2.2 s | 11.6 s (5.2x) | 11.6 s (5.2x) |
| advise (decisions + plan + cut-offs + both teams) | 25.0 s | 164.5 s (6.6x) | 165.7 s (6.6x) |
| Waivers (13 roster variants x 2 weeks x 2000) | 177.2 s | 1186.2 s (6.7x) | 1186.2 s (6.7x) same as p8 |
| League (10 teams x 20k) | 151.3 s | 782.0 s (5.2x) | 782.0 s (5.2x) same as p8 |
| IR check | 17.8 s | 395.6 s (22.3x) | 395.6 s (22.3x) same as p8 |

- p9 differs from p8 only in the plan's start decisions (index rollouts), so its projection, Waivers, League and IR runs are identical to p8's (measured for the projection and advise; the other three are the same computation).
- The P8 family's extra cost comes from two places:
  - ~6.6× per simulated week (P8f re-solves prices after each result);
  - the week-start price solve (~5 s) for every new roster variant and worker task. That is why IR, which simulates many small roster variants on one thread, is 22× slower.
- On this week (week 1, nothing played yet), the projected total is 281.8 under p8/p9 vs 276.8 under p7h: the simulated rest of the week is played better (model view). Win probability 51.2% vs 52.3%: the opponent's simulated week also uses the engine.


**Recommendation: keep `p7h` (the current live algorithm) as the default engine.**
- No candidate beats it on the real season beyond noise: P9 +0.5 ± 2.2, P8 −0.0 ± 2.4. The gate (beat 284.4) is not met.
- With the P8 family inside the app's mass simulations, every simulation-heavy view becomes several times slower (table above).
- P9's rollouts add no value over P8 and introduce dominated actions.

**If an alternative is tried, it should be `p8`.** It is equal on real outcomes, better under the model (+2.1 ± 1.3), obeys every rule with no dominated choices, and largely fixes "an extra player hurts" (which also makes Waivers values more sensible). Its cost is in the projection/Waivers/league views, not in the decisions themselves (0.05 s per week).
- A cheaper hybrid deserves a test: P8 for the decisions (plan, cut-offs, lock calls), with the current fast rule kept for projections and Waivers.
- The switch is per process and safe to flip back: caches are keyed by engine, and `p7h` keeps byte-identical fingerprints.

### Configurable engine (`lib/live/engine.ts`)
- **Choice:** `LOCKIN_ENGINE=p7h|p8|p9` (env wins), else `"engine"` in `~/.sleeper-lockin/config.json` (directory overridable with `LOCKIN_CONFIG_DIR`), else `p7h`. The config is re-read every 30 s; unknown values fall back to `p7h` with a warning.
- **Decisions** (`decisionPolicy`): `p7h` uses `POLICY`; `p8`/`p9` use P8 (prices re-solved at every tip-off). This covers the plan's tip-offs and replay.
- **Plan / replay hooks:**
  - `p7h`: unchanged (start-sit simulations / lock simulations);
  - `p8`: none;
  - `p9`: index rollouts played by P8f.
- **Mass simulations** (`simPolicy`): `p7h` uses `POLICY`; `p8`/`p9` use P8f with fresh week-start prices per simulation. This covers decision rollouts (lock/hold/bench options), projections (`teamSims`/`weekValues`, also in the worker threads), lock cut-off simulations (`lockWaitTotals` forces lock or let-go through the index policy's decision hook), Waivers, league and IR.
- **Unchanged for every engine:** the quick lock cut-off seed (`lockThreshold`) still comes from the rule's `evalLock`. For `p8`/`p9` it only seeds the simulated cut-off of the first tip-off and approximates the later ones.
- **Caches:** `fingerprint()` adds the engine for non-default engines only. Default fingerprints are byte-identical, so the default behaviour and its caches are unchanged.
- **Tests:** `tests/engine_select.test.ts` (selection, default unchanged, simulations and cut-offs on p8/p9, hooks).

## Second season validation (2024-25)
Every policy choice so far was made on one real season (2025-26, 230 team-weeks, paired CIs about ±2.4). This section
re-runs the comparison on independent data: the 2024-25 NBA regular season, with synthetic leagues because our league
did not exist then.

### Data (`research/fetch_season2024.py`, `research/build_season2024.py` → `research/data/season2024.json`)
**Sources** (same endpoints as the 2025-26 fetchers):
- Sleeper per-game stats and projections for weeks 1–23 (22 Oct 2024 – 30 Mar 2025, the same 23-week window as 2025-26).
- Stats for weeks 24–25, used only to know whether an injured player ever came back.
- Sleeper season totals for 2022-23 and 2023-24 (draft values).
- ESPN tip-off times for all 152 game days (0 missing).
- Downloads were sequential, 0.6 s apart, with retries, and are cached in `research/data/raw2024/` (not committed).

**Same game construction as `build_dataset.py`:**
- Every rostered player gets one game per scheduled game of his team, with the team taken from his own rows, else his nearest row in time.
- DNP games without any Sleeper row are therefore included as played = false.
- Scoring and slots are copied from our league.
- Positions come from Sleeper's current player data (the same approximation as 2025-26).

**No look-ahead in projections.**
- Sleeper's `last_modified` is after tip-off for 100% of projection rows in **both** seasons, so the timestamp can't prove the projections are pre-game. The statistics can:

| per-game data, rostered players | 2025-26 (real league) | 2024-25 (synthetic leagues) |
|---|---|---|
| team-weeks / players per roster | 230 / 20.6 | 690 / 19.0 |
| games per team-week | 67.2 | 62.0 |
| DNP share | 25.7% | 24.9% |
| mean fantasy points when played | 19.7 | 20.1 |
| projection present: played / DNP | 99.3% / 1.6% | 99.0% / 2.2% |
| corr(projection, actual) | 0.502 | 0.545 |
| mean projection vs actual (played) | 22.8 vs 19.8 | 23.2 vs 20.3 |

- In 2024-25, corr(projection, actual) is 0.550 on the same games where corr(mean of the player's last 10 games, actual) is 0.503. A projection updated after the game would correlate close to 1, so these are pre-game forecasts. Only 10 of 11,485 projections equal the actual score.
- **Projection presence leaks sit-outs** in 2024-25 exactly as in 2025-26: present for 99% of played games and 2% of DNPs. It is handled the same way: `btcommon` never uses presence, only the value, with its own pre-game fallback when there is none. The walk-forward model (projection correction, spread, DNP chain) is fitted on earlier 2024-25 weeks only.

**Synthetic leagues.** Three 10-team leagues: rids 1–10 = A, 11–20 = B, 21–30 = C.
- Each league is a 19-round snake draft, so every roster has 19 players.
- **Preseason value** uses prior seasons only: fantasy points per game under our scoring, with 2023-24 games weighted 2 and 2022-23 games weighted 1, shrunk toward 15 FP/G by 8 pseudo-games.
  - Rookies have no value and are never drafted.
  - The pool is every player with at least one 2024-25 Sleeper row.
  - Sleeper's 2024 season projections were not used: they were edited during the season (`last_modified` up to 2026).
- **Draft variation:** each league has its own random draft order, and each team ranks players by value × exp(N(0, 0.10)).
- **Positional balance:** every roster must cover PG, PG, SG, SG, SF, SF, PF, PF, C, C (bipartite matching on eligibility). A team takes its best-ranked player unless the remaining picks are needed to complete that cover. At most 4 C-only players per team.
- **Lost-for-season replacement** (the only roster change in season), applied at the start of week w ≥ 3. A player is replaced if:
  - (a) his team played in weeks w−2 and w−1 and he played none of those games, **and**
  - (b) he plays no further 2024-25 regular-season game (weeks w–25). This uses hindsight, as a stand-in for the season-ending news a manager would act on.

  He is replaced by the league's best free agent who shares a position with him: the highest mean of his last ≤ 10 games before week w, among players with ≥ 3 games in weeks w−2..w−1.
  - 65 replacements in total, 23 distinct players, e.g. week 3: Saddiq Bey, Bojan Bogdanović, Christian Wood; Wembanyama and Embiid in weeks 20–21; Maxey, Paul George and Kyrie Irving late.
  - Players who came back, even in April (Brunson, Lively), are kept.
- **Matchups:** round robin within each league. There are no human scores.
- The first rounds look like 2024 drafts: Jokić, Embiid, Dončić, Giannis, LeBron, Davis, SGA, Sabonis, Tatum, Wembanyama, Durant. Embiid goes #1–2 on prior-season value and then plays 19 games, which is realistic preseason information.

**Caveat: the three leagues share most players.** 178 of the 203 players rostered in week 1 are on a team in all three leagues.
- Team-weeks within a week are therefore correlated: the same games appear on three rosters.
- Besides the naive paired CI, every result below has a **week-clustered** CI: average the week's 30 team-week differences, then take the CI over the 23 weekly means.
- On 2025-26, with disjoint rosters, the two CIs are nearly equal (P8 − P7H: ±2.41 naive, ±2.30 clustered). The clustered one is the honest CI here.

### Season backtest (690 team-weeks, real 2024-25 outcomes, paired, same seeds; `research/summ_s24.py`)
Same code and settings as the 2025-26 Phase-2 season runs (`research/p8exp.ts`, NSC = 0, K = KS = 200).
- Win% has no human opponent here. It is the share of team-weeks in which the policy beats the opponent's score under the live bot (P7H_LheldTie) in the same runs.

| policy | pts/wk | vs | paired diff | 95% CI naive | **95% CI week-clustered** | league A / B / C | weeks 1–11 / 12–23 | better/worse | win% vs live-bot opp. (baseline) |
|---|---|---|---|---|---|---|---|---|---|
| P7H_LheldTie (live) | 283.2 | P2LAH_LheldTie 276.7 | +6.52 | ± 1.41 | **± 1.99** | +6.7 / +6.0 / +6.9 | +4.67 / +8.21 | 401/224 | 50.0% (47.2%) |
| P8 | 284.2 | P2LAH_LheldTie 276.7 | +7.49 | ± 1.82 | **± 2.59** | +8.9 / +6.9 / +6.7 | +4.88 / +9.90 | 430/243 | 50.3% (47.2%) |
| P8f | 282.4 | P2LAH_LheldTie 276.7 | +5.66 | ± 1.82 | ± 2.64 | +5.9 / +5.9 / +5.2 | +3.04 / +8.07 | 392/282 | 48.7% (47.2%) |
| **P8** | 284.2 | **P7H_LheldTie 283.2** | **+0.98** | ± 1.40 | **± 2.12** | +2.2 / +0.9 / −0.2 | +0.20 / +1.68 | 331/299 | 50.3% (50.0%) |
| **P9** | **285.1** | **P7H_LheldTie 283.2** | **+1.92** | ± 1.34 | **± 2.38** | +2.8 / +2.2 / +0.8 | +0.62 / +3.12 | 341/287 | 52.0% (50.0%) |
| P8f | 282.4 | P7H_LheldTie 283.2 | −0.86 | ± 1.45 | ± 1.85 | −0.8 / −0.1 / −1.7 | −1.63 / −0.15 | 312/326 | 48.7% (50.0%) |
| P9 | 285.1 | P8 284.2 | +0.95 | ± 0.93 | ± 1.03 | +0.6 / +1.2 / +1.0 | +0.42 / +1.44 | 218/177 | |
| P8 | 284.2 | P8f 282.4 | +1.83 | ± 1.11 | ± 1.07 | +3.0 / +1.0 / +1.5 | +1.83 / +1.83 | 258/201 | |
| P9b (P8 + rollouts played by P8, K = 50) | 283.6 | P7H_LheldTie 283.2 | +0.39 | ± 1.42 | ± 2.37 | +1.7 / +0.4 / −0.9 | −1.24 / +1.89 | 327/319 | 51.4% (50.0%) |
| P9b | 283.6 | P8 284.2 | −0.58 | ± 1.22 | ± 1.59 | −0.5 / −0.5 / −0.7 | −1.44 / +0.21 | 242/264 | |
| P9b | 283.6 | P9 285.1 | **−1.53** | ± 1.09 | **± 1.14** | −1.1 / −1.8 / −1.7 | −1.86 / −1.23 | 222/273 | |

### Do the 2025-26 conclusions replicate? (`research/summ_pool.py`; week-clustered 95% CIs; pooled = inverse-variance mean of the two seasons)
| comparison | 2025-26 (real league, 230) | 2024-25 (synthetic, 690) | pooled | replicates? |
|---|---|---|---|---|
| live P7H_LheldTie − rule P2LAH_LheldTie (simulations' value) | +7.10 ± 3.02 | +6.52 ± 1.99 | **+6.70 ± 1.66** | **yes** |
| P8 − P2LAH_LheldTie (index rule vs old rule) | +7.08 ± 3.49 | +7.49 ± 2.59 | **+7.35 ± 2.08** | **yes** |
| P8f − P2LAH_LheldTie | +4.95 ± 3.71 | +5.66 ± 2.64 | +5.42 ± 2.15 | yes |
| P8 − P8f (price re-solve every tip-off is worth it) | +2.13 ± 2.21 | +1.83 ± 1.07 | **+1.89 ± 0.97** | **yes** |
| **P8 − live P7H_LheldTie** | −0.02 ± 2.30 | +0.98 ± 2.12 | **+0.52 ± 1.56** | yes: a tie again (model predicted +2.1 ± 1.3) |
| **P9 − live P7H_LheldTie** | +0.50 ± 2.23 | +1.92 ± 2.38 | **+1.17 ± 1.63** | yes: not significant, leaning P9 |
| P9b − live P7H_LheldTie | +0.11 ± 2.42 | +0.39 ± 2.37 | +0.25 ± 1.69 | yes: a tie |
| P9b − P8 | +0.13 ± 1.74 | −0.58 ± 1.59 | −0.26 ± 1.18 | yes: no gain from rollouts played by P8 at K = 50 |
| P8f − live P7H_LheldTie | −2.15 ± 2.24 | −0.86 ± 1.85 | −1.38 ± 1.43 | yes (P8f is not a live candidate) |
| P9 − P8 (do rollouts help P8?) | +0.53 ± 1.61 | +0.95 ± 1.03 | **+0.83 ± 0.87** | weakly: positive in both seasons and all 3 leagues, CI just includes 0 |

### Rules and sanity (checker on 2024-25, `inv24`: P8 and P9 on the 690 real team-weeks, P8 on 20 model scenarios each)
- The checker's totals equal the backtest totals in **1,380 / 1,380** runs.
- The checker's own legal recount equals the engine total everywhere.

| check | P8 real (690 wk) | P9 real (690 wk) | P8 model (13,800 wk) | P8 real 2025-26 | P9 real 2025-26 |
|---|---|---|---|---|---|
| **L_* rule violations** | **0** | **0** | **0** | 0 | 0 |
| S_forfeit_unforced (held score > 0 let go though it could stay) | **0** | 0.17/wk (3.6 pts/wk) | 0 | 0 | 0.16/wk |
| S_idle_bench_exante | **0** | 11 (0.02/wk) | 0 | 0 | 1 |
| S_lock_wider | 0.07/wk | 0.09/wk | 0.08/wk | 0.06/wk | 0.08/wk |
| F_deadline_benched (let go at own tip-off, then sat) | 0.57/wk | 0.65/wk | 0.59/wk | 0.60/wk | 0.64/wk |
| F_deadline_replaced | 3.76/wk | 3.82/wk | 3.74/wk | 3.23/wk | 3.24/wk |
| F_yield_idle | 0 | 0.19/wk | 0 | 0 | 0.20/wk |
| I_start_override (rollouts changed the index decision) | — | 1.70/wk | — | — | 1.71/wk |

The rule and sanity profile replicates almost to the decimal:
- P8 obeys every rule and makes no dominated choice.
- P9's rollouts bring back about 0.17 unforced let-gos per week, the same as on 2025-26.

### Reading
- **The big effects replicate.** Simulation on top of the rule (+6.5 vs +7.1) and the index rule over the old rule (+7.5 vs +7.1) are the same size on a second season, with different rosters and a different year.
- **P8 vs live is a tie in both seasons.** It leans the other way this time: −0.02 on 2025-26, +0.98 ± 2.12 on 2024-25, pooled +0.52 ± 1.56.
  - The model's +2.1 edge for P8 is still not confirmed on real outcomes, but it is no longer contradicted either. The pooled CI includes +2.
- **P9 has the best point estimate in both seasons** (+0.50, +1.92; pooled +1.17 ± 1.63 vs live; +0.83 ± 0.87 vs P8).
  - This is more favourable to the rollouts than the Phase-2 model result (P9 − P8 −0.73 ± 0.94).
  - None of these differences is significant, and P9 still makes ~0.17 dominated let-gos per week.
- **P9b (rollouts played by P8 itself, K = 50) is worse than P9 (played by P8f, K = 200).** It loses by −1.53 ± 1.14 on 2024-25, in all 3 leagues and both halves, and ties live and P8 in both seasons.
  - The number of rollouts matters more than the strength of the policy that plays them. At K = 50 the best-looking alternative is often best by noise, which supports the Phase-2 winner's-curse reading.
  - Phase 3's adaptive sampling (racing with common random numbers) is the way to afford P8-played rollouts.
- **The gate is still not met.** No candidate beats the live P7H_LheldTie with a CI excluding 0 on either season or pooled.
- **The live recommendation stands:** keep `p7h`; `p8` is the low-cost equal alternative.
  - The case for P9 is somewhat stronger than after one season. Removing its dominated let-gos (rollouts that may not choose a dominated action) would be a cheap next step before testing it again.
- **The synthetic-league design limits what this season can say.**
  - Rosters are drafted, not managed: no waivers or streaming, no IR stash, no human tendencies.
  - The three leagues share most players.
  - The point totals are on the same scale as 2025-26 (P2LAH_LheldTie 276.7 vs 277.3; live 283.2 vs 284.4), which suggests the test is comparable.

### Reproduce
```
python3 -I research/fetch_season2024.py && python3 -I research/build_season2024.py      # data (~5 min of polite downloads)
npx esbuild research/p8exp.ts --bundle --platform=node --format=cjs --outfile=research/dist/p8exp.cjs --log-level=error   # (+ invariants)
node research/runtasks.mjs research/dist/p8exp.cjs s24 "" SEASON=research/data/season2024.json 'POLS=P2LAH_LheldTie;P7H_LheldTie;P8;P8f;P9' NSC=0 PAR=14   # 64 min
node research/runtasks.mjs research/dist/p8exp.cjs s24b "" SEASON=research/data/season2024.json POLS=P9b NSC=0 PAR=14   # 61 min
node research/runtasks.mjs research/dist/invariants.cjs inv24 main SEASON=research/data/season2024.json POLS_REAL=P8,P9 SIMPOL=P8 NSIM=20 NMONO=2 PAR=14   # 55 min
cd research/out && python3 ../summ_s24.py s24,s24b P8:P7H_LheldTie,... && python3 ../summ_pool.py s8,s9 s24,s24b P8:P7H_LheldTie,... && python3 ../summ_inv.py inv24:P8,inv24:P9,inv24:P8:sim
```

## Engine v2 — Phase 3: one complete decision per tip-off (P10)

### Design (`lib/engine/p10.ts`; tests `tests/p10.test.ts`)
**One decision per moment.** P8 already decides everything at a tip-off in one assignment: tonight's starts and their
slots, and for every held score keep (hold) / lock (which slot) / let go, including the lock-or-play-or-let-go of a held
player whose own game tips now. Deadlines coincide with tip-offs, and a lock that is not forced can always wait until
the next tip-off, so these moments are the only ones that matter. P10 searches over **complete joint decisions** at each
of them. There is no separate lock rollout and no separate start/sit search. Holding is one of the evaluated actions,
not a fallback.

**Candidates** (`candidates`). Each comes from the P8 context, i.e. every candidate player's priced advantage for every
action (`Cand.wa`: start / lock / hold per slot, before P8's filters). Each candidate is re-solved as one exact
assignment, so the rest of the lineup adapts:
- P8's own decision (the incumbent);
- seat or unseat each player. Unseating a held score means letting it go; seating a let-go score means holding it and
  sitting someone else;
- every other action of each held score: hold ↔ lock, and at his deadline lock ↔ play the new game;
- lock in each other eligible slot type;
- local swaps: a seated player gives up his place to an unseated one who is eligible for his slot.

Then:
- **Margin and repair.** Alternatives more than 15 priced points below the incumbent are dropped. Each remaining one is
  **repaired** against weakly dominated actions:
  - a held score let go while an eligible slot stays free is kept (holding is never worse than letting go now: he can
    be let go at the next tip-off);
  - a tipping player sat while an eligible slot stays idle for his whole game (no later tip-off can use it) is started.
- **Reachability and legality.** Each candidate is made **reachable** by legal Sleeper moves (`reachable`, rule 9) and
  checked by `decisionProblem`:
  - starts only for tonight's players;
  - locks and holds only for held scores, and no holding through one's own tip-off;
  - free, eligible slots, each used once;
  - the held players' rearrangement reachable from where they sit (BFS of `moves.ts`).
- **Selection.** Candidates are de-duplicated, and the best 8 by priced score are raced.

**Racing** (`race`, common random numbers, adaptive):
- **Rounds:** 16 scenarios per round. Every surviving candidate is scored on the same scenarios by playing the rest of
  the week with the base policy.
- **Elimination:** from 32 scenarios on, a challenger is dropped when mean(it − leader) + 2 se < 0. The incumbent is
  never dropped.
- **Stopping:** the race stops when
  - no remaining challenger can still beat the incumbent by 0.5 pt (mean + 2 se < 0.5), or
  - a single challenger is left and is significantly better, or
  - 256 scenarios are reached.
- **Switching:** P8's decision is replaced only by a challenger that beats it by > 0.5 pt **and** > 2 se. This guards
  against the winner's curse that hurt P9b at fixed K = 50.
- **Base for the continuations:**
  - **P10:** P8f (prices re-solved after new results, 30 iterations).
  - **P10b:** P8 (prices re-solved at every tip-off, 100 iterations).
  - Both run on their own price state, seeded from the real decision's prices.
- **Choice of base:** it was decided by measurement, with this rule fixed before the results: P10b if it beats P10 by
  ≥ 0.5 pts/wk on the 2025-26 real season, else the 4–5× cheaper P10.
- **Parameters:** chosen before the season runs from a 4-team-week cost check (`p10cost`). At minGain 0.25 half the
  races ran to kMax on practical ties, so minGain was raised to 0.5, the clear-gain threshold of P7H and P9.

**Tests** (`tests/p10.test.ts`, 7 tests; `npm test` 55/55):
- **racing:** picks a clearly better challenger, drops clearly worse ones early, keeps the incumbent on ties, and stops
  at kMin when nobody can win;
- **`decisionProblem`:** catches starts of non-tipping players, ineligible slots, a slot used twice, locked or in-game
  slots, holds of non-held players, holding through one's own tip-off, and the unreachable 3-cycle (reachable once a
  spare slot exists);
- **repair:** keeps a let-go held score when a slot stays free, and starts a player sat into an idle slot;
- **random weeks:** on 6 random 9-slot weeks, **every raced candidate** at every tip-off is legal and reachable; P10
  passes the checker with 0 L_ violations, 0 unforced let-gos, 0 ex-ante idle benchings and 0 F_yield_idle, and the
  recount equals the engine total;
- **pathological cases of the old policies:**
  - "keep holding a good score and sit tonight's weak player": hold, let go + start, and lock are all candidates, and
    P10 holds;
  - deadline lock-or-play together with tonight's starts, in one search;
  - "let go at his own tip-off, then sat" never appears while his slot would stay idle.

### Season backtest 2025-26 (real outcomes, 230 team-weeks, paired, same seeds; `research/p10run.ts`, prefix `s10`)
Baselines are the Phase-2 runs (`s8`, `s9`) on the same team-weeks and seeds. Every policy is deterministic given the
seed, and `p10run` reproduces the P8 totals exactly.

Each run goes through the invariant checker. The week-clustered CI is `research/summ_s24.py … ../data/season.json`.
Win% is against the real (human) opponent (`research/summ_season.py`).

| policy | pts/wk | vs | paired diff | 95% CI naive | 95% CI week-clustered | weeks 1–11 / 12–23 | better/worse weeks | win% vs real opp. (baseline) |
|---|---|---|---|---|---|---|---|---|
| P10 (P8f continuations) | 285.4 | P8 284.4 | +0.98 | ± 1.40 | ± 1.07 | +0.82 / +1.13 | 81/59 | 66.8% (66.8%) |
| **P10b** (P8 continuations) | **286.2** | P8 284.4 | **+1.83** | ± 1.40 | ± 1.70 | +0.98 / +2.62 | 70/41 | 68.2% (66.8%) |
| P10b | 286.2 | P10 285.4 | +0.85 | ± 1.37 | ± 1.44 | +0.15 / +1.49 | 60/55 | |
| P10 | 285.4 | P9 284.9 | +0.46 | ± 1.52 | ± 1.47 | +1.70 / −0.68 | 84/65 | 66.8% (65.4%) |
| **P10b** | 286.2 | P9 284.9 | **+1.31** | **± 1.14** | **± 1.15** | +1.85 / +0.81 | 85/47 | 68.2% (65.4%) |
| P10 | 285.4 | live P7H_LheldTie 284.4 | +0.96 | ± 2.22 | ± 1.84 | +0.98 / +0.95 | 113/93 | 66.8% (67.8%) |
| **P10b** | 286.2 | live P7H_LheldTie 284.4 | **+1.81** | ± 2.21 | ± 1.79 | +1.13 / +2.44 | 115/95 | 68.2% (67.8%) |

**Base chosen by the pre-set rule:** P10b − P10 = +0.85 ≥ 0.5, so **P10b** (continuations played by P8) is the Phase-3
engine. P10, the cheap variant, was run and reported alongside it everywhere.

### Season backtest 2024-25 (690 team-weeks, 3 synthetic leagues, real outcomes; prefixes `s24p10`, `s24p10b`; `research/summ_s24.py`)
Win% is against the opponent's score under the live bot (P7H_LheldTie), as in the second-season section.

| policy | pts/wk | vs | paired diff | 95% CI naive | **95% CI week-clustered** | league A / B / C | weeks 1–11 / 12–23 | better/worse | win% vs live-bot opp. (baseline) |
|---|---|---|---|---|---|---|---|---|---|
| **P10b** | **286.5** | P8 284.2 | **+2.33** | ± 0.81 | **± 0.65** | +1.2 / +3.4 / +2.4 | +1.94 / +2.68 | 225/137 | 53.1% (50.3%) |
| P10b | 286.5 | P10 286.2 | +0.31 | ± 0.83 | ± 0.73 | −0.7 / +1.0 / +0.6 | +0.14 / +0.46 | 192/170 | 53.1% (51.0%) |
| **P10b** | 286.5 | P9 285.1 | **+1.38** | ± 0.88 | **± 0.89** | +0.5 / +2.2 / +1.4 | +1.52 / +1.24 | 231/173 | 53.1% (52.0%) |
| **P10b** | 286.5 | live P7H_LheldTie 283.2 | **+3.30** | ± 1.30 | **± 2.21** | +3.4 / +4.3 / +2.2 | +2.15 / +4.36 | 365/248 | 53.1% (50.0%) |
| **P10** | 286.2 | P8 284.2 | **+2.02** | ± 0.93 | **± 0.80** | +1.9 / +2.4 / +1.8 | +1.80 / +2.22 | 242/176 | 51.0% (50.3%) |
| P10 | 286.2 | P9 285.1 | +1.07 | ± 0.94 | ± 1.08 | +1.3 / +1.1 / +0.8 | +1.38 / +0.78 | 241/209 | 51.0% (52.0%) |
| **P10** | 286.2 | live P7H_LheldTie 283.2 | **+2.99** | ± 1.26 | **± 1.94** | +4.1 / +3.3 / +1.6 | +2.00 / +3.90 | 359/251 | 51.0% (50.0%) |
| P10 | 286.2 | P8f 282.4 | +3.85 | ± 1.11 | ± 1.08 | +4.9 / +3.4 / +3.3 | +3.63 / +4.05 | 321/199 | 51.0% (48.7%) |

### Both seasons pooled (`research/summ_pool.py`; week-clustered 95% CIs, inverse-variance pooled)
| comparison | 2025-26 (real league, 230) | 2024-25 (synthetic, 690) | pooled |
|---|---|---|---|
| **P10b − live P7H_LheldTie** | +1.81 ± 1.79 | +3.30 ± 2.21 | **+2.40 ± 1.39** |
| **P10b − P8** | +1.83 ± 1.70 | +2.33 ± 0.65 | **+2.27 ± 0.60** |
| **P10b − P9** | +1.31 ± 1.15 | +1.38 ± 0.89 | **+1.35 ± 0.70** |
| P10b − P10 | +0.85 ± 1.44 | +0.31 ± 0.73 | +0.42 ± 0.65 |
| **P10 − live P7H_LheldTie** | +0.96 ± 1.84 | +2.99 ± 1.94 | **+1.93 ± 1.34** |
| **P10 − P8** | +0.98 ± 1.07 | +2.02 ± 0.80 | **+1.65 ± 0.64** |
| P10 − P9 | +0.46 ± 1.47 | +1.07 ± 1.08 | +0.85 ± 0.87 |
(For reference, Phase 2: P9 − P8 pooled +0.83 ± 0.87, P8 − live +0.52 ± 1.56.)

### Model study (46 team-weeks × the Phase-2 scenarios; `gap10` / `gap10b`; `research/summ_gap10.py`)
These are the same team-weeks and model scenarios (the `gap.ts` seeds) as the Phase-2 comparison against live: `gap4` has
P8 and P9, `gap5` has P7H_LheldTie and P2LAH_LheldTie. The P8 totals of the new runs equal `gap4`'s, so the scenarios are
identical. CIs are clustered by team-week.

**10 scenarios per team-week** (P10b not included):

| policy | model E | gap to the Lagrangian bound (300.4) | vs P8 | vs P9 | vs live P7H_LheldTie |
|---|---|---|---|---|---|
| **P10** | **289.8** | **10.6** | +0.69 ± 1.02 | **+1.42 ± 1.00** | **+2.80 ± 1.43** |
| P8 | 289.2 | 11.3 | 0 | +0.73 ± 0.95 | +2.11 ± 1.35 |
| P9 | 288.4 | 12.0 | −0.73 ± 0.95 | 0 | +1.38 ± 1.37 |
| live P7H_LheldTie | 287.0 | 13.4 | −2.11 ± 1.35 | −1.38 ± 1.37 | 0 |
| P2LAH_LheldTie | 281.3 | 19.2 | −7.90 ± 1.76 | −7.17 ± 1.62 | −5.79 ± 1.37 |

**5 scenarios per team-week, with P10b** (the first 5 of the same 10 scenarios, so all policies are paired; 230 model
weeks per policy):

| policy | model E | gap to the Lagrangian bound (300.5) | vs P8 | vs P9 | vs live P7H_LheldTie |
|---|---|---|---|---|---|
| **P10b** | **292.1** | **8.4** | **+1.60 ± 1.41** | **+3.43 ± 1.52** | **+3.45 ± 2.13** |
| P10 | 290.5 | 9.9 | +0.05 ± 1.38 | +1.88 ± 1.69 | +1.89 ± 1.97 |
| P8 | 290.5 | 10.0 | 0 | +1.83 ± 1.46 | +1.85 ± 2.18 |
| P9 | 288.6 | 11.8 | −1.83 ± 1.46 | 0 | +0.01 ± 2.07 |
| live P7H_LheldTie | 288.6 | 11.8 | −1.85 ± 2.18 | −0.01 ± 2.07 | 0 |
| P2LAH_LheldTie | 281.5 | 18.9 | −8.98 ± 2.28 | −7.15 ± 2.30 | −7.14 ± 2.05 |

P10b − P10 on these 230 model weeks: **+1.55 ± 1.36**.

- **Under the model**, P10b is the best policy so far: it closes 1.6 of P8's 10.0 remaining points to the bound (8.4
  left), and its edge over P8, P9 and live is significant on 5 scenarios per team-week.
- P10 is the best on the 10-scenario set (+0.69 vs P8). On the 5-scenario subset it ties P8 (+0.05). Either way its
  rollouts do not make P8 worse, unlike P9 (−0.73 / −1.83 vs P8).
- **P8 continuations matter.** P10b − P10 is +1.55 ± 1.36 under the model, which is significant. On the real seasons it
  is +0.42 ± 0.65 pooled. This supports the base choice that the pre-set rule made on 2025-26.
- **Checker on these model weeks:** 0 L_ violations, 0 unforced let-gos and 0 idle benchings, for both P10 (460 weeks)
  and P10b (230 weeks). F_deadline_benched is 0.45 / 0.40 per week and S_lock_wider is 0.04 per week for both.

### Rules and sanity (checker on every real team-week; model weeks from the gap runs)
| check | P10b real 2025-26 (230) | P10b real 2024-25 (690) | P10 real 2025-26 (230) | P10 real 2024-25 (690) | P10 model (460 wk) | P8 real 2024-25 | P9 real 2024-25 |
|---|---|---|---|---|---|---|---|
| **L_* rule violations** (incl. unreachable rearrangements) | **0** | **0** | **0** | **0** | **0** | 0 | 0 |
| recount ≠ engine total | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| S_forfeit_unforced (held score > 0 let go though it could stay) | **0** | **0** | **0** | **0** | **0** | 0 | 0.17/wk (3.6 pts/wk) |
| S_idle_bench_exante | **0** | **0** | **0** | **0** | **0** | 0 | 0.02/wk |
| F_yield_idle | 0 | 0 | 0 | 0 | 0 | 0 | 0.19/wk |
| S_lock_wider | 0.05/wk | 0.06/wk | 0.06/wk | 0.08/wk | 0.04/wk | 0.07/wk | 0.09/wk |
| F_deadline_benched (let go at own tip-off, then sat) | 0.54/wk | 0.54/wk | 0.53/wk | 0.53/wk | 0.45/wk | 0.57/wk | 0.65/wk |
| F_deadline_replaced | 3.06/wk | 3.63/wk | 3.24/wk | 3.59/wk | 3.01/wk | 3.76/wk | 3.82/wk |
| I_lock_final_game | 0.16/wk | 0.17/wk | 0.30/wk | 0.21/wk | | 0 | 0 |
| I_start_override (race replaced P8's decision) | 2.30/wk | 2.28/wk | 3.22/wk | 3.17/wk | | — | 1.70/wk |

- **Clean on every rule.** P10 / P10b obey every rule on all 920 real team-weeks per policy, with 0 unreachable
  rearrangements. They make **no dominated choice**: no unforced let-go and no idle benching.
  - This fixes P9's 0.17 unforced let-gos per week. The repair step and the significance-gated switch make sure the
    rollouts never bring them back.
- **Final-game locks.** I_lock_final_game (0.16–0.30/wk) is new compared to P8. A lock of a final-game score is worth the
  same as holding it, except that it can no longer move or be given up.
  - The race picks it when the continuation shows that a later tip-off would otherwise give that held score up to seat
    someone (P8's own later choice).
  - It is a legal commitment, not a violation.

### What the race changes (per real week; `research/summ_p10.py`)
| policy | season | tip-off decisions | raced (≥ 2 candidates) | candidates per race | scenarios per race: mean (p50, p90) | stopped before kMax | continuations per race | decisions changed (kind) |
|---|---|---|---|---|---|---|---|---|
| P10 | 2025-26 | 25.9 | 25.0 | 6.7 | 157 (176, 256) | 56% | 858 | 3.22 (lock 2.70, unseat 0.28, seat 0.20, play 0.03) |
| P10b | 2025-26 | 26.0 | 25.2 | 6.8 | 166 (240, 256) | 51% | 916 | 2.30 (lock 1.82, unseat 0.31, seat 0.15) |
| P10 | 2024-25 | 24.3 | 23.4 | 6.6 | 156 (176, 256) | 57% | 833 | 3.17 (lock 2.58, unseat 0.35, seat 0.21, play 0.02) |
| P10b | 2024-25 | 24.5 | 23.6 | 6.7 | 166 (224, 256) | 52% | 895 | 2.28 (lock 1.84, unseat 0.29, seat 0.12) |

- **Mostly earlier locks.** About 80% of the changes lock a held score that P8 would keep holding. P8 holds too long:
  its prices value the option to wait more than the continuations do. The rest seat or unseat one player (hold-vs-start
  trades, and let-go-to-free-a-slot).
- **Why P8 continuations score better.** With P8 continuations (P10b) the race changes fewer decisions (2.3 vs 3.2 per
  week) and gains more. A weaker base (P8f) makes more of P8's decisions look improvable than they are, which matches
  the Phase-2 reading of P9.
- **Racing saves about 35% of the work.** A fixed K = 256 for every candidate would cost 6.7 × 256 = 1,715 continuations
  per race; racing uses 830–920.
  - About half the races stop early, mostly because no challenger can still beat P8's decision by 0.5 pt.
  - The other half run to kMax: their challengers are practically tied with the incumbent, so the switch rule then keeps
    P8's decision.

### Compute per decision (single process, measured while 14 jobs ran on 14 cores, so ~1.5–2× slower than an idle machine)
| policy | ms per tip-off decision (raced ones) | decision time per real week | Phase-2 references (single process, idle) |
|---|---|---|---|
| P8 | ~1.4 | 0.05 s | |
| P9 | | | ≈ 2.2 s per decision, 67 s per week |
| **P10** | 2,710 (2,807) / 2,287 (2,376) [2025-26 / 2024-25] | 70 s / 56 s | live P7H_LheldTie ≈ 0.4 s per decision, 12.9 s per week |
| **P10b** | 13,228 (13,629) / 11,745 (12,178) | 344 s / 287 s | |

- **Decision cost.** P10 costs about the same as P9 per decision. P10b costs about 5×: 12–13 s per tip-off under load,
  i.e. about 5–8 s on an idle machine.
- **In the live app**, a real decision is one tip-off, which is affordable for either. The plan view replays all of the
  week's remaining tip-offs, so with `p10b` it costs a few minutes per refresh (p9's advise view was 166 s).

### Live engine option
- **Selection:** `lib/live/engine.ts` now accepts `p10` and `p10b`, set by `LOCKIN_ENGINE` or `"engine"` in config.json.
  - Decisions: P8 plus the P10 race in the plan and replay hooks; continuations by P8f or P8 on their own price state.
  - Mass simulations: P8f, as for p8 and p9.
- **Default unchanged:** p7h, with byte-identical fingerprints (`tests/engine_select.test.ts`).
- **Not switched:** the live app was not touched or restarted.

### Reading and recommendation
- **The gate is met.** P10b is the first engine whose paired season result beats the live P7H_LheldTie with a CI that
  excludes 0:
  - pooled over both seasons: **+2.40 ± 1.39** pts/wk;
  - per season, week-clustered: 2025-26 +1.81 ± 1.79, 2024-25 +3.30 ± 2.21;
  - it is ahead in both halves of both seasons and in all 3 synthetic leagues.
  - The 2025-26 result alone is borderline: its naive CI is ± 2.21.
  - P10b also beats P8 (+2.27 ± 0.60) and P9 (+1.35 ± 0.70) pooled, with no rule violations and no dominated actions.
  - Under the model (46 team-weeks × 5 scenarios) it is +3.45 ± 2.13 vs live and +1.60 ± 1.41 vs P8, the smallest gap
    to the Lagrangian bound so far (8.4 pts).
- **Pre-registration.** No P10 parameter was tuned on season outcomes.
  - Racing settings were fixed before any season run, from a 4-team-week cost check.
  - The base was chosen by a rule fixed before the 2025-26 results.
  - The 2024-25 season is therefore an out-of-sample test. There it beat live by +3.30 and P8 by +2.33, more than on
    2025-26.
- **P10b vs P10 is not settled on real outcomes:** +0.42 ± 0.65 pooled.
  - The rule picked P10b on 2025-26 (+0.85); 2024-25 agrees in direction (+0.31) but not significantly.
  - Under the model, P10b − P10 is +1.55 ± 1.36, which is significant.
  - P10 also beats live pooled (+1.93 ± 1.34) at ~1/5 of P10b's decision cost.
- **Recommendation.**
  - Make **`p10b`** the live engine if a few seconds per decision and minutes per plan refresh are acceptable.
  - Otherwise use **`p10`**: same rules record, about 0.4 pt/wk less, compute like p9.
  - Either is a one-line config change (`"engine": "p10b"`) and reverts the same way. Switching is the user's decision:
    it was not done here.
- **Follow-ups:**
  - Speed. Most of the time goes to continuations of near-tied candidates; a tie-aware stopping rule or cheaper
    continuations (task C's profiling) would cut P10b's cost.
  - Phase 4 contingency tables could precompute P10b's decisions before tip-off.
  - The model expectation runs ~5–7 pts above real outcomes, so the model gaps above are optimistic in level, not in
    ranking.

### Reproduce
```
npx esbuild research/p10run.ts --bundle --platform=node --format=cjs --outfile=research/dist/p10run.cjs --log-level=error   # (+ gap.ts)
node research/runtasks.mjs research/dist/p10run.cjs s10 "" 'POLS=P10;P10b' PAR=14                                    # 2025-26, 2.0 h
node research/runtasks.mjs research/dist/p10run.cjs s24p10 "" SEASON=research/data/season2024.json POLS=P10 PAR=14   # 51 min
node research/runtasks.mjs research/dist/p10run.cjs s24p10b "" SEASON=research/data/season2024.json POLS=P10b PAR=14 # 4.1 h
node research/runtasks.mjs research/dist/gap.cjs gap10 "" TASKS=<the 46 gap4 team-weeks> GAPPOLS=P8 N=10 N7=10 GAP7=P10 ITERS=2000 PAR=14   # 43 min
node research/runtasks.mjs research/dist/gap.cjs gap10b "" TASKS=<same> GAPPOLS=P8 N=10 N7=5 GAP7=P10b ITERS=2000 PAR=14
cd research/out && python3 ../summ_season.py s8,s9,s10 P10b:P7H_LheldTie,... && python3 ../summ_s24.py s24,s24p10,s24p10b P10b:P8,...
python3 ../summ_pool.py s8,s9,s10 s24,s24p10,s24p10b P10b:P7H_LheldTie,... && python3 ../summ_p10.py s10 P10,P10b
python3 ../summ_inv.py s10:P10b,s24p10b:P10b,... && python3 ../summ_gap10.py
```
(The driver scripts used for this run are in `research/scratch/p10/pipeline*.mjs`. Bug fixed along the way:
`research/invariants.ts` ran its own CLI inside any bundle that imported it, e.g. `gap.cjs`. That wasted time but did
not change results, because each script writes its output last.)

## Engine speed: profiling, bit-identical optimisations, native-port decision (overnight 2026-10-15, task C)

### 1. Where the time goes (`node --cpu-prof`, `research/perfprof.ts`, `research/profsum.py`)
Profiles of representative runs on the baseline engine (commit 99f1a40), team-week w5 r1:

| run | top hot spots (inclusive share) |
|---|---|
| P7H_LheldTie, real week (14.8 s) | `evalLock` 76% → `assignExact` 62% (Kuhn matcher: `filter`+`sort`+closure+`Map` per call, `slotOrder` built a string key per call), `heldSeatable` 13% (a `Float64Array` + full matching per call), `lockAwarePlacement` 30% (a `cloneState` per starter), GC 8% |
| P8, real week + 20 model weeks | Lagrangian solver 89%: `tables` 48% self, `minimizeBound` 23% self (two `Math.pow` per coordinate per Adam step: 55% of its lines), `evaluate` 14%, GC 10% (tuple returns in `intervalMin`, closures per player, `mu.slice()` + object spread on every improvement) |
| P8f, 300 model weeks | the same solver, 85% (warm re-solves after results) |
| P10b, first 2 days of a real week | `decideIndex` race 87% → continuations' warm re-solves 82% (same profile as P8) |

So two kernels dominate everything: the **slot assignment** (rule family: P2LAH, P7H, the app's mass simulations) and the
**Lagrangian bound evaluation** (P8 family: P8, P8f, P9, P10, P10b).

### Optimisations (all results bit-identical; `lib/engine/core.ts`, `lagrange.ts`, `p8.ts`, `p10.ts`)
- **Assignment.** `assignExact` keeps Kuhn's algorithm (its slot map decides placements) without allocation: module
  workspace, stable insertion sort, no closure, `slotOrder` cached by array identity (guarded against in-place edits).
  Callers that need only the total (`evalLock`, 5–7 matchings per call) or feasibility (`heldSeatable`) use an exact
  **Hall-condition counter** over the 5 position bits: a player set is matchable iff for every bit set u,
  #{players with mask ⊆ u} ≤ #{open slots intersecting u}. Kuhn's greedy accepts p iff accepted ∪ {p} is matchable,
  so the counter accepts the same players and sums the same weights in the same order (exact early exit when all slots
  are used). Falls back to Kuhn for > 12 slots or masks outside 0..31.
- **evalLock / placement.** No per-call arrays or Sets; the held list for the strand check is built once per call;
  `lockAwarePlacement` evaluates on the state itself (changes restored) instead of cloning it per starter; the reserve
  loop lost an O(n²) `games.indexOf`.
- **stopValue memo** per team-week, (player, game index, played-last) → value, validated by the identity of everything
  it reads (`games`, `byPlayer`, `dnp`, `pNext`, `nextGameIdx`, `resid`); legacy flags bypass it.
- **emax**: one `Math.exp` instead of two (exp(−z²/2) and exp(−0.5z²) are the same double).
- **Solver**: no tuple/closure allocation, typed eligibility lists, slot-outer pointwise minimum (same first-minimum
  tie-break), Adam bias corrections hoisted out of the coordinate loop, best point copied into preallocated arrays,
  the "bound at μ = 0" of warm starts computed lazily.
- **Re-solve memo** (`p8.ts`): a warm re-solve is a pure function of (starting prices, the state `fromState` reads, t,
  iterations, rate); continuations that reach the same state at the same tip-off (every scenario of one candidate
  before any game ends) share it. LRU of 1000 views per team-week; off for P8f's "after new results" schedule, where
  states hardly repeat (it cost ~5% there).
- **Rollouts** (P7H lock/start simulations, P10 race) reuse one scratch state instead of `cloneState` per continuation.

### Verification: bit-identical totals
- **Season backtest, 230 team-weeks** (`research/perfcheck.ts`, `research/perfcmp.py`): P8, P7H_LheldTie, P8f and
  P2LAH_LheldTie, each on the real outcomes plus 2 model scenarios (seeds of `p8exp`), baseline bundle vs optimised:
  **0 differences in 2,760 totals** (and lock counts), with and without the re-solve memo (`pcbase` / `pcnew`, `pcnew2`).
- **P10 and P10b**, real weeks on 14 team-weeks spread over the season (`pc10base` / `pc10new`): **0 differences**.
- **Final engine** (re-solve memo + the price-view guard below): `pcnew3` (season, 2,760 totals) and `pc10new3`
  (P10 / P10b, 14 team-weeks): **0 differences**.
- **Unit tests** 59/59 (`npm test`), including `tests/perf.test.ts`: 3,000 random matchings (ties, zero/negative weights,
  partial open masks, random layouts and masks) against the original matcher — totals and slot maps equal; slotOrder
  after an in-place edit; memo invalidation; `emax` equal bit for bit on 20,000 random inputs.

### Speedups (idle machine, one process at a time; `research/perftimes.mjs` → `research/out/perftimes2.json`; w5 r1 unless noted)
| run | baseline | optimised | speedup |
|---|---|---|---|
| P7H_LheldTie, real week (w5 r1 / w14 r4) | 14.8 s / 13.4 s | 2.85 s / 2.92 s | **5.2× / 4.6×** |
| P2LAH_LheldTie, model week (the rule; app projections, P7H rollouts) | 1.32 ms | 0.36 ms | **3.7×** |
| P8, real week incl. the week-start price solve | 4.14 s | 3.29 s | 1.26× |
| P8, model week after the price solve | 31.9 ms | 21.9 ms | **1.46×** |
| P8f, model week after the price solve | 5.33 ms | 4.34 ms | 1.23× |
| P10, first day of a real week | 12.3 s | 9.96 s | 1.24× |
| P10b, first day of a real week | 39.9 s | 27.6 s | **1.45×** |
| bound evaluation (solver kernel), µs, 4 team-weeks | 16.5–20.8 | 13.1–16.6 | 1.26× |

Under the 13-way parallel load of the season runs the ratios were similar (P7H 4.4×, P2LAH 2.2–2.7×, P8 1.3–1.4×).
The rule family (live P7H decisions, every mass simulation of the app under p7h) is now ~4–5× cheaper. The P8 family is
bound by the solver's arithmetic: what is left per evaluation is the required floating-point work (≈ 130 `exp` for the
games' E[max] and P(X > t), a div + sqrt per coordinate in Adam, the min/prefix loops), with no allocation and < 3% GC.

### 2. Would a Rust (napi / wasm) port pay? Measured: **no**
The kernel worth porting is the bound evaluation (80–90% of P8/P8f/P10/P10b time; the rule family is now cheap).
- **wasm, measured.** `research/kernel/boundasm.js` is an asm.js port of `tables` + `evaluate` (week-start instance) +
  the Adam loop, line for line. V8 validates it ("use asm" → `%IsAsmWasmCode` = true) and compiles it with its
  WebAssembly pipeline (TurboFan for wasm) — what a hand-written or Rust-generated wasm module gets, minus LLVM's own
  optimisations. Same `Math.exp`/`pow`, so it is checked bit for bit: **the bound after 20,000 Adam iterations is
  identical** to the TS solver on all 4 instances.

  | instance | TS baseline µs/eval | **TS optimised** | **asm.js → wasm** | wasm, accessors not inlined |
  |---|---|---|---|---|
  | w5 r1 (B = 54) | 20.8 | **16.6** | **16.7** | 42.1 |
  | w9 r3 (B = 43) | 16.5 | **13.1** | **13.2** | 34.2 |
  | w14 r4 (B = 53) | 19.7 | **15.5** | **15.8** | 42.1 |
  | w20 r5 (B = 51) | 19.9 | **15.6** | **16.1** | 40.5 |

  wasm runs at **0.97–1.0× the speed of the optimised TS**: for scalar float loops over typed arrays V8's JS and wasm
  back ends produce equivalent code. (Without manual inlining of the heap accessors wasm is 2.6× slower: V8 did not
  inline small asm.js functions.)
- **native (napi), not measurable tonight.** No Rust toolchain is installed, and compiling the ready C port
  (`research/kernel/bound.c`, the same kernel; Rust would compile to the same LLVM IR modulo bounds checks) needs a
  compiler call that this unattended session may not run (clang / cc / swiftc / cffi all go through an approval gate;
  not circumvented). To measure it in a minute:
  `clang -O3 -o research/kernel/bound research/kernel/bound.c -lm && research/kernel/bound research/kernel/inst_5_1.txt 20000`
  vs `node research/dist/perfbench_new.cjs adam 5:1 20000` (instances: `node research/dist/perfbench_new.cjs export 5:1 research/kernel/inst_5_1.txt`).
  Expected from the kernel's shape (scalar, branchy, `exp`-heavy, B ≈ 50): LLVM -O3 maybe 1.5–2.5× over V8
  (auto-vectorised min and Adam loops, cheaper libm `exp`), i.e. ~1.4–1.9× on P10b end to end (Amdahl, 85% solver).
- **Recommendation: do not port.**
  1. wasm, the portable option (browser, worker threads, no per-platform builds), gives nothing — measured.
  2. A native addon would at best give ~1.5–2× on the P8 family, at the price of per-platform native builds for the
     Next.js server and worker threads, two implementations of the solver to keep in sync, and **loss of
     reproducibility**: a native `exp`/`pow` differs from V8's in the last bits, so TS backtests would no longer
     reproduce the app's decisions exactly (they do today: the wasm port matches bit for bit only because it calls V8's
     own `Math.exp`).
  3. Bigger levers exist without leaving TS: P10b's race is embarrassingly parallel (scenarios × candidates), and the
     app already has a 12-worker pool — racing on workers would cut a decision ~8–10×, far more than a port; fewer
     solver iterations (warm starts are good: early stopping on a stalled bound) is algorithmic and needs a backtest.

### Reproduce
```
npx esbuild research/perfcheck.ts --bundle --platform=node --format=cjs --outfile=research/dist/perfcheck_new.cjs --log-level=error
# baseline bundle: the same driver built against `git show 99f1a40:<engine files>` (research/scratch/base/, not committed)
node research/runtasks.mjs research/dist/perfcheck_base.cjs pcbase "" "POLS=P8;P7H_LheldTie;P8f;P2LAH_LheldTie" NSC=2 PAR=13
node research/runtasks.mjs research/dist/perfcheck_new.cjs pcnew2 "" "POLS=P8;P7H_LheldTie;P8f;P2LAH_LheldTie" NSC=2 PAR=13
node research/runtasks.mjs research/dist/perfcheck_{base,new}.cjs pc10{base,new} "" "POLS=P10;P10b" NSC=0 PAR=14 TASKS=2:1,4:2,5:3,6:4,8:5,10:6,12:7,13:8,14:9,16:10,18:1,20:2,21:3,22:4
cd research/out && python3 ../perfcmp.py pcbase pcnew2 && python3 ../perfcmp.py pc10base pc10new
node research/perftimes.mjs research/out/perftimes2.json      # idle machine, sequential (perfbench/perfprof base+new bundles, asm kernel)
node --cpu-prof --cpu-prof-dir=research/scratch/prof research/dist/perfprof_new.cjs 5 1 P7H_LheldTie && python3 research/profsum.py <profile> 30 [fn,fn]
```

### Engine hardening found while testing the pre-game planner (`lib/engine/p8.ts`)
`pricesAt` reused the current price view whenever it had been solved at the same time `t`. A price state seeded from
*another* simulation at the same moment (here: the planner's check seeded its prices from a slot another engine had
just used) then carried a stale slot mapping: a free slot mapped to "no slot", its price read as `undefined`, the hold
value became NaN, and `Math.max(…, NaN)` made every hold weight of that player NaN, so the assignment could not keep his
score. The view is now re-solved unless it was solved for the same locked slots. In the engine's own flows a view is
never reused at its own time from a different state, so nothing changes there: identity re-checked (season P8 / P7H /
P8f / P2LAH and P10 / P10b on 14 team-weeks: see the Phase 4 reproduce block).

## Engine v2 — Phase 4 prototype: pre-game planner (`research/pregame.ts`, overnight 2026-10-15)

### What it produces
Before tonight's first tip-off, from the league state (season replay, or `live <leagueId> <rosterId>` from the live
Sleeper/ESPN data; tested once on the live league, 2026-27 week 1):
1. **Tonight's lineup**: the decision engine (P10b) at tonight's tip-offs, up to the first moment one of tonight's games
   ends (later tip-offs that follow a finished game are decided inside the simulations).
2. **A contingency table for the morning-after decision** — the first tip-off of the next game day, when all of tonight's
   results are known and a held score competes for a slot again. Per starter, as a function of his score x tonight:
   **lock** if x ≥ lock cut-off, **keep** (hold in a starting slot, decide later) between the let-go and the lock
   cut-off, **free the slot** below the let-go cut-off; plus the same cut-offs **conditional on a key teammate's result**
   tonight (≥ or < that teammate's own lock cut-off) when conditioning moves the cut-off by ≥ 1 pt and > 2 SE.
   (The first version used the first decision after each game; when that is a later tip-off the same night, keeping is
   free and "lock" only wins for extreme scores — correct but useless to a user, so the decision moved to the morning.)
3. JSON (`research/out/pgc_<week>_<rid>.json`, value curves included) and a readable summary, e.g. (w7 r3, Wed):
```
Before Thu 7:00 PM, with tonight's results:
  Giannis Antetokounmpo [F] proj 33.8±12.5: LOCK if >= 39.4 (±9.6; P 33% if he plays); otherwise keep
  Jamal Murray [G] proj 25±11.2: LOCK if >= 30.4 (±3.2; P 31% if he plays); keep 20.4-30.4; free the slot below 20.4
      if Karl-Anthony Towns scores >= 41.8: lock if >= 55.7; otherwise lock if >= 29.9  (Δ 25.8 ± 10)
  Jalen Brunson [UTIL] proj 26±11.3: LOCK if >= 29.9 (±0.5; P 36% if he plays); keep 26.4-29.9; free the slot below 26.4
  Bennedict Mathurin [SF] proj 18.8±10.1: don't lock (not even at 46.7); keep 24.1+; free the slot below 24.1
      if Giannis Antetokounmpo scores >= 39.4: lock if >= 23.6; otherwise lock if >= 46.7  (Δ -23.1 ± 8.4)
```

### Method (deep search, common random numbers, time budget)
- Scenarios of tonight and the rest of the week are drawn from the model. For each starter, each scenario and each x on
  a grid of his score (0 and μ + σ·{−1, −½, 0, ½, 1, 1.5, 2, 2.75}), the rest of the week is played three times by the
  base policy (P8, prices re-solved at every tip-off: the continuations P10b uses) with his action at the morning-after
  decision forced to lock / keep / free; everything else (including tonight's later tip-offs) is decided by the base.
  Cut-offs = first crossing of the value curves (linear interpolation), SEs by bootstrap over scenarios.
- Rounds of 16 scenarios until `BUDGET_S` (default 1800 s of search) or `KMAX`; with 4–7 starters, 27 continuations per
  starter and scenario, 30 minutes give 430–3,900 scenarios (110k–330k continuations) per team-week-day on one core.
- Conditional cut-offs re-use the same continuations, split by the teammate's simulated result (post-stratification):
  no extra simulation.

### Test: 13 team-week-days of 2025-26 vs the real-time engines (`pg` tables, `pgc` checks; `research/summ_pregame.py`)
Cases spread over the season (weeks 3–21, mid-week days). History up to tonight played by P8 on the real results;
tonight's lineup by P10b. The real-time engines (P10b, and P8 on its own price state) then play tonight and the next
morning on the real results; for every starter still holding a score at the morning-after tip-off, the three actions are
scored **from P10b's real state just before that decision** by 300 paired model continuations each (base P8), and every
choice (table, P10b, P8) is charged its regret against the best of the three.

| | value |
|---|---|
| team-week-days / tonight's starters | 13 / 61 (one day with no starter: a noon Christmas game nobody started) |
| starters P10b still held at the morning-after decision | 41 (11 scores were already locked or let go at a later tip-off tonight; 9 n/a) |
| scenarios per plan (30 min) | 432–3,904; lock cut-off SE median 0.4–10 pts per plan |
| key-teammate conditions found | 13, in 7 of 12 plans (e.g. a teammate's lock moves a cut-off by 3–30 pts) |
| agreement: table = P10b / table = P8 / P10b = P8 | 23/41 / 21/41 / **39/41** |
| best action under the deep evaluation chosen by: table / P10b / P8 | 29/41 / 27/41 / 25/41 |
| **total regret vs the best action, 41 decisions** (95% CI): table / P10b / P8 | **1.65 ± 2.50 / 3.27 ± 3.00 / 4.31 ± 3.23 pts** |

- **Decisions as good as the real-time engine's.** The table's total regret over 41 decisions is 1.6 pts vs 3.3 for
  real-time P10b; the difference is within noise. Most disagreements (12 of 18 exactly, 14 within 0.1 pt) are between
  actions worth the same, mostly keep vs free when nobody needs the slot before the player's next game. The ones that cost something: the table locked
  high scores P10b kept (Sensabaugh 47.5, Holiday 51, Gobert 43: P10b regret 0.84 / 1.55 / 0.32) and locked Giddey's
  48.5 where keeping was 1.08 ± 0.78 better.
- **P10b's race hardly touches these decisions** (39/41 identical to P8): the morning-after lock/hold choice is mostly
  P8's priced comparison.
- **Precision is the limit.** 30 minutes on one core give cut-offs with SEs of a few points; the value curves are flat
  near the crossing, so a wrong cut-off costs little, but conditional cut-offs (split samples) are noisy (Δ ± 5–15) and
  some look implausible. Fixes: run the rounds on the app's worker threads (12× the scenarios in the same time),
  adaptive grids around the crossing, and pooled (regression) conditioning instead of post-stratification.
- **What it does not cover.** Decisions at later tip-offs tonight after a game has ended (made by the base policy
  inside the simulations, and in real time by P10b: 11 of 61 scores were resolved that way); joint conditions on more
  than one teammate; a pre-computed start/sit table for tomorrow (tomorrow's lineup is left to the real-time engine).

### Reading
The Phase 4 idea works as a prototype: before tip-off it turns tomorrow morning's lock decisions into a short table
("lock if ≥ X; if teammate Y also goes off, ≥ X′") whose choices are as good as P10b's real-time choices on the 41
decisions tested. It does not beat the real-time engine (no significant difference), so its value is product-side —
decisions become lookups available before the games, with the reasons (value curves) attached — not points. Next steps
if pursued: worker-thread parallel search, adaptive grids, and a live-app view that shows the table next to the plan's
existing single "lock if ≥" cut-offs (`simCutoff`, which is a lock-vs-let-go cut-off at the first decision after the
game and does not consider keeping).

### Reproduce
```
npx esbuild research/pregame.ts --bundle --platform=node --format=cjs --outfile=research/dist/pregame.cjs --log-level=error
T=3:2:1,4:7:2,6:5:1,7:3:2,9:9:1,10:4:2,12:1:1,13:6:2,15:8:1,16:2:2,18:10:1,20:3:2,21:7:1      # week:rid:day
node research/runtasks.mjs research/dist/pregame.cjs pg "" PAR=13 BUDGET_S=1800 KEVAL=300 TASKS=$T   # 35 min
node research/runtasks.mjs research/dist/pregame.cjs pgc "" PAR=13 KEVAL=300 TABLE=research/out/pg TASKS=$T   # check only, 4 min
cd research/out && python3 ../summ_pregame.py pgc
node research/dist/pregame.cjs live <leagueId> <rosterId> out.json BUDGET_S=1800            # live league state
# identity of the final engine (incl. the price-view guard):
node research/runtasks.mjs research/dist/perfcheck_new.cjs pcnew3 "" "POLS=P8;P7H_LheldTie;P8f;P2LAH_LheldTie" NSC=2 PAR=13
node research/runtasks.mjs research/dist/perfcheck_new.cjs pc10new3 "" "POLS=P10;P10b" NSC=0 PAR=14 TASKS=<the 14 above>
python3 ../perfcmp.py pcbase pcnew3 && python3 ../perfcmp.py pc10base pc10new3
```
(The first `pg` run's checks were wrong: the P8 comparison run shared the "top" price slot with P10b and the value
checks seeded their prices from it, which produced NaN hold values — up to 38 pts of spurious "regret" for P10b. Found
by the `forcedOk` diagnostic, fixed in the planner and hardened in `p8.ts` above; the tables themselves were unaffected
and were re-checked with `TABLE=`.)

## Engine v2 — Phase 5: playing for the win (overnight 2026-10-15, task E)
Goal: decisions that maximise the probability of beating **this week's** opponent, with a small weight on points
(points-for is the standings tiebreaker). Behind late in the week → take variance; ahead → secure points.

**Summary.**
- **Policy.** P11 = P10 with every raced continuation scored by T + β·F_opp(T). F_opp is the CDF of the opponent's
  final total, simulated as a human from what we can see of him. β = 1000, phased in over the last 3 game days, with a
  risk dial that makes the continuations' own decisions play to the score.
- **(b) Simulated weeks against human-model opponents.**
  - Fresh confirmation, 674 weeks: **+0.40 pp** win probability vs P10 (95% CI ± 0.35 naive / ± 0.46 week-clustered).
  - All 1,118 simulated weeks: **+0.53 ± 0.31** pp (week-clustered).
- **(a) Real 2025-26 season against the real opponents' actual scores.**
  - **145-68-1** vs P10's 142-70-2: +1.17 pp, 4 weeks flipped to wins and 1 to a loss.
  - The pre-registered opponent model: 144-68-2 (+0.93 pp).
- **Points and rules.** Points unchanged (−0.15 ± 0.28 simulated, +0.09 real). 0 rule violations.
- **Gate (win rate improves on both, 0 violations): met.** The gain is real but small: about half a win per 100 weeks.
  The objective is a config option (`objective: "win"`, with engine `p10` / `p10b`); the default is unchanged.

### Design (`lib/engine/p11.ts`, `lib/engine/human.ts`, `lib/live/opponent.ts`; tests `tests/p11.test.ts`)
**Objective.** At each tip-off P10 races complete decisions: P8's decision and its best alternatives, scored on common
scenarios of the rest of the week. P11 scores each continuation by

  U = T + β(t) · F_opp(T)      (U/β = P(win) + E[points]/β, i.e. w_pts = 1/β)

- T is our simulated final.
- F_opp is the CDF of the opponent's final total, given what is known of him at t.
- β is points per unit of win probability: β = 1000 means one percentage point of win probability is worth 10 points.

The race rules are P10's, in U units. P8's own decision is the incumbent and is replaced only by a candidate that is
better by > 0.5 and by > 2 se. With β = 0, or before the phase-in, **P11 is P10 exactly** (bit-identical, tested).

**Fix 1: the opponent distribution once per decision moment, not one paired opponent sample per rollout.**
- **The old method.** P4/P4S scored every rollout as win/loss against one simulated opponent week. The opponent's rest
  of the week doesn't depend on our action.
- **The new method.**
  - At each decision moment P11 simulates the opponent M = 400 times from his current state (human model below).
  - It keeps the finals and smooths their empirical CDF with a Gaussian kernel (Silverman bandwidth ≥ 1 pt, tabulated on
    a 0.25-pt grid).
  - Every continuation is scored by F_opp(T). The distribution is memoised per opponent state, since it changes only
    when his games tip off or end.
- **Variance reduction, measured.** The diagnostic `vr` used 64 extra scenarios per decision and its own random stream,
  so decisions were unchanged. It ran at 2,443 win-phase decisions of the real season (`research/summ_p11b.py vr`).
  - It compares the per-scenario variance of the paired difference between P8's decision and the first challenger.
  - That variance is **7.5× lower** with the smooth score than with win/loss against one paired opponent sample:
    0.00115 vs 0.00862. 7.4× in the second run.
  - So the same race precision needs 7.5× fewer continuations. In about half of the decisions both variances are 0
    (the week is decided).

**Fix 2: the opponent is a human (`lib/engine/human.ts`, fit and checks in `research/humanfit.ts`).** A "physical
lineup" model of how the 2025-26 managers played.
- **Bookkeeping.**
  - Slot occupants persist until the manager changes them.
  - Whoever sits in a starting slot at tip-off is started; benching a held score forfeits it.
  - At week end every unlocked occupant's held score counts. Rules 1–7 hold by construction, and the unit tests check
    the bookkeeping.
- **Behaviour.**
  - **Engagement.** e ~ Beta(engA, engB) per team-week = P(active) on each game day.
  - **Management.** An active day is managed at every tip-off, with same-day slot reuse, with probability pt; otherwise
    once before the first tip-off.
  - **Week start.** The week starts from a standing lineup with probability sl, else from empty slots.
  - **Locks.** Once per active day, each held starter with games left is locked with probability
    σ(c0 + u + c1·z + c2·d), where:
    - z = (score − his remaining games' optimal-stopping value) / sd;
    - d = share of game days past;
    - u ~ N(0, su²) per team-week.
  - **Lineup.** Exact assignment of tonight's players (weighted by start-vs-skip value) and of held scores without a game
    today (weighted by (1 − tf) × keep-vs-let-go value). A DNP is known in advance with probability kd.
- **Fit.** Method of simulated moments (Nelder-Mead, common random numbers) on the real team-weeks, each replayed on its
  **real** outcomes so that only the manager's choices are random. Moments matched:
  - mean, sd, and 10% / 90% quantiles of the weekly total (the mean weighted most);
  - the share of slots ending at 0;
  - the share of slot scores from a player's first / last game;
  - the mean z of kept scores.
- **Two fits.** The first fit used all 230 team-weeks (`HUMAN_ALL`). The real-season calibration of validation (a)
  then showed it ~16 pts low on the opponents we actually face: the 16 team-weeks without an opponent (playoff-week byes
  of eliminated teams) averaged ~83 pts and pulled it down. It was refit on the 214 team-weeks with an opponent
  (`HUMAN`, used by the live option and run a2). The simulated validation (b) used `HUMAN_ALL` throughout: there the
  opponents *are* that model, so it is internally consistent.

| moment (2025-26) | managers | `HUMAN_ALL` (all 230) | managers, 214 with an opponent | **`HUMAN`** (214) |
|---|---|---|---|---|
| mean weekly total | 232.5 | 225.4 | 241.5 | **238.8** |
| sd of weekly totals | 76.2 | 57.8 | 69.7 | 51.8 |
| 10% / 50% / 90% quantile | 121 / 249 / 325 | 155 / 233 / 288 | 138 / 256 / 326 | 176 / 244 / 298 |
| share of slots ending at 0 | 20.1% | 10.5% | 18.4% | 7.3% |
| slot scores from the player's first / last game (≥ 2 games) | 34% / 32% | 34% / 32% | 35% / 29% | 35% / 32% |
| mean z of kept scores | 0.90 | 0.66 | 0.95 | 0.71 |
| corr(simulated mean, real total) per team-week | | 0.62 | | 0.69 |

**Fitted `HUMAN`:**
- **Engagement.** Beta(1.28, 0.12): mean 0.91; 72% of team-weeks have e > 0.95 and 6% have e < 0.5.
- **Lock logit.** c0 = −3.37, c1 = 5.34, c2 = 1.72, su = 1.28. A held score is locked once it beats the value of waiting
  by about 0.6 sd at week start, 0.5 mid-week and 0.3 at the end.
- **Lineup.** tf = 0.79 (held scores mostly give way to tonight's players); pt = 1.00 (active days are managed
  tip-off by tip-off).
- **Rest.** kd = 0.005 (the fit found no use for advance DNP knowledge); sl = 0.19.

**What the model gets right and wrong.**
- **Right.** It reproduces the level, the timing of kept games and most of the shape.
- **Too consistent.** Real managers have more very bad weeks (zero slots, abandoned weeks) and more very good ones
  (kept scores 0.95 sd above the mean vs 0.71). The mechanistic model can't reach either tail; no tested mechanism did,
  including advance injury news and per-week threshold offsets.
- **Fix.** The opponent's distribution gets a calibrated residual N(δ, σ²·ρ) while games remain, with ρ = share of his
  games not yet tipped off: δ = −5, σ = 55 (`HUMAN_RESID`; −5 / 60 with `HUMAN_ALL`).
- **How it was chosen.** Grid search for uniform PITs of the real totals under the model's distribution from no-look-ahead
  snapshots (`research/oppreal.ts`), at the start of every game day.

| `calibm` (HUMAN + residual, 214 team-weeks; at the start of each of his game days) | game days left 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|
| predicted mean − actual mean | +2.8 | +2.4 | +3.4 | +2.0 | +2.5 | +0.4 | −2.1 |
| PIT quintiles (uniform = n/5 each) | 55/36/33/40/50 | 48/35/41/47/43 | 49/28/41/56/40 | 44/35/37/59/39 | 43/33/36/52/41 | 38/31/35/54/38 | 33/24/27/46/33 |
| (raw model, no residual: PIT) | 82/25/23/25/59 | 74/25/29/20/66 | 67/33/19/31/64 | 69/23/27/29/66 | 64/27/20/31/63 | 63/17/21/30/65 | 49/14/21/21/58 |

**What P11 sees of the opponent.**
- **Live** (`lib/live/opponent.ts`): his Sleeper state, i.e. locks and points, held scores in his starting slots,
  players in a game, lineup, finished games, and injury tags (play probabilities of his next games).
- **Real-season backtest.** Only what the data proves at t (`research/oppreal.ts`):
  - the final lineup's counted scores, matched to games;
  - such a score is "in a game" while its game runs, "held" until the player's next tip-off (the last moment he could
    lock it), and "locked" after;
  - everything else is unknown until week end. Scores he held and later let go are never seen: less than the live app
    sees.

**Fix 3: phase-in and a risk dial.**
- **Phase-in schedules.** `late` = β in the last 3 game days of our week (chosen); `ramp` = linear over the game days;
  `const` = all week.
- **Risk dial.** The continuations are played by P8f, which maximises points. With the dial, their own future decisions
  play to the score:
  - **Tilt.** Every game's mean in the priced DPs is shifted by γ·sd², the certainty equivalent under a locally
    exponential utility (`lagrange.gameDist` tilt, `IndexOpts.tilt`). A view with another tilt forces a warm-started
    price re-solve.
  - **γ formula.** γ = ½·E[U″]/E[U′] at our projected final T ~ N(μ, sd²), from 32 pilot continuations of P8's
    decision against the opponent samples O_i. With z = (μ − O_i)/s and s² = sd² + h²:
    - E[F′] = mean φ(z)/s;
    - E[F″] = mean −zφ(z)/s².
  - **Sign.** γ > 0 when behind (holding for ceilings, higher lock cut-offs and volatile starters look better). γ < 0
    when ahead. γ → 0 when the week is decided either way: then points (the tiebreaker) decide.
  - **Limits.** |γ| ≤ 0.05/pt. |γ| < 0.001 → 0, so decided weeks play as P10.
  - **Candidate.** P8's decision under the tilt joins the race.

### Validation design
- **Base engine.** P11 is built on P10 (continuations by P8f): it costs 1/5 of P10b and was within 0.4 ± 0.65 pts/wk of
  it in Phase 3. `P11b` (on P10b) exists, and the live option works with either engine.
- **Pairing and population.** Every comparison is paired with P10, with the same seeds. The population is team-weeks
  with an opponent: 214 of 230 in 2025-26 and all 690 in 2024-25.
- **(b) Simulated weeks** (`research/p11run.ts` sim). Our games and the opponent's are drawn from the walk-forward
  model; the human model plays the opponent with traits drawn per week; P11 sees his exact state, as the live app does.
  Win-rate differences under 1 pp need variance reduction, all of it unbiased:
  - **Shared prefix.** All arms are identical before the phase-in, so the week is played once up to the first tip-off of
    the third-last game day. Each arm continues from that state with the same random streams and prices. Spot checks
    against from-scratch runs through the invariant checker matched exactly (3 arms in development, then 44 runs, see the
    rules section).
  - **More completions for open weeks.** If P10's win probability at the branch is in (0.02, 0.98), the rest of the
    week is redrawn 6 times: ours and his, his decisions included, his traits kept. Every arm plays each redraw. The
    choice uses only information at the branch, so each week's mean over its completions is unbiased.
  - **Rao-Blackwellized (RB) win.** P(his final < ours | his state at our last tip-off, his true traits), from 400
    simulations of his remaining games. It has the same expectation as the 0/1 result and less noise; binary win/loss is
    reported too.
- **Tuning set and pre-registered choice.** The tuning set is 2025-26 (214 team-weeks, model week j = 0) plus 2024-25
  league A (rids 1–10, 230). The rule, fixed before the results: the largest RB gain vs P10; within 0.1 pp, the smaller
  points cost.
- **Confirmation on fresh data.** 2024-25 leagues B and C (460, j = 0) and 2025-26 (214, new draws j = 1), the chosen
  arm vs P10.
- **(a) Real 2025-26 season** (`research/p11run.ts` real). Our team is played on the real outcomes through the invariant
  checker, against the opponent visible in the data. Every final is compared with his **actual** score. The P10
  baseline is the Phase-3 season run `s10` (same seeds, reproduced exactly).
- **Gate criterion, stated before the runs.** (b) must be significantly positive on the confirmation set; (a) must not be
  negative. 214 real weeks cannot resolve ~1 pp: its CI is about ± 1.5–2.5 pp.

### Results
**Tuning (444 model weeks; 311 still open at the branch, 1,999 completions; P10 won 82.9% (RB);
`summ_p11.py sim p11/u25,p11/u24 P10`).** All arms use the late schedule. Win% diffs are in percentage points; 95%
CIs naive / week-clustered.

| arm | **RB win% diff** | binary win% diff | weeks flipped L→W / W→L | pts/wk diff | 2025-26 RB | 2024-25 A RB | rule viol. (real-week checker runs) |
|---|---|---|---|---|---|---|---|
| β = 100 | +0.51 ± 0.35 / ± 0.44 | +0.53 ± 0.46 | 22 / 9 | +0.32 ± 0.37 | +0.77 ± 0.52 | +0.27 ± 0.47 | — |
| β = 300 | +0.62 ± 0.39 / ± 0.41 | +0.75 ± 0.54 | 32 / 13 | +0.00 ± 0.35 | +0.80 ± 0.54 | +0.45 ± 0.56 | — |
| **β = 1000 (chosen)** | **+0.73 ± 0.37 / ± 0.43** | +0.41 ± 0.53 | 28 / 19 | −0.27 ± 0.49 | +0.59 ± 0.55 | +0.85 ± 0.51 | 0 |
| β = 300, no risk dial | +0.45 ± 0.36 / ± 0.39 | +0.64 ± 0.47 | 24 / 8 | −0.25 ± 0.36 | +0.19 ± 0.53 | +0.69 ± 0.48 | — |

- **Open vs decided weeks.** In weeks still open at the branch (70%) β = 1000 gains +1.04 ± 0.53. In decided weeks
  every arm is within 0.03 pp of P10: points decide there, by design.
- **The choice.** β = 1000 had the largest gain; β = 300 was 0.11 pp behind, outside the tie window. The ordering of β
  is within noise, and the two seasons disagree on it. All β gain about 0.5–0.7 pp at ≤ 0.3 pts/wk.
- **The risk dial adds +0.17 pp at β = 300.** Not significant: 2025-26 +0.80 vs +0.19, 2024-25 +0.45 vs +0.69. It is
  kept because it makes the imagined future decisions play to the score.

**Schedule** (β = 300; 2025-26, 214 weeks, completion 0 only, paired across `p11/v25` and `p11/u25` with `--c0`):

| schedule | RB win% diff vs P10 | pts/wk diff | win-phase decisions/wk | decisions changed/wk |
|---|---|---|---|---|
| late (the last 3 game days) | +1.29 ± 1.30 | −0.10 ± 1.05 | 11.8 | 1.9 |
| ramp (linear over the week's game days) | −0.01 ± 0.85 | −0.13 ± 1.21 | 21.8 | 3.1 |
| (late, β = 1000) | +1.73 ± 1.38 | +0.21 ± 1.16 | 11.9 | 2.0 |

Earlier phase-in gains nothing:
- Early in the week the opponent's final is wide open: F_opp is flat and the dial is near 0.
- The extra raced changes are noise.
- `late` stays: the rule fixed beforehand was that ramp replaces late only if it is significantly better.

**(b) Confirmation on fresh model weeks (P10 vs P11 β = 1000; `p11/c24`, `p11/c25`).**

| set | model weeks (open at branch) | **RB win% diff** | binary win% diff | flips L→W / W→L | pts/wk diff |
|---|---|---|---|---|---|
| 2024-25 leagues B + C | 460 (335) | **+0.51 ± 0.43 / ± 0.43** | +0.33 ± 0.47 | 23 / 14 | −0.17 ± 0.35 |
| 2025-26, new draws (j = 1) | 214 (155) | +0.16 ± 0.63 / ± 0.81 | +0.00 ± 0.81 | 10 / 9 | +0.15 ± 0.69 |
| **confirmation pooled** | 674 (490) | **+0.40 ± 0.35 / ± 0.46** | +0.22 ± 0.41 | 33 / 23 | −0.07 ± 0.32 |
| all simulated weeks (tuning + confirmation) | 1,118 | **+0.53 ± 0.26 / ± 0.31** | +0.30 ± 0.33 | 61 / 42 | −0.15 ± 0.28 |

- Base win rate against the human-model opponents: P10 ≈ 83%.
- The confirmation's naive CI excludes 0. Its week-clustered CI (2024-25's leagues share most players) touches 0:
  −0.06 to +0.86.

**(a) Real 2025-26 season, real opponents' actual scores** (214 team-weeks; `summ_p11.py real p11/a25,s10:P10 P10`):

| run | W-L-T | win% | win% diff vs P10 (CI naive / week) | flips L→W / W→L | pts/wk | pts diff | L_ rule violations |
|---|---|---|---|---|---|---|---|
| P10 (`s10`) | 142-70-2 | 66.8% | | | 285.7 | | 0 |
| **P11 β = 1000, pre-registered opponent model (`HUMAN_ALL`)** | **144-68-2** | 67.8% | +0.93 ± 1.29 / ± 2.34 | 2 / 0 | 286.1 | +0.37 ± 1.09 | **0** |
| P11 β = 1000, refit opponent model (`HUMAN`; a2) | 145-68-1 | 68.0% | +1.17 ± 1.89 / ± 2.65 | 4 / 1 | 285.8 | +0.09 ± 1.08 | 0 |

- **The flipped weeks** are close ones where P11 found the points late. For example, w19 r1: 237.5 → 246 against the
  human's 245; w22 r2: 272 → 281 against 273.5.
- **a2 was run after the refit.** The refit was prompted by run (a)'s calibration table (below), not by its wins. a2 is
  reported as secondary.
- **The opponent model as P11 used it in the real season** (`summ_p11b.py calib`):
  - F_opp(actual final) at each of our tip-offs, by our game days left;
  - predicted mean vs actual: `HUMAN_ALL` 225–239 vs 242–252; `HUMAN` 233–246.
  - With `HUMAN`, PIT quintiles are still skewed high mid-week (e.g. 2 days left: 169/125/141/173/293). Real opponents
    in real matchups still score a few points more than the model expects.

**(c) Sanity: monotone risk response** (`research/p11risk.ts`; `summ_p11b.py risk p11/risk`).
- **Setup.** 44 real 2025-26 states (two teams per week, P10 played to the first tip-off of the third-last game day).
  P11 (β = 1000) decided that tip-off against opponents placed at a margin m below our projected final (sd 25).
- **Measured, against P8's decision:** the change in the sd of our final and in expected points (96 common scenarios,
  untilted continuations).

| margin m (our projected final − his mean) | dial γ (mean) | P(win) | decision changed vs P8 | sd of our final, chosen − P8 | E[points], chosen − P8 | P(win), chosen − P8 |
|---|---|---|---|---|---|---|
| −150 (hopeless) | 0.0000 | 0.000 | 16% | −0.12 ± 0.17 | +0.35 ± 0.51 | 0.00 pp |
| −50 | +0.0171 | 0.068 | 16% | −0.05 ± 0.07 | +0.35 ± 0.49 | +0.16 ± 0.27 pp |
| −20 | +0.0082 | 0.269 | 23% | −0.01 ± 0.06 | +0.42 ± 0.42 | +0.42 ± 0.42 pp |
| 0 (close) | +0.0005 | 0.485 | 34% | −0.04 ± 0.21 | +0.39 ± 0.54 | +0.40 ± 0.54 pp |
| +20 | −0.0071 | 0.703 | 20% | −0.01 ± 0.20 | +0.25 ± 0.51 | +0.18 ± 0.41 pp |
| +50 | −0.0165 | 0.914 | 25% | −0.24 ± 0.32 | +0.37 ± 0.52 | +0.21 ± 0.23 pp |
| +150 (far ahead) | 0.0000 | 1.000 | 18% | −0.12 ± 0.17 | +0.35 ± 0.51 | 0.00 pp |

- **The dial's sign is right in every state** (44/44): γ ≥ 0 at every margin behind, γ ≤ 0 at every margin ahead, and
  γ = 0 when the week is decided.
- **Manager's invariant, relative to neutral: 0/44 violations.** "Far ahead never more risk than close" and
  "hopelessly behind never less risk than close" hold as: far ahead is never more risk-seeking than max(γ_close, 0), and
  hopeless is never more risk-averse than min(γ_close, 0).
  - The strict ordering γ(far ahead) ≤ γ(close) ≤ γ(hopeless) fails in 32/44 states, by design. "Close" is rarely
    exactly even: slightly ahead makes it mildly averse. Far ahead and hopeless are neutral because nothing is left to
    win, and the points tiebreaker decides there.
  - The unit test reproduces the shape on a lock-or-gamble decision. With one game left, a sure 22 vs a final game of
    mean 20 / sd 12:
    - far ahead → lock;
    - close → lock;
    - behind by 10 → gamble;
    - hopeless → lock (the points choice).
- **Realized risk at single decisions is small.** The sd changes above are at most 0.24 pt. With a 0.25-pt tolerance,
  per-state comparisons with "close" show far ahead taking more risk in 2/44 and hopeless taking less in 4/44. Both are
  within noise: in those states both decisions are P10-like.
- **No decision is perverse.** Any changed decision never costs expected points on average (+0.25 to +0.42 at every
  margin). The win-probability effect is positive where the week is open.

**Rules (invariant checker).**
- **Real season.** 0 L_ violations in 2 × 214 real team-weeks for P11; recount = engine total everywhere.
  - 0 unforced let-gos and 0 ex-ante idle benchings.
  - The other counters are at P10's levels (per week, P11 / P10): deadline let-go-then-sat 0.52 / 0.55, lock into a
    wider slot 0.07 / 0.06, final-game locks 0.36 / 0.30, race overrides of P8 3.5 / 3.2.
- **Simulated weeks.** `p11/chk`: 23 model weeks (one team per 2025-26 week), P10 and P11 each run from scratch through
  the checker. 22 model weeks with an opponent: 44 checked runs, **0 L_ violations**. Each equals its
  shared-prefix continuation exactly (44/44).
- **Unit tests.** `tests/p11.test.ts`:
  - the opponent CDF;
  - the dial's sign, cap and the invariants;
  - the schedules;
  - P11 ≡ P10 at β = 0 and before the phase-in;
  - the monotone lock-or-gamble response;
  - every P11 decision legal on random weeks with opponents close / far ahead / far behind;
  - the human model's bookkeeping.

  `tests/engine_select.test.ts` covers the live option. `npm test`: 67/67.

**Compute.**
- **Per decision.** A win-phase decision adds 400 opponent simulations (~20–50 ms), 32 pilot continuations and, if
  γ ≠ 0, one tilted price re-solve plus one more raced candidate.
- **Per week.** On real weeks P11 cost 65 s of decision time per week vs P10's 70 s (both measured under 14-way load;
  P11's figure includes the variance diagnostic): the difference is within load noise.
- **Validation.** The pipelines took about 7 h on 14 cores.

### Live option (`lib/live/engine.ts`, `lib/live/opponent.ts`, `lib/live/advise.ts`)
- **Setting.** `objective: "points" | "win"`, via env `LOCKIN_OBJECTIVE` or `"objective"` in `~/.sleeper-lockin/config.json`.
  The env wins, the setting is re-read every 30 s, and unknown values mean `points`. **The default is `points`, which
  changes nothing.**
- **When "win" is active.** Only with a race engine (`p10` / `p10b`); with `p7h` / `p8` / `p9` it is ignored, with a
  warning. Then:
  - the plan's tip-off decisions use P11 (`WIN_OPTS` = β 1000, late 3 days);
  - the lock / hold / bench options of held scores are ranked by points + β·P(win), with the win probability against
    the human model of the opponent.
- **The opponent.** He comes from his Sleeper state (`humanSnapshot`): locks and points, held scores in starting slots,
  players in a game, lineup, finished games, and injury tags via his next games' play probabilities. His distribution is
  `HUMAN` + `HUMAN_RESID`, 400 simulations, once per view.
- **Caches.** The tag is `<engine>+win` when active. The views' fingerprints already contain the opponent's state
  (`teamFingerprint(opp)`). Default fingerprints are byte-identical (tested).
- **Not covered.** Replay of a finished week stays on points.
- **The live app was not touched, built or restarted.**

### Recommendation
- **The gate is met.** Win rate improves on both validations with 0 rule violations:
  - simulated: +0.40 pp on fresh weeks, +0.53 ± 0.31 pp on all 1,118;
  - real: 144-68-2 / 145-68-1 vs 142-70-2.
  - Points are unchanged.
- **Turning it on.** Set `"objective": "win"` together with engine `p10b` (or `p10`). The default stays `points`, and
  switching is the user's decision: it was not done here.
- **What to expect.** About +0.5 pp of win probability, ≈ 0.1 extra wins per 23-week season, at no measurable points
  cost.
  - The gain comes from the ~70% of weeks still open after the fourth game day (+1 pp there). P10 already wins ~67% of
    real matchups (~83% of simulated ones); most weeks are decided before any late decision matters.
  - It is small because the levers late in a Lock-In week are few: hold or lock a score, start a volatile player or not.
- **Caveats.**
  - The opponent model is the weak link. It is calibrated on average, but real managers are more erratic than it.
  - The early-week win objective (ramp) does not help.
  - The ordering among β = 100 / 300 / 1000 is not resolved; all of them help.
  - P11 was validated on P10. On P10b the mechanism is the same, but it was not separately backtested.
- **Follow-ups.**
  - Per-manager engagement estimated from his past weeks (some managers are reliably active, others not).
  - Use the opponent's visible lineup in the backtest snapshot (the live app has it).
  - P11b on the real season (about 1.6 h).

### Reproduce
```
npx esbuild research/humanfit.ts --bundle --platform=node --format=cjs --outfile=research/dist/humanfit.cjs --log-level=error   # (+ p11run as p11run2/p11run3.cjs, p11risk)
node research/dist/humanfit.cjs fitm research/out/humanfit_m.json                 # opponent model (fit, evalm, calibm "<params>", scan)
node research/dist/humanfit.cjs calibm research/out/humancalib_m.json "1.2844,0.1235,-3.3698,5.3396,1.7237,1.2764,0.7909,0.9989,0.0054,0.1877"
node research/runtasks.mjs research/dist/p11run2.cjs p11/u25 sim "POLS=P10;P11:beta=100;P11:beta=300;P11:beta=1000;P11:beta=300,dial=false" KC=6 PAR=14
node research/runtasks.mjs research/dist/p11run2.cjs p11/u24 sim SEASON=research/data/season2024.json TASKS=<w:1..10> <same POLS> KC=6 PAR=14
node research/runtasks.mjs research/dist/p11run2.cjs p11/v25 sim "POLS=P11:beta=300,sched=ramp" KC=1 PAR=14
node research/runtasks.mjs research/dist/p11run2.cjs p11/a25 real "POLS=P11:beta=1000,vr=64" PAR=14          # (a); a2: p11run3.cjs -> p11/a25m
node research/runtasks.mjs research/dist/p11risk.cjs p11/risk "" TASKS=<46 team-weeks> PAR=14
node research/runtasks.mjs research/dist/p11run2.cjs p11/c24 sim SEASON=research/data/season2024.json TASKS=<w:11..30> "POLS=P10;P11:beta=1000" KC=6 PAR=14
node research/runtasks.mjs research/dist/p11run2.cjs p11/c25 sim "POLS=P10;P11:beta=1000" S0=1 KC=6 PAR=14
node research/runtasks.mjs research/dist/p11run3.cjs p11/chk sim TASKS=<23> "POLS=P10;P11:beta=1000" CHECKBRANCH=1 KC=1 PAR=14
cd research/out && python3 ../summ_p11.py sim p11/u25,p11/u24 P10 && python3 ../summ_p11.py sim p11/c24,p11/c25 P10
python3 ../summ_p11.py sim p11/u25,p11/v25 P10 "P11:beta=300" "P11:beta=300,sched=ramp" --c0
python3 ../summ_p11.py real p11/a25,s10:P10 P10 && python3 ../summ_p11b.py vr p11/a25 "P11:beta=1000,vr=64" && python3 ../summ_p11b.py calib p11/a25
python3 ../summ_p11b.py risk p11/risk
```
- **Bundles.** `p11run2.cjs` was built at commit 75564de, with `HUMAN_ALL` as `HUMAN`. `p11run3.cjs` uses the refit
  `HUMAN`; it was built separately so the running pipeline kept one consistent bundle.
- **Drivers and outputs.** The drivers are `research/scratch/p11/pipeline*.mjs`. Single-draw tuning outputs from an
  earlier design (`p11/t25`, superseded) are kept; their P10 totals equal `p11/u25`'s completion 0 exactly.

## P8 simulation repeatability (overnight 2026-10-15, task F)

**Report.** Under `LOCKIN_ENGINE=p8`, two runs of `research/tradeeval.ts` (same seeds, N = 150) gave different
numbers: "lose Moussa Diabaté alone" −2.00 ± 0.75 vs −0.14 ± 0.78; "trade, spot empty" +0.49 vs +1.42. p7h was
repeatable.

**Verdict.**
- There was a real engine bug: an independent P8 simulation started mid-week depended on call order. It is fixed
  (commit 75c7984).
- It does **not** explain the tradeeval runs. At the asOf tradeeval uses (2026-10-19, preseason) every week starts at
  event 0, a case the bug never touched.
- Re-run tonight, tradeeval is repeatable to the last digit, on the old engine and on the fixed one (table below).
  The manager's two runs (file times: Oct 14 evening) most likely saw different **inputs**.
  - Rosters, injury tags and Sleeper projections are re-fetched during a run: in-memory TTLs are 1 min to 1 h
    (`lib/live/sources.ts`).
  - A P8 tradeeval run takes ~10–20 min; a p7h run takes seconds.
  - The app's data logger recorded 357 injury-tag changes over Oct 12–14. It stopped at 07:38 UTC on Oct 14, so the
    run window itself can't be checked.
  - This cause is likely but not proven. Over two 8-minute probes tonight, the inputs and the P8 week values did not
    change (`research/scratch/p8repeat_data*.log`).

### The bug
- **Where.** `simulate()` reset an index policy's price state (slot "top", "sim", ...) only at event 0 or with
  `fresh`. A run started at `fromEv > 0` without `fresh` continued from whatever the slot's last run had left.
- **What that state was.** Typically the end of the previous scenario's week: a view solved for a later time and a
  different state.
- **Affected.** Any independent mid-week P8 / P8f / P10 top-level run, e.g. `research/p10cmp.ts` with `ENG=p8` or
  `p10` whenever `T.evIdx > 0`.
- **Not affected.** The live app's projections, waivers, league odds and cut-offs: they use `simPolicy()`, which is
  `fresh`. The live plan always got a new team-week per request.
- **A second, minor dependence.** The week-start prices were solved with the `weekIters` of whichever policy first
  touched the team-week. Only tests set `weekIters`.

**Repro** (`research/scratch/p8repeat.ts`). Season week 5, one team, 6 model scenarios. Each run starts from the same
mid-week state (40% of the games played), with no prefix simulation, as the live app and p10cmp do. Columns: how many
of the 6 totals differ from the first pass when the pass is repeated, run in reverse order, or interleaved with
another team.

| policy | engine | again | reversed | interleaved | mean of the 6 totals |
|---|---|---|---|---|---|
| P8f `fresh` (slot "sim") | old | 0/6 | 0/6 | 0/6 | 313.38 |
| P8f | old | **5/6** | **6/6** | **5/6** | 300.97 |
| P8 | old | **3/6** | **2/6** | **1/6** | 309.36 |
| P8f | fixed | 0/6 | 0/6 | 0/6 | 313.38 (= `fresh`) |
| P8 | fixed | 0/6 | 0/6 | 0/6 | 319.28 |

- Runs from event 0 were already repeatable (0/6 everywhere), and their totals are unchanged by the fix.
- The stale prices were not just noise. P8f lost ~12 pts/week in this repro: decisions were priced from another
  scenario's later state.

### The fix (`lib/engine/p8.ts`, `lib/engine/core.ts`; no clamping)
- **When a run keeps its slot's price state.** Only when it **continues** a run: the same `State` object, resumed at
  the event index where the last run on that slot stopped. This is how chunked runs work: the live plan, replays,
  the invariant checker stepping one event at a time.
- **Explicit arming.** A slot can also be armed just before the run by `seedPrices` (rollouts), `restorePrices`
  (p11run branches) or the new `continuePrices`.
- **Every other run** starts from the week-start prices. Its result is then a pure function of (team-week, state,
  event index, outcomes).
- `fresh` still always resets.
- Week-start prices are cached per `weekIters`.
- `research/pregame.ts` continues one simulated week from copies of its state in two places. Both now call
  `continuePrices` explicitly, so its results are unchanged.
- **Regression test** (`tests/p8.test.ts`). Two team-weeks; P8, P8f and P8f `fresh`; mid-week and event-0 starts;
  each pass repeated, reversed and interleaved with the other team. Also checks that a run stepped in daily chunks
  equals the run in one go.
  - The test fails on the old engine and passes on the fix.
  - `npm test`: 68/68.

### Backtests unaffected (checked)
- **Why they can't be affected.**
  - Index-policy season runs use `research/runtasks.mjs`: one process per team-week.
  - Every top-level run starts at event 0 from `initState` (reset, as before).
  - Rollouts (P9 / P10 / P11) seed their slot immediately before each continuation.
  - The checker's one-event steps are continuations.
- **The policies of one team-week share a process.** They share only the week-start prices (all at the default
  `weekIters`) and the memo of warm re-solves, which is a pure function of its key. So order between them never
  mattered.
- **Empirical check.** Old (HEAD~1) vs fixed bundles on the same tasks (`research/scratch/oldnew.mjs`), outputs
  compared with timings masked:

| run | outputs |
|---|---|
| p10run, 3 team-weeks, P8; P8f; P9; P9b; P10, real outcomes + 2 model scenarios | identical |
| p10run, week 9, P10b; P11 | identical |
| p11run, week 9, P10 vs P11:beta=300 (save / restore price branches) | identical |
| pregame, week 9 day 2 (KMAX = 32, KEVAL = 30) | identical |
| gap, week 9, P8 and P8f on 20 model scenarios | identical |

- **Conclusion.** No reported P8 / P8f / P9 / P10 / P11 backtest number changes.
- **One possibly affected result.** Ad-hoc `research/p10cmp.ts` comparisons made at a mid-week asOf would have been
  affected. None are in this REPORT.

**tradeeval two-run repro** (LOCKIN_ENGINE=p8, N = 150, weeks 2,5,8,11,14,18,20; base 278.6 pts/wk in all runs):

| run | lose Murray | lose Diabaté | trade, spot empty |
|---|---|---|---|
| old engine, run A | −2.16 ± 0.88 | −0.46 ± 0.77 | +1.26 ± 1.04 |
| old engine, run B (concurrent) | −2.16 ± 0.88 | −0.46 ± 0.77 | +1.26 ± 1.04 |
| fixed engine, runs A and B | −2.16 ± 0.88 | −0.46 ± 0.77 | +1.26 ± 1.04 |

- **Recommendation for trade and waiver evaluations.** Snapshot the inputs once per evaluation, e.g. set
  `LOCKIN_CACHE_DIR` and pre-warm, or build every variant from one fetched data set. Then a long P8 run can't mix
  data from different hours. Not changed here: `lib/live` belongs to the live app's data path.

### Reproduce
```
npx esbuild research/scratch/p8repeat.ts --bundle --platform=node --format=cjs --outfile=research/dist/p8repeat.cjs --log-level=error
node research/dist/p8repeat.cjs 5 6 0.4          # week, scenarios, mid-week fraction (0 = event 0)
node research/dist/p8repeat_live.cjs 2,5 30 p8   # live buildWeek + weekValues path (research/scratch/p8repeat_live.ts)
node research/dist/p8repeat_data.cjs 8 2,5,8,11,14,18,20 10   # do the live inputs change between rebuilds?
node research/scratch/runenv.cjs LOCKIN_ENGINE=p8 N=150 SKIPTHEM=1 NFA=0 "GIVE=Keegan Murray,Moussa Diabate" "GET=Caleb Wilson" research/dist/tradeeval.cjs
node research/scratch/oldnew.mjs                 # old vs fixed bundles (research/dist/<script>_old.cjs / _new.cjs)
```

## Shipping P10b (overnight 2026-10-15, task G)
**Problem.** Engine `p10b` switched *every* simulation in the app to P8f, not just the decisions: projections,
Waivers, Matchups, IR and cut-offs, all 5–20× slower. Its notifier lock/hold/bench reminders were also not P10b's
decisions: they were the best option of P8f rollouts.

**Fix: engine `p10b` is now decision-only** (`lib/live/engine.ts`). The old behaviour is kept as `p10b-full`.
- **What P10b decides:**
  - the plan (P8 + the P10b race at every tip-off: start/sit, hold/lock/let go);
  - replay;
  - the hold/lock/bench call for each held score.
- **How the hold/lock/bench call is made** (`advise.ts`, `engineCall`):
  - it is P10b's decision at the plan's first tip-off, so the reminders now always agree with the plan's holds and
    forfeits;
  - the options' expected points are still shown, from the quick simulations;
  - a disagreement or near-tie is stated in the reason.
- **What stays on POLICY** (`simPolicy("p10b") === POLICY`): projections and win probability, Matchups, Waivers, IR,
  lock cut-offs, and the options' quick simulations.
- **Caches.**
  - `fingerprint(x, "sim")` keys mass-simulation results by the simulation engine, so p10b shares p7h's entries.
  - Advise and replay are keyed by the decision engine: `p10b+sim:p7h`, never the old `p10b` tag.
  - p7h's fingerprints are byte-identical to before.
- **Notifier** (`scripts/notify.ts`):
  - logs the engine;
  - with a race engine, precomputes last week's replay once per week in quiet hours (a P10b replay takes 3–5 min).

**Checks.**
- **Unit tests 71/71** (`tests/engine_select.test.ts` has 3 new tests plus extended ones). They cover:
  - the split;
  - p10b projections and cut-off simulations identical to p7h's;
  - fingerprint scopes;
  - each p10b call equal to an independently reproduced engine decision and consistent with the plan.
- **Type check:** clean.
- **Live code vs engine-v2 in one process on the same live contexts** (`research/scratch/g/p7h_equiv.ts`, 11/11 pass):
  - with p7h: identical projections, full advice JSON and fingerprints;
  - with p10b: identical projections, option values and mass-simulation fingerprints.
- **End-to-end notifier run** (`research/scratch/g/notify_e2e.mjs`): `HOME` pointed at a scratch dir with
  `"engine": "p10b"`, DRY_RUN. Cold 55.8 s (advise + forced Waivers + IR), next run 0.5 s.

**Latency** (real league, week 1 of 2026-27; one process per view, 12 workers; live services running). The tip-off
rows use week 1 simulated forward by POLICY to 10 min before that day's first tip-off.

| view | p7h | **p10b** | p10b-full |
|---|---|---|---|
| /api/advise Tue week-1 noon, cold (plan + 2 × 20k projections) | 5.3 s | **13.6 s** | 136.7 s |
| /api/advise now, cold / warm | 5.4 s / 2 ms | **14.1 s / 2 ms** | |
| notifier advise, Wed tip-off (3 held, 8 tip-offs in 30 h) | 5.4 s | **42.1 s** (43.4 s under concurrent Matchups + Waivers) | 166.8 s |
| notifier advise, Fri tip-off (6 held, 9 tip-offs) | 2.6 s | **12.4 s** | |
| notifier advise, Sat tip-off (4 held, 7 tip-offs) | 1.1 s | **3.9 s** | |
| Matchups cold / warm | shared entry | **30.1 s / 6 ms** | ≈ p8 (782 s) |
| Waivers cold / warm | shared entry | **36.4 s / 2 ms** | ≈ p8 (1,186 s) |
| IR cold / warm | shared entry | **5.6 s / 63 ms** | ≈ p8 (396 s) |
| Replay 2025-26 weeks 5 / 12 / 20, cold | 2.9 / 1.6 / – s | **198 / 292 / 210 s** | |

- **Shared entries confirmed.** The p7h runs of Matchups, Waivers and IR, started after p10b's, were cache hits
  (0.1–0.4 s).
- **Watchdog.** The worst notifier game-day run is about 1.5 min, against a 9-min limit. The replay precompute takes
  3.3–4.9 min in quiet hours.
- **Web.** The live web server shares the notifier's disk cache (`LOCKIN_CACHE_DIR` in its environment), so advise
  and last week's replay are usually warm.
  - Cold advise takes ≤ 45 s.
  - A replay that was not precomputed takes 3–5 min on its first view. `next start` doesn't enforce `maxDuration`.
- **Where the extra time goes.** All of it is the single-threaded P10b race, 1–7 s per planned tip-off.

**Deployment.** See `DEPLOY_P10B.md`: files, config change, rollback, checklist.
- **The rehearsal found a merge conflict.** lockin-live's watchdog commit (80192a5) is cherry-picked in engine-v2, and
  an engine-v2 edit next to it made the merge conflict. That edit was moved, and the merge is now clean.
- **A second problem: `next build` would have failed.** It type-checks `research/**/*.ts`, and a committed scratch
  script imported an untracked folder. The script is now `@ts-nocheck`.
- **Rehearsal** (throwaway clone of lockin-live in /tmp): **all OK**.
  - The merge of engine-v2 is clean.
  - `tsc` clean, `npm test` 71/71, `build:notify` OK.
  - `next build` OK in 537 s. It was built with webpack and a symlinked node_modules, because turbopack rejects a
    node_modules symlink outside the project and cloning node_modules took over 15 min. The live build uses
    turbopack, on the same code and the same type check.

```
npx esbuild research/livecost_g.ts --bundle --platform=node --format=cjs --outfile=research/dist/livecost_g.cjs --log-level=error
npx esbuild scripts/simworker.ts --bundle --platform=node --format=cjs --outfile=research/dist/simworker_g.cjs --log-level=error
node research/livecost_g_run.mjs p7h:advise-tue:a7 p10b:advise-tue:a10 p10b:tick:T10w p10b:league:L p7h:league:L ...   # engine:view:cacheTag[:KEY=VAL]
node research/scratch/g/extract_live.mjs && node research/scratch/runenv.cjs LOCKIN_NO_WORKERS=1 LOCKIN_CUTOFF_SIMS=2000 research/dist/p7h_equiv.cjs out.json
node research/scratch/g/notify_e2e.mjs p10b 2     # needs research/dist/g/{notify,simworker}.cjs
node research/scratch/g/rehearse.mjs /tmp/g_deploy2
```

## Analysis H: lineup timing, where the points go, literature (overnight 2026-10-15, task H)
Analysis only; no engine behaviour changed. **Full write-up: `research/ANALYSIS_H.md`**. Tables and charts are in
`research/out/h/` (`part1.md`, `part2.md`, `part4.md`, `literature.md`, `h_scored_curve_*.png`, `h_fill_curve_*.png`).

- **Tooling.**
  - `research/htrace.ts` traces the physical lineup of any policy and splits (Lagrangian bound − week total) exactly
    into per-decision losses against each player's priced DP, plus extra slot charges and empty priced slot-time. The
    split is validated on model scenarios: the categories sum to the gap within 0.04 ± 0.70 pts.
  - It also re-evaluates P10b's best rejected race candidate on fresh scenarios.
  - `research/h_lagmed.ts` compares the bound with brute-force optima on medium random weeks.
  - Every traced total equals the published season runs (1,070 runs checked, 0 rule violations). `research/invariants.ts`
    only gained optional observe-only callbacks.
- **Part 1 (timing).**
  - Our engines count scores from the same games as perfect hindsight (scored-time curves coincide); they differ only in
    when they commit (P10b ≈ 25 h after the game, P8 28 h, P7H 17 h). No sign of locking too early.
  - "All 9 secured" always lands on the final day, hindsight included, so it is not a useful target.
  - At game day 5, P10b still has 5.9 slots open (P7H 4.7, hindsight 3.4). Managers lose mainly to empty slots (20% of
    their slots).
- **Part 2 (gap to the bound).**
  - P10b, 120 real 2025-26 team-weeks, categories total 9.2 ± 1.5 pts/wk: final games kept to week end 2.6, held scores
    later given up 2.0, players sat because held scores filled their slots 1.75, start/sit 1.5, let-go regret 0.6, the
    rest ≤ 0.5.
  - The top three (6.4 pts) are hold-vs-play contention, where the fluid bound is loose. On medium brute-force weeks the
    bound is 3–5% above the true optimum.
  - Search: the race's rejected runner-up is worth +0.66 ± 0.44 pts/wk on fresh scenarios, nearly all "lock now"
    alternatives (+0.17–0.22 each, 4–5/week). Race gains shrink ~70% on fresh scenarios (winner's curse).
- **Part 3.** About 85 verified references.
  - Key point: an ALP bound would not be tighter (Brown & Zhang 2023); information relaxations would be.
  - Shortlist: lock-aware race acceptance with a fresh confirmation batch; a penalized information-relaxation bound;
    P8 hold priorities for contested slots; one-player-at-a-time rollout; truncated rollouts.
- **Part 4 (win objective).**
  - Only ~13% of real weeks are decided by < 10 pts; the oracle ceiling is +17 pp.
  - P11's P(win) is overconfident by 15–20 pp in its active range.
  - Managers differ in activity (significant), not in lock thresholds (≈ +1.1 sd for all).
  - Next: calibrate P(win), add a per-manager engagement prior.

```
python3 -E research/h_analyze.py && python3 -E research/h_part4.py     # tables + charts from research/out/h/*
```

## P10b on worker threads (overnight 2026-10-16, task "P10b decisions on worker threads")
**Goal.** P10b's race (up to 8 candidate decisions × 16–256 continuations each, played by P8) ran on one thread:
5–12 s per decision, up to ~45 s for a busy tip-off's advice, 3–5 min per replay. Move the continuations to worker
threads, with **bit-identical decisions**.

**Result.**
- The race itself is **~7–7.5× faster**: replays 202–290 s → 28–39 s, and the Wednesday tip-off race ~34 s → ~4.5 s.
- Whole views gain less, because work outside the race stays serial: Wednesday tip-off advice 38.4 → 8.7 s; the
  Tuesday plan is unchanged at 8.4 s, since it has hardly any race.
- **Identical decisions everywhere:**
  - unit tests with 1, 3 and 12 workers (decisions, final states, every race statistic);
  - the live advice path;
  - 7 of 7 views on the real league, single thread vs workers.
- Cost: +35–40% CPU time in total, and 1.2–2.2 GB RSS while racing.
- Not deployed. `DEPLOY_P10B.md` §8 lists the files, build, restart and rollback.

### Design (`lib/live/racepool.ts`, `lib/engine/p10.ts`, `lib/engine/p8.ts`)
**Synchronous, not async.** `E.simulate` and the hooks stay synchronous. Each racing round works like this:
1. The race draws the round's scenarios on the main thread, from its own random stream, exactly as before.
2. It hands the round to the pool.
3. The main thread posts the round to the workers, then plays continuations itself.
4. It blocks on `Atomics.wait` until all of the round's results are in a `SharedArrayBuffer`.
5. Only then does the race eliminate candidates, stop, or decide.

Why this instead of precomputing races asynchronously before each `simulate` step, or an async plan builder:
- **No API changes.** Every caller gets the speed-up with no plumbing: the plan, replay, the hold/lock/bench call, the
  notifier, P11.
- **Unchanged control flow.** The decision sequence is the same code path as the single-thread race, so the only
  difference can be *who* computes a continuation.
- **Blocking is no worse than before.** The main thread is busy anyway (as with the single-thread race, but ~7× shorter).
  Node allows `Atomics.wait` on the main thread, and workers start and run while it is blocked (checked).
- The asynchronous design needed stepping `simulate` event by event around every tip-off in `advise.ts`, plus a
  precompute hook. It would have kept the event loop free during a race, but no view needs that today.

**Determinism by construction.**
- **Pure continuations.** A continuation (`continuation()` in p10.ts) is a pure function of the team-week, the base
  policy, the decision state, the candidate, the scenario and the real decision's prices. Its price slot is seeded per
  continuation; the stopValue and re-solve memos are pure (task C).
- **Claiming and reduction.** Workers claim continuations from a shared counter and write each result at its own index
  (candidate-major). The race reads them in scenario order, as before. Elimination happens per round, after all results
  are in.
- **Scenarios** are always drawn on the main thread, in the old order, so the race's random stream (and therefore the
  next decisions) are untouched.
- **Price state (task-F rules).** The main thread exports the "top" slot's view: the minimiser's prices, the state it
  was solved from, t, tilt, day and ends (`exportPrices`). The worker rebuilds the view exactly (`importPrices`):
  `tables(prepare(fromState(st0, t0, tilt)), mu)`. Each continuation then seeds its own slot from it, as in the main
  thread.
  - Tested: every priced weight and P8's decision from the rebuilt view equal the original's.
- **Team-weeks** are sent once per worker. The main thread mirrors the workers' 2-entry list, so a team-week is resent
  whenever a worker may have dropped it. Contexts are sent once per decision; rounds are small.

**Fallbacks** (identical results, main thread):
- browser, `LOCKIN_NO_WORKERS`, `LOCKIN_RACE_WORKERS=0`, or `"raceWorkers": 0` in config.json (re-read every 30 s);
- no worker bundle, or a bundle without the race protocol (stale `simworker.cjs`), which is skipped up front;
- workers that don't answer the start-up handshake within 20 s;
- a worker exception, or no progress for 60 s. The round is replayed on the main thread and the pool is switched off.

**Memory.**
- The first version used 3.4–4.3 GB RSS: each worker held up to 1,000 memoised price views, the re-solve memo of task C.
- Workers now keep 100 (`setMemoMax`). On a P10b week that brought RSS from 4.3 to 1.7 GB, with the same result and
  speed (8.6–8.8 s vs 9.2 s).
- The main thread and research keep 1,000.
- The app's pool stops after 10 min unused and restarts in ~0.1 s.
- Claiming continuations in chunks of 2 or 4, for memo locality, was measured and is no faster. The default stays 1.

**Research is unchanged.** Backtests pass no pool, so they take the single-thread path. Its only change is that a
round's scenarios are drawn before its continuations are played, which consumes the same stream (continuations never
touch it).
- Checked on 46 real team-weeks below: P10b totals are identical to the Phase-3 season run `s10`.

### Tests (`tests/racepool.test.ts`; `npm test` 76/76, tsc clean)
- **Exact price views.** Every candidate's priced weights, P8's decision and its score are identical after
  export → structured clone → import.
- **Worker-count independence.** On random 9-slot weeks, P10b (P8 continuations, warm re-solves) and P10 (P8f) with
  1, 3 and 12 workers equal the single-thread race:
  - every decision, the total, the final state, and all race statistics (decisions, raced, candidates, switches,
    scenarios, continuations, per-race log);
  - with test settings (8 per round, up to 64) and with the defaults (16, up to 256).
- **Many team-weeks.** One pool serving several team-weeks in turn, returning to older ones: identical, and no fallback.
- **Fallbacks.** A stale bundle is refused. A pool that fails mid-race (here, an uncloneable team-week) is switched off,
  and the race finishes on the main thread with identical results.
- **Live path (engine p10b).** `planHooks` driven tip-off by tip-off as the plan does, and the whole `computeAdvice`
  JSON: identical with 1, 3 and 12 race workers and with none, and with the config off-switch.

### Latency on the real league
- **Setup.** League 1344387394811490304, roster 8, 2026-27 week 1. One process per view, empty disk cache, the app's
  12 projection workers plus 12 race workers.
- **Tip-off ticks.** The week was simulated forward to 10 min before that day's first tip-off, as in task G.
- **"Before"** is the same build with `LOCKIN_RACE_WORKERS=0`, i.e. the shipped single-thread race. Its decisions equal
  "after" in every row.
- **CPU** is the whole process's (all threads). Run with no other heavy jobs; Spotlight was indexing in the background.
- **Scripts.** `research/livecost_g.ts` (now with CPU, RSS and full decision output) and `research/livecost_w_run.mjs`.
  Outputs are in `research/scratch/w/`.

| view | before: wall (CPU) | **after: wall (CPU)** | speed-up | RSS after | decisions |
|---|---|---|---|---|---|
| /api/advise, Tue noon, cold (plan for Tue night + 2 × 20k projections) | 8.4 s (29.7 s) | **8.4 s** (39.4 s) | 1.0× (≈ no race) | 0.86 GB | identical¹ |
| notifier tick, Wed 6:50 pm (3 held, 8 tip-offs in 30 h): total | 41.8 s (65.7 s) | **12.1 s** (86.0 s) | 3.5× | 1.9 GB | identical |
| … of which advice (P10b plan + calls) | 38.4 s | **8.7 s** | 4.4× | | |
| tick, Fri 6:50 pm (6 held, 3 locked, 9 tip-offs): total / advice | 8.4 / 6.8 s (15.0 s) | **5.4 / 3.9 s** (24.3 s) | 1.6× / 1.7× | 1.6 GB | identical |
| tick, Sat 5:50 pm (4 held, 5 locked, 7 tip-offs): total / advice | 4.3 / 3.3 s (9.1 s) | **4.0 / 2.9 s** (15.2 s) | 1.1× | 1.2 GB | identical |
| replay 2025-26 week 5, cold | 202.1 s (224 s) | **28.4 s** (316 s) | **7.1×** | 2.2 GB | identical (76 log lines) |
| replay week 12 | 290.1 s (320 s) | **38.6 s** (448 s) | **7.5×** | 2.1 GB | identical (91) |
| replay week 20 | 214.9 s (238 s) | **29.1 s** (329 s) | **7.4×** | 2.1 GB | identical (91) |

¹ Two runs 30 min apart differ only in the clock-relative time label ("Tue, Oct 20, 9:30 PM" vs "Tue 9:30 PM"). The run
pair made 9 s apart is byte-identical.

**Where the remaining time goes** (main-thread profile of the Wednesday tick with workers, 13.4 s):
- the race ~4.5 s (≈ 34 s single-threaded, ~7.5×): the main thread plays its share for ~4.0 s and waits ~2.4 s for
  round tails;
- the week-start price solve, 2.1 s (2 × 100k Adam iterations, sequential, once per team-week and process);
- the projections' share on the main thread, the options' quick simulations (~0.7 s), P8's own decisions and price
  re-solves at the plan's tip-offs.

So views with little race (Tuesday, Saturday) barely change. Further gains would come from caching the week-start
prices per team-week, which is pure, and from pipelining round tails.

**Speed-up ceiling.** The race reaches ~7–7.5× with 13 threads on this 14-core Mac.
- Total CPU is +35–40% (random-week check: 55 s single vs 83 s with 12 workers).
- Causes: work that the single-thread memo shared is now done per worker, and threads land on slower cores.
- Claim chunking didn't help.

### More rollouts per decision: kMax 512 / 1024
**Latency now** (with workers, same views; env `LOCKIN_RACE_KMAX`, a measurement knob with its own cache key; the
default stays 256):

| view | kMax 256 | 512 | 1024 |
|---|---|---|---|
| Tue plan, cold | 8.4 s | 8.5 s | 8.4 s |
| Wed tick: total / advice (CPU) | 12.1 / 8.7 s (86 s) | 14.1 / 10.7 s (113 s) | 15.5 / 12.2 s (132 s) |
| Fri tick | 5.4 / 3.9 s | 5.9 / 4.3 s | 6.3 / 4.7 s |
| Sat tick | 4.0 / 2.9 s | 3.8 / 2.8 s | 3.8 / 2.8 s |
| replay week 12 (CPU) | 38.6 s (448 s) | 43.0 s (502 s) | 64.0 s (771 s) |

- **Cheap now.** kMax 1024 would cost the busiest tick ~3.5 s more, and a cold replay ~25 s more. Single-threaded, the
  same would have been minutes.
- **The extra scenarios are few.** Only races still undecided at 256 continue, and by then 1–3 candidates are left.
- **Decisions on these live samples.** The first-tip-off calls (what the notifier says now) were the same at all three
  budgets. Later, tentative plan steps changed:
  - Wednesday: Thursday's slot arrangement;
  - Friday (1024): one start on Saturday night;
  - Saturday (512, 1024): a held 38.7 locked at a later tip-off instead of held on.
- **Replay of week 12:** 313.5 (256) → 318.5 (512) / 318.0 (1024).

**Does a bigger budget change decisions, and is it better?**
- **Sample.** A paired backtest on real 2025-26 outcomes: 46 team-weeks, the Phase-2/3 model-study set (2 per week).
  Same seeds as the season run `s10`. `research/p10run.ts` with `DECLOG=1`, one process per team-week, 14 in parallel.
- **Noise baseline.** P10b with another race seed (`rseed=1`): the same race, the same budget, other scenarios.
  Needed because a longer race draws more from the race's random stream, so every later race sees different scenarios.
- **Research path is bit-identical.** P10b at the default budget reproduced `s10` on all 46 team-weeks.

| policy | pts/wk | paired diff vs P10b (256) | 95% CI naive | 95% CI week-clustered | better / worse weeks | win% vs real opp. |
|---|---|---|---|---|---|---|
| P10b (kMax 256) | 293.65 | | | | | 70.9% |
| P10b, another race seed (noise baseline) | 291.88 | −1.77 | ± 1.83 | ± 1.82 | 10/13 | 68.6% |
| P10b, kMax 512 | 294.87 | +1.22 | ± 1.96 | ± 1.79 | 9/7 | 73.3% |
| P10b, kMax 1024 | 291.82 | −1.84 | ± 2.21 | ± 2.35 | 10/12 | 70.9% |

| policy | raced / wk | scenarios per race: mean (share at kMax) | continuations / race | switches from P8 / wk | s per raced decision (1 thread, 14 jobs) |
|---|---|---|---|---|---|
| P10b (256) | 25.2 | 168 (49%) | 912 | 2.35 | 12.2 |
| another race seed | 25.3 | 162 (47%) | 896 | 2.41 | 9.7 |
| kMax 512 | 25.2 | 270 (34%) | 1,353 | 2.74 | 19.0 |
| kMax 1024 | 25.0 | 391 (20%) | 1,866 | 3.15 | 23.5 |

**Decisions on identical states.**
- On the real outcomes two runs face the same states until their first different decision. That decision was made on
  an identical state.

| vs P10b (256) | team-weeks with a different decision | decisions compared on identical states | different | at the first difference: the variant switches / keeps P8's |
|---|---|---|---|---|
| another race seed | 42/46 | 367 | 42 (11.4%) | 21 / 21 |
| kMax 512 | 44/46 | 415 | 44 (10.6%) | 32 / 12 |
| kMax 1024 | 45/46 | 405 | 45 (11.1%) | 34 / 11 |

**Reading.**
- **Monte-Carlo noise is as large as the budget effects.** One 256-scenario race re-run on other scenarios already
  makes a different call in ~11% of decisions and moves the week by −1.8 ± 1.8 pts.
  - kMax 512 / 1024 differ by the same amounts (10.6% / 11.1%, +1.2 / −1.8 pts), and not monotonically. On 46
    team-weeks no budget effect is visible.
- **What the budget does change: more switches from P8's decision** (2.35 → 2.74 → 3.15 per week).
  - With more scenarios, the significance gate (gain > 0.5 pt and > 2 se) passes smaller gains.
  - The noise baseline instead switches as often as it keeps (21 / 21 at the first difference).
  - Task H found that race gains shrink ~70% on fresh scenarios (winner's curse). So extra switches at small estimated
    gains are not clearly worth anything.
- **Resolution needed.** The paired real-outcome SD is ~6 pts per team-week. Resolving a 0.5-pt effect would take
  ~600 team-weeks: both seasons, ~11 h on 14 cores for kMax 1024.

**Recommendation.**
- **Ship the worker-thread race** (`DEPLOY_P10B.md` §8). Decisions are identical, so it carries no decision risk.
  - Tip-off advice takes ≤ 13 s instead of up to ~45 s; a cold replay ~30–40 s instead of 3–5 min.
  - Instant off-switch: `"raceWorkers": 0`.
- **Keep kMax = 256** (default unchanged).
  - With workers, 512 / 1024 cost little: +1.5–3.5 s at the busiest tick, +5–25 s per cold replay.
  - But this sample shows no benefit beyond Monte-Carlo noise.
  - A bigger budget mostly adds switches at small estimated gains, the kind task H found to shrink on fresh scenarios.
- **If pursued, measure per decision, not per week.** Where 256 and 1024 disagree on an identical state, score both
  choices with many fresh common-random-number continuations (as task H's runner-up re-evaluation did). That resolves
  the value of the budget with far fewer runs than a season backtest.
  - Better still for a budget increase: spend it on a confirmation batch for a switch (task H's "lock-aware race
    acceptance with a fresh confirmation batch"), not on a longer race.

**Not done.**
- `next build` was not rehearsed. This worktree's `node_modules` is a symlink into the live checkout, and a build could
  write caches there.
- The web-side change is a static `worker_threads` import plus `Atomics` in a server-only module, the same pattern as
  the existing `fs` / `os` imports and teamsim's worker pool.
- `tsc` (which covers the whole repo) is clean.

### Reproduce
```
npx esbuild scripts/simworker.ts --bundle --platform=node --format=cjs --outfile=research/dist/simworker_w.cjs --log-level=error
npx esbuild research/livecost_g.ts --bundle --platform=node --format=cjs --outfile=research/dist/livecost_g.cjs --log-level=error
node research/livecost_w_run.mjs p10b:tick:tww:DAY=2026-10-21 p10b:tick:t1w:LOCKIN_RACE_WORKERS=0,DAY=2026-10-21 \
  p10b:replay:rw12:WEEK=12 p10b:replay:r1w12:LOCKIN_RACE_WORKERS=0,WEEK=12 p10b:tick:tk1024w:DAY=2026-10-21,LOCKIN_RACE_KMAX=1024 ...
  # engine:view:cacheTag[:KEY=VAL,...] -> research/scratch/w/<engine>_<view>_<tag>.json (logs run1.log, run2.log)
node research/dist/memdiag.cjs <abs path>/research/dist/simworker_w.cjs 12   # race-worker memory on a random week (0 = one thread)
node research/scratch/w/chunks.mjs                                           # claim chunk 1 / 2 / 4
npx esbuild research/p10run.ts --bundle --platform=node --format=cjs --outfile=research/dist/p10run_w.cjs --log-level=error
node research/runtasks.mjs research/dist/p10run_w.cjs kmx "" "POLS=P10b;P10x:base=P8,kMax=512;P10x:base=P8,kMax=1024" DECLOG=1 PAR=14 TASKS=<the 46 gap4 team-weeks>  # 90 min
node research/runtasks.mjs research/dist/p10run_w.cjs kmxn "" "POLS=P10x:base=P8,rseed=1" DECLOG=1 PAR=14 TASKS=<same>   # 16 min
cd research/out && python3 ../summ_kmax.py kmx,kmxn P10b "P10x:base=P8,rseed=1;P10x:base=P8,kMax=512;P10x:base=P8,kMax=1024" s10
```

## Waivers page method: season-long waiver backtest (overnight 2026-10-16, task W)
**Full write-up: `research/WAIVERS_W.md`** (design pre-registered in commit d5b9b38 before any result). No engine
or live code changed.

**Design.**
- Every week, each team's real roster (2025-26: our league, 220 team-week decisions; 2024-25: three synthetic
  leagues, 660) gets at most one add/drop from that week's real free agents, chosen before the week by each method.
- The edited and the unedited roster are played on the real games by P8 (live P10b's base policy) over the 2 target
  weeks (H2) and over the rest of the season while the pickup is kept (ROS).
- New dataset: every player's games with full team schedules (`research/w_build.py`). `season_all.json` alone omits
  free agents' DNPs.

**Results** (pooled method minus current; P8 metric):

| method | 2 weeks | rest of season |
|---|---|---|
| P8f simulations | +0.9 ± 2.2 | +1.4 ± 4.7 |
| ROS term | −0.1 ± 1.4 | −0.8 ± 5.9 |
| naive | −1.0 ± 2.1 | −1.3 ± 6.0 |

- Live N = 2000 vs N = 300: +0.8 ± 2.0 / +3.7 ± 6.7 (2025-26 only).
- A low-noise perfect-hindsight evaluator agrees with all of these.
- **The current method stays. No config option was added (nothing won).**
- P8f would also need a variant-parallel implementation to fit the 2-minute budget: 476 s on one thread, 61 s on
  12 workers; POLICY takes 7 s at N = 300 and 44 s at N = 2000.

**The method's value vs no move.**
- 2024-25 (unmanaged rosters, good free agents left): **+8.8 ± 3.7** over 2 weeks, **+32 ± 13** over the rest of
  the season. Predictions are 75–80% realized.
- Our real league: **−1.6 ± 3.6** / −0.9 ± 13.8 (hindsight +1.0 ± 1.8), against +8.4 predicted.
- The free agents left in our league are rotation players: the page's adds played 59% of their games and scored
  9.0 per game against a projected 23.9. The pre-week model has no injury or rotation information for them.

**Valuation sanity.**
- In 58–71% of the current method's picks, the drop by itself is valued as a gain. In 72–88%, the move is worth
  more than the add alone: the search selects POLICY's non-monotonicity and noise.
- At N = 2000, 4.3% of all drop evaluations show a significant gain.
- P8f halves the nonsense, but not the real outcome.

**Exploratory, added after the results.** Capping play probability at the player's recent availability gave
+8.0 ± 5.5 vs current on 2025-26 but −2.6 ± 3.8 on 2024-25. It did not replicate.

## P10b acceptance fix: confirm the race's best challenger on fresh scenarios (overnight 2026-10-16, task L)

### Problem (task H, `research/ANALYSIS_H.md` finding 7)
- The race's best *rejected* challenger, re-scored on 96 fresh scenarios, would have gained +0.66 ± 0.44 pts/wk
  (2024-25 +0.81 ± 0.64). Most of it is "lock now" alternatives the race scored 0.5–1.0 better: +0.22 ± 0.06 each,
  ~2.6 per week. The 2-se rule rejects them.
- Race gains shrink on fresh scenarios (+0.70 → +0.22): the race's estimate of its best challenger is biased upward
  (winner's curse), so lowering its own threshold would admit flukes.

### Design (`lib/engine/p10.ts`: `confirmTarget`, `confirmPasses`, options `confirm*`; policy P10c, engine `p10c`)
- The race is unchanged (same candidates, rounds, elimination, stopping, random stream), so P10c makes exactly
  P10b's decisions until the first decision the confirmation changes.
- **After the race**, one challenger is re-scored against P8's decision on a **fresh confirmation batch** of
  `confirm` scenarios, drawn from its own random stream (`rng(seed ^ 0x2545f491)`), so the estimate is independent of
  the selection and free of the winner's curse:
  - if the race did not switch: its best challenger by race gain, if that gain is > `confGate` and its kind (first
    word of the candidate's label: `lock`, `in`, `out`, `hold`, `play`, swap) is in `confKinds`;
  - if the race switched: the switch stands (P10b), or with `confAll` it must pass the confirmation too.
- **Switch rule:** the confirmation's mean paired gain d̄ > `confMin` and d̄ > `confZ` · se (one-sided).
- Only one challenger is confirmed per decision (no multiple testing). Default `confirm: 0` = P10 / P10b exactly.
- **Cost:** 2 × `confirm` continuations per confirmed decision, as one more round on the race's worker pool live.

### Pre-registration (written before any tuning or season result was seen)
**Tuning (model scenarios only, no real outcomes)** — `research/l_tune.ts`, `research/l_pipeline_tune.mjs`:
- P10b played on model worlds: the 46 gap-study team-weeks of 2025-26 × 2 worlds, and 46 team-weeks of 2024-25
  league B (rids 13, 18, weeks 1–23) × 1 world (worlds from `scenarios(tw, NW, seed·29+5)`, not the gap seeds).
- At every raced decision whose race switched or whose best challenger has race gain > 0.25: that challenger's paired
  gain over P8's decision on 512 fresh scenarios (own stream), kept per scenario.
- `research/l_tune.py` replays every rule offline: confirmation = the first M of the 512, truth = mean of the last
  256 (independent of the confirmation). Gain vs P10b per model week = Σ (switch under the rule − P10b's switch) ×
  truth; 95% CI clustered by model week.
- Grid: confGate ∈ {0.25, 0.5}; confKinds ∈ {lock, lock+in, any}; M ∈ {64, 128, 256}; confZ ∈ {0, 0.5, 1, 1.645}
  (confMin 0); confAll ∈ {no, yes}: 144 rules.
- **Pick:** the best tuning gain; among rules within 0.05 pts/wk of it, the smallest M, then confAll = no, then the
  fewest kinds, then confGate 0.5, then the largest confZ. These become `P10C_OPTS` before any season run.
  (Caveat: one-step gains with P8 playing the rest of the week; the selected rule's tuning gain is optimistic.)

**Validation gate (as Phase 3):**
- P10c on the real outcomes of 2025-26 (230 team-weeks) and 2024-25 (690), `research/p10run.ts`, invariant checker.
- Baseline: the published P10b runs `s10` / `s24p10b` (same runner and seeds; the research path is bit-identical,
  re-checked: every team-week where the confirmation changed nothing must reproduce P10b's total exactly).
- **Ships only if** the pooled P10c − P10b gain (inverse-variance pooled, week-clustered CIs) has a 95% CI excluding 0
  **and** 0 rule violations. Also reported: per season, decisions changed per week, latency on the live path with
  workers, and task H's runner-up re-evaluation on P10c (96 fresh scenarios, `FRESH=96`), which should shrink toward 0.

### Tuning result (model scenarios; `research/out/l/tune_summary.md`, `tune_diag.md`)
138 model weeks (46 × 2 of 2025-26, 46 × 1 of 2024-25 league B): 25.1 raced decisions and 7.9 probe entries per week,
512 fresh scenarios each. Truth = mean of fresh scenarios 256–511.

What the race's best challenger is really worth, by race gain (fresh truth, mean ± 95% CI):

| race switched? | kind | race gain 0.25–0.5 | 0.5–1.0 | 1.0–2.0 | > 2 |
|---|---|---|---|---|---|
| no | lock (4.3/wk) | +0.09 ± 0.08 | **+0.25 ± 0.10** | **+0.56 ± 0.22** | (n = 3) |
| no | in (0.35/wk) | +0.05 ± 0.20 | +0.02 ± 0.44 | +0.75 ± 0.64 | |
| no | out (0.76/wk) | −0.16 ± 0.15 | +0.23 ± 0.31 | +0.92 ± 0.66 | |
| yes | lock (2.0/wk) | | +0.36 ± 0.12 | +0.54 ± 0.14 | +1.62 ± 0.44 |
| yes | in / out (0.4/wk) | | +0.13 to +0.25 | +0.79 to +0.96 | +1.67 to +2.80 |

- The model replicates task H: rejected "lock now" challengers at race gain 0.5–1.0 are worth +0.25 each (H: +0.22).
  Race gains still shrink by 50–65%, but the race's best challenger is worth more than nothing in every bin above 0.5.
- The race's own switches are worth +0.36 to +1.6 each. Confirming them as well (`confAll`) only loses: −0.06 to
  −0.08 pts/wk in every otherwise equal rule.

Top rules (of 144; full table in `tune_summary.md`):

| confGate | kinds | M | confZ | confAll | gain vs P10b, pts/wk (one-step, 95% CI) | switches added/wk | confirmations/wk | extra continuations/wk |
|---|---|---|---|---|---|---|---|---|
| **0.25** | **any** | **128** | **0** | **no** | **+1.18 ± 0.29 (pick)** | 3.09 | 5.46 | 1,397 (+6%) |
| 0.25 | any | 256 | 0 | no | +1.17 ± 0.28 | 3.29 | 5.46 | 2,794 |
| 0.25 | any | 128 | 0 | yes | +1.10 ± 0.30 | 3.09 (0.56 vetoed) | 7.89 | 2,020 |
| 0.25 | any | 64 | 0 | no | +1.08 ± 0.29 | 2.87 | 5.46 | 698 |
| 0.25 | lock+in | 128 | 0 | no | +1.04 ± 0.28 | 2.64 | 4.62 | 1,182 |
| 0.5 | any | 128 | 0 | no | +1.00 ± 0.27 | 1.83 | 3.17 | 813 |
| 0.25 | any | 128 | 0.5 | no | +0.98 ± 0.26 | 2.12 | 5.46 | 1,397 |
| 0.25 | lock | 128 | 0 | no | +0.98 ± 0.26 | 2.43 | 4.26 | 1,091 |

**Pick (by the pre-registered rule): `P10C_OPTS = { confirm: 128, confGate: 0.25, confKinds: "" (any), confMin: 0,
confZ: 0, confAll: false }`**, committed before any season run.
- Every non-zero `confZ` loses. The challengers' true gains (~0.2–0.5) are below the confirmation's se (~0.75 at
  M = 128), so a significance test throws away mostly good switches. "Mean > 0" is the posterior-mean rule under a
  prior that is positive on average, which is what the table above shows.

What the confirmation adds over simply lowering the race's threshold (same model weeks, `tune_diag.md`):

| rule | switches added/wk | truth per added switch | gain vs P10b, pts/wk |
|---|---|---|---|
| no confirmation: switch to every best challenger with race gain > 0.25 | 5.46 | +0.20 | +1.11 ± 0.35 |
| no confirmation, race gain > 0.5 | 3.17 | +0.32 | +1.01 ± 0.32 |
| **P10c: race gain > 0.25 and confirmation mean > 0** | **3.09** | **+0.38** | **+1.18 ± 0.29** |
| (the confirmation's rejects) | 2.36 | −0.03 | −0.07 ± 0.19 |

- **The confirmation is calibrated.** Its mean predicts the truth monotonically: ≤ −1: −0.10; −1–0: 0.00;
  0–0.5: +0.20; 0.5–1: +0.33; 1–2: +0.66; > 2: +0.93.
- **It filters out the worthless switches.** It keeps the gain of a lower threshold with 43% fewer switches, because
  the switches it rejects are worth nothing on average. That is the "without adding flukes" part.
- **Most of the gain comes from switching more often.** The confirmation adds only a little on top of that.

### Validation: season backtests on real outcomes (prefixes `l/v25`, `l/v24`; baselines `s10`, `s24p10b`)
**Result: the gate is not met. P10c does not ship.** The default engine and `p10b` are unchanged.

| comparison | 2025-26 (230, real league) | 2024-25 (690, synthetic) | **pooled** (inverse variance, week-clustered) |
|---|---|---|---|
| P10c − P10b, pts/wk | +0.28 ± 1.50 (naive ± 1.16) | +0.10 ± 0.78 (naive ± 0.77) | **+0.14 ± 0.69** |

| season | P10c pts/wk | P10b pts/wk | weeks 1–11 / 12–23 | better / worse team-weeks | league A / B / C | win% (P10b) |
|---|---|---|---|---|---|---|
| 2025-26 | 286.5 | 286.2 | −0.87 / +1.32 | 66 / 46 | | 68.2% vs the real opponents (68.2%) |
| 2024-25 | 286.6 | 286.5 | −0.27 / +0.43 | 154 / 166 | +0.6 / +0.6 / −0.9 | 53.8% vs the live bot (53.1%) |

- **Rules:** 0 L_ violations on all 920 team-weeks; recount = engine total everywhere. No dominated actions
  (S_forfeit_unforced, S_idle_bench_exante 0). Final-game locks rise slightly (I_lock_final_game 0.16 → 0.21/wk,
  0.17 → 0.20/wk), as expected from more lock switches.
- **Reproducibility:** in the 9 + 47 team-weeks where the confirmation never changed a decision, P10c's total equals
  P10b's (`s10` / `s24p10b`) exactly. The confirmation's stream leaves the race untouched, and the research path still
  reproduces the published P10b runs.
- **Run note:** one 2024-25 team-week (w6 r28) was missing after the pipeline, though the runner reported no failure. It
  was rerun alone with the same command.

**What the confirmation changed (per real week)**

| season | confirmations | switches added | race switches vetoed | switches from P8's decision (P10b) | kinds switched | continuations: race + confirmation (P10b) |
|---|---|---|---|---|---|---|
| 2025-26 | 4.88 | **2.68** | 0 | 4.48 (2.30) | lock 3.43, out 0.71, in 0.30 | 21,450 + 1,250 (23,118) |
| 2024-25 | 4.69 | **2.55** | 0 | 4.43 (2.28) | lock 3.38, out 0.71, in 0.29 | 19,211 + 1,200 (21,118) |

- The confirmed candidates' race gain is +0.62 on average, their confirmation gain +0.06–0.07 (se 0.8). That is the
  winner's curse again, now measured on real-season states.
- **The confirmation's extra cost is +5–6% continuations.** The race itself needs slightly fewer, because the states
  differ after earlier locks.
- Decision time per week (single process, 12 jobs) was 236 / 181 s for P10c. It is not comparable with the P10b runs:
  those predate task C's speed-ups and ran under 14 jobs.

**Runner-up re-evaluation after the fix** (task H's statistic on P10c: the best challenger *not* chosen, when the
race scored it > 0.25 better, re-scored against the chosen decision on 96 fresh scenarios; `FRESH=96`, own stream):

| | task H (P10b) | **P10c 2025-26** | **P10c 2024-25** |
|---|---|---|---|
| decisions per week | 5.51 (2025-26) | 2.23 | 2.16 |
| gain if always switched, pts/wk | +0.66 ± 0.44 (2024-25: +0.81 ± 0.64) | **−0.18 ± 0.23** | **−0.10 ± 0.12** |
| "lock" runner-ups, per decision | +0.17 to +0.22 | −0.03 ± 0.12 | +0.02 ± 0.07 |
| "out" runner-ups, per decision | −0.22 | −0.28 ± 0.22 | −0.26 ± 0.13 |

- As intended, the one-step headroom the race leaves is gone: what remains is 0 or slightly negative, i.e. the race now
  takes every one-step improvement the model can see.

**Why the model's +1.18 did not materialise (exploratory, written after the results; `research/summ_l_diag.py`)**
- Regress each team-week's P10c − P10b on its number of added switches. On real outcomes an added switch is worth
  **+0.05 pts (95% CI −0.18 .. +0.28)**: 2025-26 −0.12, 2024-25 +0.10. The model's estimate, +0.38 per switch, lies
  outside that CI.
- At the first added switch both runs face identical states, but the week's difference shows no relation to the
  confirmation's estimate at that switch (0–0.5: −0.30; 0.5–1: +1.27; 1–2: −0.51; > 2: +0.77; ± 1–4 each).
- So the switches the model rates +0.2–0.4 each ("lock now" rather than keep holding) are worth about 0 on real
  outcomes. Either the model's view of a held score's option value is off by that much (the model's week expectation
  already runs 5–7 pts above real outcomes, Phase 3), or the one-step value (P8 continuations) does not carry over when
  P10c also decides later. Real-outcome noise (paired SD ~6 pts per team-week) cannot separate a +0.1–0.2 pt/wk
  effect: 920 team-weeks resolve ± 0.7.
- Task H's "+0.5 pt/wk still on the table" was itself a model estimate (fresh *model* scenarios). This experiment
  shows that it does not turn into real points, at least not resolvably.

**Live path latency** (real league, 2026-27 week 1, 12 projection + 12 race workers, cold caches; `research/livecost_l_run.mjs`,
outputs `research/scratch/l/`; run right after the backtests, load average ~3–16):

| view | p10b | p10c | decisions |
|---|---|---|---|
| notifier tick Wed 6:50 pm (3 held, 8 tip-offs): total / advice (CPU) | 15.7 / 12.3 s (133 s) | 16.1 / 12.6 s (138 s) | first-tip-off calls identical; one later plan step differs |
| tick Fri 6:50 pm | 6.0 / 4.3 s | 6.1 / 4.3 s | identical |
| tick Sat 5:50 pm | 3.7 / 2.8 s | 3.6 / 2.7 s | identical |
| replay 2025-26 week 12, cold (CPU) | 37.9 s (436 s) | 37.2 s (434 s) | differ (313.5 vs 325.5 pts; one week, anecdotal) |

The confirmation costs ≤ 0.4 s per view on the worker pool. RSS is unchanged (1.1–2.2 GB).

### Decision and recommendation
- **Pre-registered gate:** a pooled 95% CI excluding 0 and 0 violations. Result: +0.14 ± 0.69 with 0 violations, so
  **not met: keep `p10b` live.** No DEPLOY note was written. Nothing in the live app or its config was touched.
- **Kept as an option:** `p10c` (engine option, `"engine": "p10c"`) and P10c (research policy), with the confirmation
  options on `P10Opts`. They are safe: decisions are rule-clean, latency is the same, and P10c is at least not worse
  (+0.14 ± 0.69). But they have no demonstrated gain.
- **What this says about the race:** the 2-se acceptance rule was not leaving real points behind. The "rejected but
  good" challengers were good under the model only.
  - Further acceptance tuning should not be judged on model scenarios.
  - Next, test the model's held-score option value against real outcomes. For example, compare its lock-now vs hold
    valuations on real 2024-25 states with what happened (calibration of the hold option).
  - This connects to ANALYSIS_H items 2–3: the bound gap, and hold priorities.

### Reproduce
```
npx esbuild research/l_tune.ts --bundle --platform=node --format=cjs --outfile=research/dist/l_tune.cjs --log-level=error
npx esbuild research/p10run.ts --bundle --platform=node --format=cjs --outfile=research/dist/p10run.cjs --log-level=error
node research/launch_detached.mjs research/out/l/tune.log research/l_pipeline_tune.mjs     # 63 min, 12 processes
python3 -E research/l_tune.py l/t25,l/t24 --top 30 > research/out/l/tune_summary.md && python3 -E research/l_tune_diag.py
node research/launch_detached.mjs research/out/l/val.log research/l_pipeline_val.mjs v25 v24  # 1.3 h + 3.0 h, 12 processes
cd research/out && python3 ../summ_pool.py s10,l/v25 s24p10b,l/v24 P10c:P10b && python3 ../summ_season.py s10,l/v25 P10c:P10b
python3 ../summ_s24.py s24,s24p10b,l/v24 P10c:P10b && python3 ../summ_inv.py l/v25:P10c,s10:P10b,l/v24:P10c,s24p10b:P10b
python3 -E ../summ_l.py && python3 -E ../summ_l_diag.py
npx esbuild scripts/simworker.ts --bundle --platform=node --format=cjs --outfile=research/dist/simworker_l.cjs --log-level=error
node research/livecost_l_run.mjs p10b:tick:bw:DAY=2026-10-21 p10c:tick:cw:DAY=2026-10-21 ... p10b:replay:br12:WEEK=12 p10c:replay:cr12:WEEK=12
```

## Opportunity alerts (overnight 2026-10-19, task O)
Goal: catch bench players whose role grows (a rotation player goes out, or a minutes surge) before Sleeper's projections
do, and tell the user to grab them. Code: `lib/live/opportunity.ts` (detector, surge watch, overrides, alert texts; pure
functions shared by the live scan and this validation), `lib/live/boxscores.ts` (cached ESPN box scores),
`lib/live/oppscan.ts` (live scan), the override plumbing in `lib/live/week.ts`, the notifier.

### Data for the validation
- Minutes: Sleeper's per-game stat rows carry seconds played (`sp`), one row per rostered NBA player per team game, DNPs
  included (≈ 18-19 rows per team game). 2025-26 regular season + 2025 preseason fetched by `research/o_fetch.py`
  (`research/data/o/`, not committed); 2024-25 from `research/data/raw2024`. Projected minutes = the projection rows'
  `sp`. Tip-off times and Sleeper's pre-game fp projection per game (`proj_sleeper`) from `research/data/w/all20xx.json`.
- No injury history exists, so an absence is read off the box scores (a run of missed team games), and "the detector
  knows" at the run's first missed game. Sleeper's depth chart has no history either: the depth-chart term is live only
  (+1.5 min for the player next behind the absent one at his depth position) and is **not validated**.
- **Leak found and avoided:** Sleeper deletes the projection rows of games a player then sat out, so in stored data
  "no projection for tonight" partly encodes the outcome (with it, the fitted minutes model put weight 0.46 on Sleeper's
  projected minutes; without it, 0.08). The validation's "Sleeper view at time T" is the projection of the player's last
  **played** game before T (no row for a game he played = Sleeper showed 0). For lead times (games the player played)
  the stored row is the real pre-game projection.

### Tuning (2024-25 only; 2025-26 untouched until the pre-registration below was committed)
- Rotation player: >= 20 mpg over his last 5 played games. Absence: >= 2 consecutive missed regular-season team games
  after playing the previous one, >= 5 played games before. 2024-25: 463 absences.
- A teammate's expected minutes gain = 0.87 x prior + 0.5 x (last-3 mpg - baseline) + 0.2 x n/(n+8) x with/without
  delta (least squares on 2024-25, `research/o_tune2.py`; R² 0.19). Baseline = his mean minutes (DNP = 0) over the
  absent player's last 5 played team games. Prior = share x the absent player's mpg; the share table (by the teammate's
  baseline minutes and position overlap) is the mean realized share in 2024-25 (`research/o_tune.py`): same-position
  players at 3-14 min absorb most (0.18-0.23 of the absent minutes each), 26+ min teammates lose minutes (regression).
- With/without delta: his minutes in team games the absent player missed vs played (this season; last season at weight
  0.5). Its coefficient is small (0.13-0.27 for k = 2-16): that history is noisy (rest days, other injuries).
- In-sample ranking quality on 2024-25 (P@1 = top-1 gains >= 4 min over the absence's first <= 5 games):

  | ranking | P@1 | P@3 | recall@3 (gain >= 6) | top-1 gain | top-3 gain | minutes MAE |
  |---|---|---|---|---|---|---|
  | full model | 0.69 | 0.57 | 0.39 | +9.0 | +6.6 | 5.9 |
  | prior only | 0.54 | 0.51 | 0.34 | +6.0 | +5.6 | 6.1 |
  | trend only | 0.65 | 0.54 | 0.34 | +7.0 | +4.6 | 6.9 |

- fp per minute: last 15 played games (+ last season at weight 0.5, <= 600 min) shrunk toward the league rate with 120
  pseudo-minutes (30-240 all tie: MAE 3.68-3.74 fp/g given the minutes).
- **Surge watch: recent minutes regress hard.** The first rule (expected minutes 0.7 x last-3 + 0.3 x last-10;
  last-3 >= Sleeper's projected minutes + 8, estimate >= 20, edge >= 5) flagged 5 league-0 free agents in 2024-25 with
  realized 16.3 fp/g vs an estimate of 22.5 (and Sleeper's next-5 projections 18.6): expected 30 min, realized 24.
  Looser variants were worse (21-68 flags, realized 8-14 fp/g vs estimates 18-22). So the expected minutes were fitted
  over all 19,391 free-agent evaluations of 2024-25 (`research/o_tune3.py`, next-5 team games, DNP = 0):
  `0.479 last3 + 0.254 last10 + 0.075 Sleeper projected min + 0.499 [Sleeper has a projection] + 1.77` (R² 0.63).
  The resulting estimate beats Sleeper's next-game projection over all evaluations (MAE 3.2 vs 4.6 fp/g, bias +0.2 vs
  +2.3). With it, a surge flag (last-3 >= Sleeper min + 6 with all 3 played, estimate >= 15, estimate >= Sleeper fp + 5)
  is rare: 1 league-0 free agent in 2024-25.

### Pre-registration (fixed before any 2025-26 outcome was computed; parameters = `OPP` in lib/live/opportunity.ts)
(a) **Detector, every 2025-26 absence** (definition above; the window = the absence's first <= 5 games; teammates with a
row in >= half the window). Realized gain = mean minutes in the window (DNP = 0) - baseline. A top-1/top-3 candidate
"gained" if realized gain >= +4 min; absorbers = teammates with realized gain >= +6. Reported: P@1, P@3, recall@3, mean
realized minutes and fp/g gain of top-1 / top-3, against all teammates, the prior-only ranking and a naive ranking
(same-position teammate with the most baseline minutes under 26); calibration of predicted vs realized minutes gain.
(b) **Lead time**: cases = top-3 candidates with realized gain >= 4 min and realized fp gain >= 3 fp/g. Sleeper caught up
at the first absence game j (up to 10) he played whose `proj_sleeper` (0 if none) - his baseline projection >= half the
realized fp gain; same in minutes with the projected minutes. Lead = j games and the days from game 0 to game j;
never within the absence = censored. The detector's own estimate at game 0 catches up if its fp gain >= half the
realized one.
(c) **Value** (task-W framework, our league, 2025-26 weeks 1-22): at each week start (1 h before the week's first tip),
alerts = top-3 replacement candidates with expected gain >= 4 min and estimate >= 15 fp/g, plus flagged surges, that
are free agents in our league that week. An absence is known at T if its run covers the team's first game after T
(proxy for an Out tag). In every week with an alert, every team adds the top alert (highest estimate) and drops the
page's cheapest unprotected player (task W's policy drop values; never age <= 23 / dynasty ADP <= 120). Primary metric:
paired real P8 points (edited - real roster), H2 = weeks w and w+1 while kept (task W's rule); also H1 = week w, the
hindsight and POLICY evaluators. 95% CI = the wider of week-clustered and team-clustered. "Value" only if the H2 P8 CI
excludes 0. **Calibration:** the Waivers page's search (task W's method "policy", N = 300) re-run with the override
(every player flagged at the decision time gets the minutes-based estimate as his projection in weeks w, w+1) vs the
same search with Sleeper's projections (task W's existing run). Better calibrated = realized minus predicted gain closer
to 0 and the realized-on-predicted slope closer to 1, for the picks (P8 and hindsight H2) and for all 18 evaluated moves
per team-week (hindsight H2).
(d) **Surge watch**, 2025-26 free agents of our league, first flag per player per 7 days, evaluated before each game
day: realized fp/g over the next 5 team games (DNP = 0) vs the estimate and Sleeper's projections; hit = realized >= 15.
