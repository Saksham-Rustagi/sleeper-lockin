# Engine v2 plan

Goal: the best achievable expected Lock-In score, with correctness guaranteed by checks, and a measured optimality gap.

## Why not exact DP
Full state = slots (open/locked+points/pinned) x players (free / holding X / locked) x DNP state: ~30^19 states. Infeasible.
Single-player optimal stopping IS exact (stopValue). The coupling (19 players, 9 position-constrained slots) is the hard part.

## Phase 1 - Measure (this phase): invariants + Lagrangian upper bound
1. **Invariant / rule checker** (`research/invariants.ts` + unit tests in `tests/invariants.test.ts`), run on real
   team-weeks and on simulated scenarios, for any policy (incl. hooks), reporting violation counts + examples:
   - legality: only started players lock; locks only into eligible, unpinned, open slots; no moves of pinned/locked players;
     a held score is forfeited only by an explicit choice (record why); every recommended rearrangement is reachable
     through legal Sleeper moves/swaps without passing through the bench (rule 9) - if the engine assumes an unreachable
     arrangement, count it.
   - sanity: (a) monotonicity: adding a player to the roster never lowers the expected total beyond noise (paired CRN,
     many scenarios); (b) no idle-slot benching: never sit a tipping player when his slot then stays empty for his whole
     game; (c) no dominated lock: never lock X into slot s when a strictly better legal action exists trivially (e.g. it
     is his final game and he'd count anyway with no conflict).
   Report for P2LAH and P7H.
2. **Lagrangian upper bound** on the optimal expected weekly score under the model (weakly coupled MDP relaxation;
   Hawkins 2003, Adelman & Mersereau 2008):
   - Relax "each slot holds <= 1 player at a time" with prices lambda_s(t) >= 0 per slot per time bucket.
   - Each player solves his own exact DP (his games, play-prob chain, score distribution on a grid; actions: start or not at
     each of his tip-offs; after a game hold / lock / let go; occupancy cost = min over his eligible slots of lambda_s(t)
     integrated over the time he occupies a slot: in a game, holding, or locked through week end).
   - Bound(lambda) = sum_p V_p(lambda) + sum_s integral lambda_s(t) dt  >= optimal value, for any lambda >= 0.
     Minimize over lambda (convex) with subgradient / bundle method. Validate: bound >= hindsight-free policies' simulated
     expected value always; bound <= expected perfect-hindsight value.
   - Output per team-week: bound, E[P2LAH], E[P7H] (simulated on the same model scenarios, CRN) -> optimality gap.
   This tells us how much more an algorithm can possibly win. If the gap is small, stop and work on projections.

## Phase 2 - Better base rule: Lagrangian index policy (P8)
Use the optimal prices lambda* from the bound. Decisions: each player's own DP (with prices) says start / hold / lock / let go;
conflicts at a tip-off resolved by assignment on DP advantages; prices re-solved at decision times (cheap). Backtest P8 alone
vs P2LAH, and P8 as the rollout base inside the P7 search (P9). Check invariants.

## Phase 3 - One complete decision per tip-off (P10)
At each tip-off / deadline jointly choose: for every held player hold / lock (which slot) / let go (holding INCLUDED as an
option, not banned); who starts and where; only reachable rearrangements. Candidates generated from the DP prices; scored by
rollouts with the best base rule; adaptive sampling (racing / successive halving with CRN) instead of fixed K.

## Phase 4 - Pre-game planner
Before tonight's first tip: deep search (nested rollouts allowed) producing a contingency table per decision (e.g. lock
cut-offs conditional on teammates' results), so live decisions are lookups; budget 30 min or overnight.

## Gate
Nothing replaces the live POLICY until it beats P7H (280.3) on the season backtest (paired, CI reported), shows no
invariant violations, and (Phase 1) the gap analysis is reported. Keep old policies runnable for comparison.
