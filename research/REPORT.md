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

> **PLACEHOLDER: gap tables pending.** The gap run (`node research/runtasks.mjs research/dist/gap.cjs gap "" N7=20`) is in
> progress. When it finishes this placeholder gets:
> - the per-policy E[value] vs bound table, gap distribution and worst team-weeks (`python3 ../summ_phase1.py` in `research/out`);
> - the P7H column of the invariant table (P7H on 20 model scenarios per team-week);
> - the P7H monotonicity check on the 24 worst P2LAH drop cases (`research/out/mono7_tasks.txt`, run in `mono7` mode after the gap run).
>
> First data point (smoke test, w7 r3):
>
> | quantity | value |
> |---|---|
> | Lagrangian bound | 320.5 |
> | E[hindsight] | 344.4 |
> | E[P7H] (12 scenarios) | ≈ 293 |
> | E[P2LAH] | 287.6 |
> | no-slot-limit relaxation | 455.6 |

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
