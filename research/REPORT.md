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
