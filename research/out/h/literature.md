# Literature review: methods for the Sleeper Lock-In engine

Scope: published methods that map onto our problem, which is multiple optimal stopping coupled through 9 reusable,
position-constrained, time-windowed slots, with random per-game scores and DNP risk. For each method the note gives what
it could fix in the current stack (Lagrangian bound, P8 Lagrangian index policy, P10b per-tip-off race, P11 win objective).

Tags used below:
- **Gap**: BOUND = bound looseness; BASE = base-policy quality (Lagrangian index, prices); SEARCH = per-tip-off race
  (candidate generation, noise, winner's curse); LOOK = multi-step lookahead; COUPLE = start/sit vs lock coupling;
  WIN = win-probability objective; OPP = opponent modelling.
- **Cost**: rough live cost per decision on ~12 workers under the 9-minute watchdog.
- **Effort**: S/M/L.

Two structural facts about our problem shape most of the mapping:
1. It is a *weakly coupled* DP with only ~19 sub-problems and 9 slots. The literature's asymptotic-optimality results
   (gap/N -> 0 as the number of arms grows) give us little: at N = 19 the constant terms dominate. This fits the 8.4 pt
   Lagrangian gap we measure.
2. Each player's sub-problem is a multiple-stopping problem with a "refraction" structure: a lock consumes a slot for the
   rest of the week, and a game pins its slot for ~2.5 h. The exact same structure appears in the swing-option duality
   literature (Topic 4).

---

## 1. Multiple optimal stopping, prophet inequalities, reusable resources

**Kleinberg & Weinberg (2012). Matroid prophet inequalities. STOC 2012.** arXiv:1201.4764 — https://arxiv.org/abs/1201.4764
Threshold (price) policies get >= 1/2 of the prophet's value under one matroid constraint, and O(p) under the intersection of
p matroids. Mapping: lineup feasibility per time window is a bipartite (transversal-matroid) constraint, so slot-prices
mu_{s,b} are this kind of threshold. The guarantee (1/2) is far below what we already achieve (P10b is within a few percent of the Lagrangian bound), so its value to us is
conceptual. Gap: BASE (justifies price-based policies). Cost: negligible. Effort: S (no
build recommended).

**Alaei (2014). Bayesian combinatorial auctions: expanding single buyer mechanisms to many buyers. SIAM J. Comput. 43(2):930-972 (FOCS 2011).** arXiv:1106.0961 — https://arxiv.org/abs/1106.0961
Decomposes a multi-agent problem into single-agent sub-problems linked only by supply constraints, losing a factor
1 - 1/sqrt(k+3) for k-unit supply. This is the same "solve each player separately under prices" idea as our Lagrangian
decomposition, plus a rounding (the "magician") that keeps capacity feasible. Mapping: a provably-feasible alternative to
assignExact on priced advantages. Gap: BASE. Cost: low. Effort: M.

**Jiang, Ma & Zhang (2025). Tight guarantees for multiunit prophet inequalities and online stochastic knapsack. Operations Research 73(3):1703-1721.** doi:10.1287/opre.2022.0309; arXiv:2107.02058 — https://arxiv.org/abs/2107.02058
Gives tight k-unit prophet guarantees via an LP over online contention resolution schemes (OCRS), improving on Alaei's
bound. Mapping: an "ex-ante LP + OCRS" policy is a principled way to turn our fluid/Lagrangian solution into a feasible
online policy, an alternative to P8's argmax. Gap: BASE. Cost: low. Effort: M.

**Feldman, Svensson & Zenklusen (2016/2021). Online contention resolution schemes (SODA 2016); journal: SIAM J. Comput. 50(2):255-300.** — https://cris.haifa.ac.il/en/publications/online-contention-resolution-schemes/
Introduces OCRS: online rounding of a fractional (ex-ante) solution under matroid/knapsack/matching constraints with
constant-factor guarantees. Mapping: rounding the per-player fluid "start/lock probabilities" into slot assignments. Gap:
BASE. Effort: M.

**Dütting, Feldman, Kesselheim & Lucier (2020). Prophet inequalities made easy: stochastic optimization by pricing nonstochastic inputs. SIAM J. Comput. 49(3):540-582 (FOCS 2017).** arXiv:1612.03161 — https://arxiv.org/abs/1612.03161
Sets prices from the *deterministic* (known-values) problem and proves the price-based online algorithm extends to the
stochastic case. Mapping: suggests a cheap way to compute slot prices from sampled hindsight solutions (the dual prices of
the deterministic weekly assignment) instead of projected-Adam on the Lagrangian dual. Could serve as a warm start or a
price ensemble. Gap: BASE. Cost: low (one LP per scenario). Effort: M.

**Abels, Pitschmann & Schmand (2023). Prophet inequalities over time. EC 2023; journal version ACM TEAC 13(4), 2025.** arXiv:2211.10471 — https://arxiv.org/abs/2211.10471
The decision maker picks a value *and how long to keep it*, and cannot select again until it expires. They give a 0.396
single-threshold algorithm, about 0.598 asymptotically, and an upper bound of 1/phi. This is the closest theoretical model of
a single Lock-In slot: lock = keep for the rest of the week; hold = keep until the next tip-off. Mapping: structural
insight into the per-slot stopping problem. Our exact single-player DP already dominates it. Gap: BASE (conceptual).
Effort: S.

**Faw, Papadigenopoulos, Caramanis & Shakkottai (2022). Learning to maximize welfare with a reusable resource. Proc. ACM Meas. Anal. Comput. Syst. 6(2), Art. 27 (SIGMETRICS 2022).** doi:10.1145/3530893 — https://par.nsf.gov/biblio/10388488
One reusable resource with a blocking period: a threshold rule is asymptotically optimal at 1/2-competitive. Mapping: one
slot with game-length blocking (rule 7, slot reuse). Conceptual only. Effort: S.

**Baek & Ma (2019). Prophet inequalities on the intersection of a matroid and a graph. arXiv:1906.04899** — https://arxiv.org/abs/1906.04899
Combines dynamic matroid prices with static graph prices. Interval-scheduling constraints give d = 1, which yields the first
constant-factor prophet inequality under matroid plus interval-scheduling constraints. Mapping: our feasibility is exactly
"position matroid x time-interval overlap", so this is the closest constraint structure in the literature. Its two-price
design (dynamic per-slot, static per-time-interval) is a template for richer price structures in P8. Gap: BASE. Effort: M.

**Kleinberg (2005). A multiple-choice secretary algorithm with applications to online auctions. SODA 2005, pp. 630-631.** (Citation verified only through citing works; e.g. https://arxiv.org/abs/1507.01732)
k-choice secretary with a 1 - O(1/sqrt(k)) guarantee. Its relevance is limited because we know the distributions (prophet
setting, not secretary).

## 2. Online matching / assignment with reusable resources and deadlines; stochastic knapsack

**Dickerson, Sankararaman, Srinivasan & Xu (2018). Allocation problems in ride-sharing platforms: online matching with offline reusable resources. AAAI 2018 (journal: ACM TEAC 2021).** doi:10.1609/aaai.v32i1.11477; arXiv:1711.08345 — https://arxiv.org/abs/1711.08345
LP-based (benchmark LP over expected arrivals) policy for matching with resources that return after random occupation
times. Gets 1/2 - eps, which they show is essentially tight against that LP. Mapping: slots = reusable offline resources;
games = online arrivals with known time windows. Gap: BASE. Their "LP + randomized rounding/attenuation" is a template
for an LP-based P8 variant. Effort: M.

**Delong, Farhadi, Niazadeh, Sivan & Udwani (2024). Online bipartite matching with reusable resources. Math. Oper. Res. (doi:10.1287/moor.2022.0242).** arXiv:2110.07084 — https://arxiv.org/abs/2110.07084
Deterministic reuse duration d, adversarial arrivals, competitive ratios 0.589 / 0.505. Adversarial, so less relevant
(our distributions are known). Conceptual. Effort: S.

**Gong, Goyal, Iyengar, Simchi-Levi, Udwani & Wang (2022). Online assortment optimization with reusable resources. Management Science 68(7):4772-4785.** doi:10.1287/mnsc.2021.4134 — https://dspace.mit.edu/handle/1721.1/151589
A myopic greedy policy is 1/2-competitive against a clairvoyant benchmark with reusable capacities. Mapping: our P2-type
rule baselines. It explains why simple greedy is robust but leaves a lot on the table. Conceptual.

**Feng, Niazadeh & Saberi (2024). Technical note: near-optimal Bayesian online assortment of reusable resources. Operations Research 72(5):1861-1873.** doi:10.1287/opre.2020.0687; arXiv:2512.06997 — https://arxiv.org/abs/2512.06997
Solves an expected LP, simulates it by independent randomized rounding, and keeps inventory feasible with per-resource
discarding policies. Gets a 1 - min(1/2, sqrt(log c_min / c_min)) ratio. Mapping: "LP + rounding + per-slot discarding"
is an alternative to P8's argmax assignment. Note c_min = 1 for us (each slot has capacity 1), so the guarantee is weak.
Gap: BASE. Effort: M.
(Note: I found no Feng–Niazadeh–Saberi paper titled "online stochastic matching with reusable resources". This
technical note, and their earlier SSRN work on LP-based policies for reusable resources, are the relevant ones.)

**Rusmevichientong, Sumida & Topaloglu (2020). Dynamic assortment optimization for reusable products with random usage durations. Management Science 66(7):2820-2844.** doi:10.1287/mnsc.2019.3346 — https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2019.3346
Builds policies from linear value-function approximations (>= 50% of optimal) and *rollout on a static policy*, which is
also >= 50% and is near-optimal in their experiments. Mapping: the closest published analogue of "P10b = rollout of a
price-based policy" for reusable resources, and evidence that rollout on a decomposed policy is the right architecture.
Gap: SEARCH/BASE. Effort: n/a (validates the current design).

**Baek & Ma (2022). Technical note: bifurcating constraints to improve approximation ratios for network revenue management with reusable resources. Operations Research 70(4):2226-2236.** doi:10.1287/opre.2022.2282 — https://pubsonline.informs.org/doi/abs/10.1287/opre.2022.2282
Splits constraints into a structured (matroid-like) part and an unstructured part, each with its own control method.
Mapping: treat position eligibility (structured, bipartite) exactly and time-overlap (unstructured) with prices. That is
roughly what P8 already does. Effort: S.

**Huang, Kang, Tang, Wu, Zhang & Zhu (2020). Fully online matching. J. ACM 67(3), Art. 17.** doi:10.1145/3390890 — https://arxiv.org/abs/1810.07903
Vertices arrive *and have deadlines*, and they must be matched before they leave. Adversarial. Conceptual only.

**Kleywegt & Papastavrou (1998). The dynamic and stochastic knapsack problem. Operations Research 46(1):17-35.** doi:10.1287/opre.46.1.17 — https://pubsonline.informs.org/doi/10.1287/opre.46.1.17
Optimal accept/reject thresholds for random-reward arrivals under capacity, with optimal stopping. Mapping: the classical
single-resource "lock this game or wait" DP. Our stopValue/single-player DP generalizes it. The 1996 deadline variant
(Papastavrou, Rajagopalan & Kleywegt, Mgmt Sci) also exists. Conceptual.

## 3. Weakly coupled MDPs; Lagrangian, fluid and ALP relaxations; resolving

**Whittle (1988). Restless bandits: activity allocation in a changing world. J. Appl. Probab. 25(A):287-298.** (Citation verified through secondary sources, e.g. https://www.dpmms.cam.ac.uk/~rrw1/abstracts/w90c.html)
Lagrangian relaxation of the "exactly m active" constraint gives a per-arm index. This is the ancestor of our priced DP
advantages. Gap: BASE.

**Hawkins (2003). A Lagrangian decomposition approach to weakly coupled dynamic optimization problems and its applications. PhD thesis, MIT ORC.** — https://dspace.mit.edu/handle/1721.1/29599
Lagrangian decomposition of weakly coupled DPs: bounds from low-dimensional DPs, combined with integer programming to
build feasible policies. This is exactly our pipeline (per-player DP under mu, then assignExact). Gap: BOUND/BASE.

**Adelman & Mersereau (2008). Relaxations of weakly coupled stochastic dynamic programs. Operations Research 56(3):712-727.** doi:10.1287/opre.1070.0445 — https://pubsonline.informs.org/doi/10.1287/opre.1070.0445
Compares the Lagrangian bound with the ALP (separable value-function LP) bound. The ALP is at least as tight, and they give
column generation for it. Gap: BOUND.

**Brown & Zhang (2023). Technical note: On the strength of relaxations of weakly coupled stochastic dynamic programs. Operations Research 71(6):2374-2389.** doi:10.1287/opre.2022.2287 — https://pubsonline.informs.org/doi/10.1287/opre.2022.2287
The ALP-vs-Lagrangian gap is bounded by the integrality gap of the ALP separation problem. It is a constant independent of
the number of sub-problems under broad conditions, and **zero** when the linking constraints are state-independent and
unimodular (this covers online matching and NRM). Mapping: our linking constraint (at most one player per slot per time
bucket, with bipartite eligibility) is close to that unimodular case. **Implication: switching to an ALP is unlikely to
shrink our 8.4 pt gap materially.** The remaining looseness has to be attacked with information relaxations (Topic 4) or
history-dependent multipliers (next entry). Gap: BOUND (tells us where *not* to spend effort). Effort: S (read only).

**Brown & Zhang (2022). Dynamic programs with shared resources and signals: dynamic fluid policies and asymptotic optimality. Operations Research 70(5):3015-3033.** doi:10.1287/opre.2021.2181 — https://pubsonline.informs.org/doi/10.1287/opre.2021.2181
When an exogenous signal drives all projects, multipliers that depend only on the current signal leave a gap *linear* in
the number of projects. Multipliers must depend on the signal history (a "dynamic fluid relaxation" solved by primal-dual
iteration). Mapping: our mu_{s,b} are deterministic (open-loop) prices for the whole week, while realized scores, DNPs and
injury news act as shared signals. Re-solving at each tip-off (P8) partly fixes this. A scenario-tree (non-anticipative)
price relaxation would tighten the bound further. Gap: BOUND, BASE. Cost: offline-heavy; live is P8-like. Effort: L.

**Brown & Smith (2020). Index policies and performance bounds for dynamic selection problems. Management Science 66(7):3029-3050.** doi:10.1287/mnsc.2019.3342 — https://jimsmith.host.dartmouth.edu/wp-content/uploads/2022/04/Dynamic-Selection-Problems.pdf
Lagrangian index policies plus bounds for "select a subset each period". They are asymptotically optimal, and the
abstract stresses that **tie-breaking and mixed (randomized) policies matter a great deal**. Mapping: under optimal prices
many of our players have priced advantage ~0 (complementary slackness), so P8's tie-breaking between near-zero-advantage
start/lock choices is likely a first-order issue. It is cheap to test. Gap: BASE. Cost: none. Effort: S.

**Hu & Frazier (2017). An asymptotically optimal index policy for finite-horizon restless bandits. arXiv:1707.00205** — https://arxiv.org/abs/1707.00205
Finite-horizon Lagrangian index policy, asymptotically optimal (o(N) gap). Same family as P8. Gap: BASE.

**Zhang & Frazier (2021). Restless bandits with many arms: beating the central limit theorem. arXiv:2107.11911** — https://arxiv.org/abs/2107.11911
"Fluid-priority" policies get an O(1) gap (not O(sqrt N)) under non-degeneracy. The priority order comes from the fluid LP
solution, and the policy follows the fluid plan as closely as feasibility allows. Mapping: an alternative P8 decision rule
that tracks the fluid occupation plan instead of argmax on advantages. Gap: BASE. Effort: M.

**Gast, Gaujal & Yan (2024). Linear program-based policies for restless bandits: necessary and sufficient conditions for (exponentially fast) asymptotic optimality. Math. Oper. Res. 49(4):2468-2491.** doi:10.1287/moor.2022.0101; arXiv:2106.10067 — https://arxiv.org/abs/2106.10067
**and Gast, Gaujal & Yan, "The LP-update policy for weakly coupled Markov decision processes", arXiv:2211.01961** — https://arxiv.org/abs/2211.01961
LP-update (re-solve the finite-horizon LP at every epoch and apply its first-step solution) beats static LP-index
policies, especially under model misspecification. It is O(1/sqrt N) in general, O(1/N) under non-degeneracy. Mapping: P8
already *is* an LP-update / re-solve policy. Their results support re-solving and quantify its limits at small N. Gap:
BASE. Effort: S (already done).

**Jasin & Kumar (2012). A re-solving heuristic with bounded revenue loss for network revenue management with customer choice. Math. Oper. Res. 37(2):313-345.** doi:10.1287/moor.1120.0537 — https://pubsonline.informs.org/doi/10.1287/moor.1120.0537
**Bumpensanti & Wang (2020). A re-solving heuristic with uniformly bounded loss for network revenue management. Management Science 66(7):2993-3009.** doi:10.1287/mnsc.2019.3365; arXiv:1802.06192 — https://arxiv.org/abs/1802.06192
Re-solving the fluid LP at *every* step and applying it naively can be no better in order than never re-solving.
Re-solving at chosen times *and thresholding* the fluid solution's probabilities gives O(1) loss. Mapping: P8 re-solves at
every tip-off and acts on the argmax of priced advantages. The lesson is to (a) act deterministically on decisions the
fluid solution is confident about (prob near 0 or 1) and (b) treat fractional ones specially (P10b racing). Gap: BASE,
SEARCH (which decisions deserve rollouts). Effort: S-M.

**Vera & Banerjee (2021). The Bayesian prophet: a low-regret framework for online decision making. Management Science 67(3):1368-1391.** doi:10.1287/mnsc.2020.3624 — https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3624
Compensated coupling: the regret of any online policy against the offline (hindsight) optimum equals the sum of
"compensations" at the epochs where the policy's action disagrees with the hindsight plan. The "Bayes selector" re-solves
an offline (fluid) problem and takes the action most likely to be hindsight-optimal, which gives constant regret for
finite-type packing/matching. Mapping: a principled scoring rule for candidate actions, i.e. P(action is in the hindsight
optimum) estimated from sampled scenarios, plus a diagnostic that decomposes our gap to perfect hindsight into per-epoch
compensations. Caveat: pure hindsight voting is biased toward waiting on lock decisions. Gap: SEARCH (candidate
generation), BOUND (diagnostic). Cost: one hindsight solve per scenario. Effort: M.

**Balseiro, Brown & Chen (2021). Dynamic pricing of relocating resources in large networks. Management Science 67(7):4075-4094.** doi:10.1287/mnsc.2020.3735 — https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3735
Lagrangian decomposition across spokes for relocating (reusable) resources, with a performance bound that vanishes with
network size. They also show *no static policy* is asymptotically optimal, so dynamic (state-dependent) prices are
needed. Mapping: supports re-solved prices. Gap: BASE.

## 4. Information relaxation duality

**Brown, Smith & Sun (2010). Information relaxations and duality in stochastic dynamic programs. Operations Research 58(4-part-1):785-801.** doi:10.1287/opre.1090.0796 — https://jimsmith.host.dartmouth.edu/wp-content/uploads/2022/04/Information_Relaxations_and_Duality_in_Stochastic_Dynamic_Programs.pdf
Relax non-anticipativity and charge a penalty. Weak and strong duality hold, and with a penalty built from an approximate
value function W the dual bound is E[max over the whole week of (rewards - sum_t (W(s_{t+1}) - E[W(s_{t+1}) | s_t, a_t]))].
It is tight when W is exact. Mapping: our "perfect hindsight 317.5" is the zero-penalty bound. Penalizing it with the
*Lagrangian per-player value functions V_p(mu)* (additive, so the penalty decomposes per player and per game) keeps the
inner problem a deterministic weekly assignment, which our hindsight solver can handle with modified per-game rewards.
This gives a bound that can be tighter than both the perfect-hindsight bound (~28 pts looser) and the Lagrangian bound
(~8.4 pts above our best policy). Gap: BOUND.
Cost: offline only (one penalized hindsight solve per scenario). Effort: M.

**Ye, Zhu & Zhou (2014). Weakly coupled dynamic program: information and Lagrangian relaxations. arXiv:1405.3363** — https://arxiv.org/abs/1405.3363 (published version not verified)
Exactly the combination we need: Lagrangian-relax the linking constraints, then information-relax the sub-problems with
penalties, which gives a dual bound tighter than the Lagrangian bound. They compare several combinations. Gap: BOUND.
Effort: M.

**Brown & Smith (2011). Dynamic portfolio optimization with transaction costs: heuristics and dual bounds. Management Science 57(10):1752-1770.** doi:10.1287/mnsc.1110.1377 — https://jimsmith.host.dartmouth.edu/wp-content/uploads/2022/04/Dynamic_Portfolio_Optimization_with_Transaction_Costs.pdf
**Brown & Smith (2014). Information relaxations, duality, and convex stochastic dynamic programs. Operations Research 62(6):1394-1415.** doi:10.1287/opre.2014.1322 — https://jimsmith.host.dartmouth.edu/wp-content/uploads/2022/04/Information_Relaxations_and_Convexity.pdf
These show that penalties from *simple heuristic models* give tight bounds that prove the heuristics near-optimal. The
2014 paper shows gradient penalties can beat Lagrangian bounds (demonstrated on NRM). Mapping: use V_p(mu) or a fitted P8
value as W. Gap: BOUND.

**Brown & Smith (2022). Information relaxations and duality in stochastic dynamic programs: a review and tutorial. Foundations and Trends in Optimization 5(3):246-339.** doi:10.1561/2400000027 — https://nowpublishers.com/article/Details/OPT-027
A practical "how to" (penalty construction, variance reduction, partial relaxations). Recommended starting point.

**Brown & Haugh (2017). Information relaxation bounds for infinite horizon Markov decision processes. Operations Research 65(5):1355-1379.** doi:10.1287/opre.2017.1631 — https://pubsonline.informs.org/doi/10.1287/opre.2017.1631
Infinite-horizon extension. We are finite-horizon (one week), so it is of limited use except for its likelihood-ratio and
change-of-measure tricks. Low priority.

**Balseiro & Brown (2019). Approximations to stochastic dynamic programs via information relaxation duality. Operations Research 67(2):577-597.** doi:10.1287/opre.2018.1782 — https://pubsonline.informs.org/doi/10.1287/opre.2018.1782
Analyzes heuristic policies by their gap to (penalized) information-relaxation bounds, including stochastic knapsack,
scheduling and sequential search. Mapping: a methodology for proving our P8/P10b near-optimal, and a basis for a
"penalized-hindsight" candidate scorer. A penalized-hindsight value per candidate is an (optimistic) estimate that removes
most of the anticipativity bias of plain hindsight. Gap: BOUND, SEARCH. Effort: M.

**Rogers (2002). Monte Carlo valuation of American options. Mathematical Finance 12(3):271-286.** doi:10.1111/1467-9965.02010 — https://ideas.repec.org/a/bla/mathfi/v12y2002i3p271-286.html
**Haugh & Kogan (2004). Pricing American options: a duality approach. Operations Research 52(2):258-270.** doi:10.1287/opre.1030.0070 — https://pubsonline.informs.org/doi/10.1287/opre.1030.0070
**Andersen & Broadie (2004). Primal-dual simulation algorithm for pricing multidimensional American options. Management Science 50(9):1222-1234.** — https://business.columbia.edu/faculty/research/primal-dual-simulation-algorithm-pricing-multidimensional-american-options-0
The martingale dual for optimal stopping: an upper bound = E[max_t (payoff_t - M_t)], with M built from an approximate
value function by nested simulation (Andersen-Broadie). Mapping: per player, lock = exercise. A single player's stopping
problem is already solved exactly, so these matter for the *coupled* problem only through the next entries.

**Meinshausen & Hambly (2004). Monte Carlo methods for the valuation of multiple-exercise options. Mathematical Finance 14(4):557-583.** doi:10.1111/j.0960-1627.2004.00205.x — https://stat.ethz.ch/sfs-reports/111.html
**Bender, Schoenmakers & Zhang (2015). Dual representations for general multiple stopping problems. Mathematical Finance (arXiv:1112.2638).** — https://arxiv.org/abs/1112.2638
Duals for multiple-exercise (swing) options with **volume constraints and refraction periods**, plus Monte Carlo
confidence intervals. Mapping: our team-level problem (up to 9 "exercises" = locks, each slot blocked after use, games
blocking slots for 2.5 h) is structurally a constrained multiple-stopping problem. These duals give a second, independent
route to a tighter bound than Lagrangian. Gap: BOUND. Effort: L (position eligibility is not in their model).

**Desai, Farias & Moallemi (2012). Pathwise optimization for optimal stopping problems. Management Science 58(12):2292-2308.** doi:10.1287/mnsc.1120.1551 — https://pubsonline.informs.org/doi/10.1287/mnsc.1120.1551
Fits the value-function approximation by *minimizing the dual upper bound* (a convex program over sampled paths) and
gets better exercise policies than regression methods. Mapping: fit a terminal-value approximation for truncated rollouts
(Topic 5) by minimizing a sampled dual bound. Gap: LOOK, BOUND. Effort: M-L.

## 5. Rollout, approximate policy iteration, ranking & selection

**Bertsekas, Tsitsiklis & Wu (1997). Rollout algorithms for combinatorial optimization. J. Heuristics 3:245-262.** — https://www.mit.edu/~jnt/Papers/J066-97-rollout.pdf
**Bertsekas & Castanon (1999). Rollout algorithms for stochastic scheduling problems. J. Heuristics 5(1):89-108.** — https://dspace.mit.edu/handle/1721.1/3468
Rollout = one step of policy iteration. It improves on the base heuristic when the heuristic is "sequentially consistent
or improving" and evaluation is exact. In stochastic scheduling (quiz problem), rollout policies came close to optimal.
Mapping: P10b is exactly this, with P8 as base. The cost-improvement guarantee needs (near-)exact evaluation, so noise
handling (below) is the real issue. Gap: SEARCH, LOOK.

**Bertsekas (2019/2021). Multiagent rollout algorithms and reinforcement learning. arXiv:1910.00120;** and **Multiagent reinforcement learning: rollout and policy iteration, IEEE/CAA J. Automatica Sinica 8(2), 2021.** — https://arxiv.org/abs/1910.00120
**Bertsekas (2020). Constrained multiagent rollout and multidimensional assignment with the auction algorithm. arXiv:2002.07407** — https://arxiv.org/abs/2002.07407
"One-agent-at-a-time" rollout splits a joint decision into a sequence of component decisions (agent 1 chooses with the
others following the base policy, then agent 2 given agent 1's choice, and so on). Cost grows *linearly* in the number of
agents instead of exponentially, and the cost-improvement property is kept. The constrained version handles coupling
constraints (assignment) and uses auction prices to warm-start re-solves. **Mapping: this fits P10b's candidate-generation
gap.** Treat each "uncertain" player (lock/hold/bench, start/sit, slot) as an agent. This explores combinations P10b's ~8
complete candidates never contain, at roughly (sum of per-player alternatives) evaluations, and handles start/sit vs lock
coupling naturally. Gap: SEARCH, COUPLE. Cost: about 15-30 candidate evaluations per tip-off with racing, i.e. 1-3x
P10b. Effort: M.

**Bertsekas (2020). Rollout, policy iteration, and distributed reinforcement learning. Athena Scientific.** — https://web.mit.edu/dimitrib/www/dp_rollout_book.html
**Bertsekas (2022). Lessons from AlphaZero for optimal, model predictive, and adaptive control. Athena Scientific.** — https://web.mit.edu/dimitrib/www/abstractdp_MIT.html
Books (free PDFs). Key ideas for us: (i) **truncated rollout with a terminal cost approximation** (simulate the base policy
for k stages, then add an approximate value). This cuts variance and cost and makes multi-step lookahead affordable. (ii)
Online play = one Newton step on Bellman's equation from the offline-trained policy/value, which explains why rollout on a
good base gives large gains. (iii) Simplified and partial rollout. Gap: LOOK, SEARCH. Effort: M.

**Goodson, Thomas & Ohlmann (2017). A rollout algorithm framework for heuristic solutions to finite-horizon stochastic dynamic programs. EJOR 258(1):216-229.** doi:10.1016/j.ejor.2016.09.040 — https://ideas.repec.org/a/eee/ejores/v258y2017i1p216-229.html
**Goodson, Thomas & Ohlmann (2016). Restocking-based rollout policies for the vehicle routing problem with stochastic demand and duration limits. Transportation Science 50(2):591-607.** doi:10.1287/trsc.2015.0591 — https://pubsonline.informs.org/doi/10.1287/trsc.2015.0591
Formalizes pre-decision vs post-decision rollout and gives dominance results among rollout variants. The VRP paper shows
that a *better base policy* (restocking-optimal along a fixed route) inside rollout beats a priori-based rollout, and
that simple local search over candidates is competitive with heavier search. Mapping: the post-decision rollout variant
(evaluate the post-decision state once, reuse it across candidates sharing it) can save compute. "Improve the base, not
just the search" applies to P8. Gap: SEARCH, BASE. Effort: S-M.

**Chang, Givan & Chong (2004). Parallel rollout for online solution of partially observable Markov decision processes. Discrete Event Dynamic Systems 14(3):309-341.** doi:10.1023/B:DISC.0000028199.78776.c4 — https://scholarworks.sogang.ac.kr/item/9f189e84-3bda-4a83-af8c-e43b21120ce1
Rollout over a *set* of base policies (take the max over policies per candidate). It is no worse than every base policy in
the set. The same group introduced hindsight optimization (Topic 7). Mapping: score each P10b candidate by the max over
{P8, P8 with tie-break variant, P2LAH} continuations. This removes the dependence on one base's blind spots. Gap: SEARCH,
BASE. Cost: k-fold rollouts. Effort: S.

Ranking & selection / racing:

**Chen, Lin, Yücesan & Chick (2000). Simulation budget allocation for further enhancing the efficiency of ordinal optimization. Discrete Event Dyn. Syst. 10(3):251-270 (OCBA).** doi:10.1023/A:1008349927281 — https://www.doi.org/10.1023/A:1008349927281
**Kim & Nelson (2001). A fully sequential procedure for indifference-zone selection in simulation. ACM TOMACS 11(3):251-273 (KN procedure).** — https://www.cs.utexas.edu/~shivaram/readings/b2hd-KimNelson2001.html
**Nelson & Matejcik (1995). Using common random numbers for indifference-zone selection and multiple comparisons in simulation. Management Science 41(12):1935-1945.** doi:10.1287/mnsc.41.12.1935 — https://pubsonline.informs.org/doi/10.1287/mnsc.41.12.1935
**Frazier, Powell & Dayanik (2008). A knowledge-gradient policy for sequential information collection. SIAM J. Control Optim. 47(5):2410-2439.** doi:10.1137/070693424 — https://optimallearning.princeton.edu/Papers/Frazier%20Powell%20-%20Knowledge%20gradient%20policy.pdf
**Karnin, Koren & Somekh (2013). Almost optimal exploration in multi-armed bandits. ICML 2013, PMLR 28(3):1238-1246.** — https://proceedings.mlr.press/v28/karnin13.html (the fixed-budget algorithm in this paper is Sequential Halving; the abstract does not use that name)
**Garivier & Kaufmann (2016). Optimal best arm identification with fixed confidence. COLT 2016, PMLR 49:998-1027.** — https://arxiv.org/abs/1602.04589
**Danihelka, Guez, Schrittwieser & Silver (2022). Policy improvement by planning with Gumbel. ICLR 2022.** — https://openreview.net/forum?id=bERaNdoegnO
Mapping: P10b already uses successive halving with CRN. Specific improvements from this literature:
- KN with CRN eliminates on *paired* differences with a triangular continuation region. That is more sample-efficient than
  fixed rounds when one candidate is clearly bad, and it gives a formal indifference-zone guarantee matching our 0.5 pt rule.
- OCBA/KG allocate more scenarios to the close contenders (incumbent P8 vs the best challenger) rather than equally.
- Gumbel-style sampling without replacement plus Sequential Halving at the root is the modern recipe when the candidate set
  is large and simulations are few.
Gap: SEARCH. Cost: same or lower than now. Effort: S.

**Smith & Winkler (2006). The optimizer's curse: skepticism and postdecision surprise in decision analysis. Management Science 52(3):311-322.** doi:10.1287/mnsc.1050.0451 — https://pubsonline.informs.org/doi/10.1287/mnsc.1050.0451
Selecting the max of noisy unbiased estimates yields upward-biased value estimates. The fix is Bayesian shrinkage, or
re-estimation on independent samples. Mapping: P10b's "switch if gain > 0.5 and > 2 se" is measured on the same
scenarios used to select the winner, so it suffers exactly this bias. A **fresh confirmation batch** (re-evaluate only the
winner vs P8 on new CRN scenarios) gives an unbiased switch test. Gap: SEARCH. Cost: +1 batch. Effort: S.

## 6. MCTS for stochastic combinatorial problems

**Browne et al. (2012). A survey of Monte Carlo tree search methods. IEEE Trans. Comput. Intell. AI Games 4(1):1-43.** doi:10.1109/TCIAIG.2012.2186810 — https://ieeexplore.ieee.org/document/6145622
**Kocsis & Szepesvári (2006). Bandit based Monte-Carlo planning. ECML 2006, LNCS 4212:282-293 (UCT).** doi:10.1007/11871842_29 — https://mlanthology.org/ecmlpkdd/2006/kocsis2006ecml-bandit
**Couëtoux, Hoock, Sokolovska, Teytaud & Bonnard (2011). Continuous upper confidence trees. LION 5, Springer LNCS (double progressive widening).** — https://www.springerprofessional.de/en/continuous-upper-confidence-trees/3787306
**Kearns, Mansour & Ng (2002). A sparse sampling algorithm for near-optimal planning in large Markov decision processes. Machine Learning 49(2-3):193-208.** doi:10.1023/A:1017932429737 — https://www.cis.upenn.edu/~mkearns/teaching/cis620/papers/sparseplan.pdf
**Bubeck & Munos (2010). Open loop optimistic planning. COLT 2010, pp. 477-489.** — https://www.learningtheory.org/colt2010/papers/14Bubeck.pdf
**Lecarpentier, Infantes, Lesire & Rachelson (2018). Open loop execution of tree-search algorithms. IJCAI 2018, pp. 2362-2368.** doi:10.24963/ijcai.2018/327 — https://www.ijcai.org/proceedings/2018/327
**Silver et al. (2018). A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play. Science 362(6419):1140-1144.** doi:10.1126/science.aar6404
Mapping: our stochastic branching (continuous scores, DNPs) at each event needs double progressive widening or
open-loop/sparse-sampling trees. Decision nodes are combinatorial (lineups), so action widening must come from the
priced-advantage generator. A depth-2 tree (this tip-off x next tip-off) with P8 leaf rollouts is the realistic version.
Without a learned value function, MCTS here mostly reduces to "rollout + racing", which we already have. Gains over P10b
come only if the second-stage decision changes the first-stage ranking often. That should be measured on logged tip-off
states (depth-2 vs depth-1 rank agreement) before building anything. Gap: LOOK. Cost: about 5-20x P10b. Probably too slow for the watchdog except at
a few high-stakes nodes. Effort: L.

## 7. SAA, multistage stochastic programming, anticipatory policies

**Shapiro, Dentcheva & Ruszczyński. Lectures on Stochastic Programming: Modeling and Theory (3rd ed., SIAM, 2021).** doi:10.1137/1.9781611976595
**Kleywegt, Shapiro & Homem-de-Mello (2002). The sample average approximation method for stochastic discrete optimization. SIAM J. Optim. 12(2):479-502.** doi:10.1137/S1052623499363220 (DOI resolves; preprint https://edoc.hu-berlin.de/18452/8871)
**Pereira & Pinto (1991). Multi-stage stochastic optimization applied to energy planning. Math. Programming 52:359-375 (SDDP).** doi:10.1007/BF01582895
**Rockafellar & Wets (1991). Scenarios and policy aggregation in optimization under uncertainty. Math. Oper. Res. 16(1):119-147 (progressive hedging).** doi:10.1287/moor.16.1.119
Mapping: a week is a ~25-80-stage (tip-off groups) integer program. SDDP needs convex recourse (integer slot decisions
break it; SDDiP exists but is heavy). Progressive hedging over a scenario tree is possible offline but not within live
latency. The useful piece is **SAA statistics**: candidate optimality-gap estimates (the lower/upper bound procedure in
Kleywegt et al.) give a principled stopping rule for the race. Gap: SEARCH (statistics), BOUND. Effort: L for SP
policies; S for SAA statistics.

**Chang, Givan & Chong (2004)** (above) and **Chong, Givan & Chang (2000), "A framework for simulation-based network control via hindsight optimization", IEEE CDC 2000** (NOT directly verified; cited by the 2004 paper and by Yoon et al. 2008)
**Yoon, Fern, Givan & Kambhampati (2008). Probabilistic planning via determinization in hindsight. AAAI 2008, pp. 1010-1016.** — https://mlanthology.org/aaai/2008/yoon2008aaai-probabilistic
**Van Hentenryck & Bent (2006). Online Stochastic Combinatorial Optimization. MIT Press. ISBN 9780262220804;** and **Bent & Van Hentenryck (2004), "Regrets only! Online stochastic optimization under time constraints", AAAI 2004** — https://cdn.aaai.org/AAAI/2004/AAAI04-080.pdf
Hindsight optimization (HOP): value(action) = mean over sampled futures of the hindsight-optimal value after taking it.
*Consensus* picks the action most often in scenario optima; *regret* approximates per-action regret cheaply from one
solve per scenario. Under tight time limits consensus/regret beat full expectation. Known failure: HOP overvalues
information, which for us means over-valuing "hold and wait" (Yoon et al. give failure examples). Mapping: our hindsight
solver makes HOP cheap. Use it as a **candidate generator** for P10b (actions frequent in scenario optima, e.g. "keep
holding and bench tonight's player", the case holdYield forbids). Use it as a scorer only with Lagrangian penalties
(Topic 4). Gap: SEARCH (candidates), COUPLE. Cost: one hindsight solve per scenario. Effort: S-M.

**Powell (2019). A unified framework for stochastic optimization. EJOR 275(3):795-821.** — https://castle.princeton.edu/wp-content/uploads/2018/08/Powell-EJOR-Unified-Framework-for-Stoch-Opt-Aug-16-2018.pdf (author preprint verified; volume and pages from memory, so check them)
Four policy classes: PFA, CFA, VFA, DLA. Our stack is a DLA (rollouts) on a CFA-like base (priced assignment). A
*parametric CFA* (tune holdYield/lock thresholds or price multipliers by policy search on the backtest) is a cheap,
underrated option. Gap: BASE. Effort: S-M.

## 8. RL for combinatorial scheduling / assignment

**Bello, Pham, Le, Norouzi & Bengio (2016). Neural combinatorial optimization with reinforcement learning. arXiv:1611.09940** — https://arxiv.org/abs/1611.09940
**Kool, van Hoof & Welling (2019). Attention, learn to solve routing problems! ICLR 2019.** arXiv:1803.08475 — https://arxiv.org/abs/1803.08475
**Mazyavkina, Sviridov, Ivanov & Burnaev (2021). Reinforcement learning for combinatorial optimization: a survey. arXiv:2003.03600** (Computers & OR journal version not verified) — https://arxiv.org/abs/2003.03600
**Alomrani, Moravej & Khalil (2022). Deep policies for online bipartite matching: a reinforcement learning approach. TMLR.** arXiv:2109.10380 — https://arxiv.org/abs/2109.10380
**Kong, Liaw, Mehta & Sivakumar (2019). A new dog learns old tricks: RL finds classic optimization algorithms. ICLR 2019.** — https://mlanthology.org/iclr/2019/kong2019iclr-new/ (Mehta's authorship confirmed by mlanthology, not by the Google page)
Mapping: learned policies beat greedy baselines by 3-10% in online matching (Alomrani et al.) and rediscover primal-dual
thresholds (Kong et al.). Our base is already far stronger than greedy, and the remaining gap to the Lagrangian bound is
about 3%. The realistic use is **a learned value function** (players' remaining-week values given lineup state and prices)
as (a) a truncated-rollout terminal value and (b) a prior to prune P10b candidates. Training data are free (simulated weeks
from btcommon). Gap: LOOK, SEARCH. Cost live: ms per evaluation. Effort: L. Risk: overfitting to one season (walk-forward
discipline needed).

## 9. Fantasy-sports-specific

**Hunter, Vielma & Zaman (2016/2019). Picking winners in daily fantasy sports using integer programming. arXiv:1604.01455** — https://arxiv.org/abs/1604.01455
Builds lineups for top-heavy DFS via integer programming: maximize mean and variance with low correlation to earlier
entries, under a Gaussian model. Mapping: shows variance-seeking is optimal when the win threshold is far above the mean,
which is relevant to P11 when we are big underdogs. Gap: WIN. Effort: n/a.

**Haugh & Singal (2021). How to play fantasy sports strategically (and win). Management Science 67(1):72-92.** doi:10.1287/mnsc.2019.3528 — https://papers.ssrn.com/abstract=3393127
Explicit **opponent modelling** (Dirichlet-multinomial regression of opponents' picks) inside the lineup optimization, for
double-up and top-heavy contests. Reduced to binary quadratic programs. Mapping: the closest published analogue of our
P11 simulated-human opponent. The Dirichlet-regression idea could calibrate our opponent's lock/start behaviour from
Sleeper league history. Gap: OPP, WIN. Effort: M.

**Becker & Sun (2016). An analytical approach for fantasy football draft and lineup management. J. Quant. Anal. Sports 12(1):17-30.** doi:10.1515/jqas-2013-0009 — https://ideas.repec.org/a/bpj/jqsprt/v12y2016i1p17-30n1.html
Season-long MIP for draft plus weekly lineups. This is the only season-long start/sit OR paper I found. Its lineup model is
deterministic (point forecasts), so there is no in-week sequential structure. Gap: none directly.

**Beal, Norman & Ramchurn (2020). Optimising daily fantasy sports teams with artificial intelligence. Int. J. Comput. Sci. Sport 19(2):21-35.** doi:10.2478/ijcss-2020-0008 — https://reference-global.com/article/10.2478/ijcss-2020-0008
NFL DFS via MIP on predicted performance. Not sequential.

**Rosenof (2023-24). Improving algorithms for fantasy basketball (later retitled "Static quantification of player value for fantasy basketball"). arXiv:2307.02188** — https://arxiv.org/abs/2307.02188
Draft valuation (G-score/H-score) accounting for weekly uncertainty in H2H categories leagues. Not in-week. Relevant only
for the "uncertainty changes valuations" lesson.

- *"Newell & Easton"*: I found Easton & Newell (2019), "Are daily fantasy sports gambling?", J. Sports Analytics 5(1):35-43
  (listed on Easton's CV, https://systems.utah.edu/wp-content/uploads/2025/10/EastonfullResume.pdf). It is not an
  optimization paper. A separate stochastic-integer-programming DFS paper by S. Newell is cited by arXiv:2411.11012, but I
  could not verify its details, so it is omitted.
- **Lock-in / best-ball formats:** I found **no academic paper** on Sleeper Lock-In or any score-locking in-week format, and
  none on best-ball optimization (only practitioner content). The closest formal models are multiple-exercise (swing)
  options (Topic 4) and prophet-inequalities-over-time (Topic 1).

## 10. Risk-sensitive / target-probability objectives; competitive aspects

**Wu & Lin (1999). Minimizing risk models in Markov decision processes with policies depending on target values. J. Math. Anal. Appl. 231(1):47ff.** (Citation verified through Crossref reference lists only; no abstract fetched.)
**Kang (Boda), Filar, Lin & Spanjers (2004). Stochastic target hitting time and the problem of early retirement. IEEE Trans. Autom. Control 49(3):409-419.** — https://researchnow.flinders.edu.au/en/publications/stochastic-target-hitting-time-and-the-problem-of-early-retiremen/ (note: the first author is Boda Kang, so "Boda & Filar" in the request is this paper)
**Bäuerle & Rieder (2014). More risk-sensitive Markov decision processes. Math. Oper. Res. 39(1):105-120.** doi:10.1287/moor.2013.0601 — https://publikationen.bibliothek.kit.edu/1000039663
Maximizing P(total >= target), or a certainty equivalent, becomes an ordinary MDP once the state is **augmented with
accumulated reward** (and the remaining target). Mapping: the exact win objective needs our team score so far plus the
opponent's state in the state. This breaks the additive Lagrangian decomposition: the per-player DPs no longer separate
because the utility is nonlinear in the team total. A practical approximation: keep the decomposition for candidate
generation, and score continuations by the target utility (that is what P11's T + beta F_opp(T) does). Gap: WIN.
Effort: M (exact augmented DP is infeasible at team level).

**Chow, Tamar, Mannor & Pavone (2015). Risk-sensitive and robust decision-making: a CVaR optimization approach. NeurIPS 28:1522-1530.** — https://proceedings.neurips.cc/paper/2015/hash/64223ccf70bbb65a3a4aceac37e21016-Abstract.html
CVaR MDPs via state augmentation with a confidence level, plus approximate value iteration. Mapping: a CVaR objective is
a smoother proxy for win probability when we are favourites ("protect the floor"). Gap: WIN. Effort: M.

**Gaba, Tsetlin & Winkler (2004). Modifying variability and correlations in winner-take-all contests. Operations Research 52(3):384-395.** doi:10.1287/opre.1030.0098 — https://pubsonline.informs.org/doi/10.1287/opre.1030.0098
In a multinormal model, more variance helps when fewer than half the contestants win, and less helps otherwise. Mapping:
in a head-to-head week it is the *favourite* who should reduce variance (lock earlier, take the sure score) and the
*underdog* who should increase it (keep holding, gamble on later games). The size of the effect scales with how close the
win probability is to 50% and how much variance is still controllable. This explains why the win objective rarely beats
expected points early in the week. Gap: WIN.

**Cabral (2003). R&D competition when firms choose variance. J. Econ. Manag. Strategy 12(1):139-150.** doi:10.1111/j.1430-9134.2003.00139.x — https://ideas.repec.org/a/bla/jemstr/v12y2003i1p139-150.html
**Anderson & Cabral (2007). Go for broke or play it safe? Dynamic competition with choice of variance. RAND J. Econ. 38:593-609.** (verified via Cabral's publication list)
**Lazear & Rosen (1981). Rank-order tournaments as optimum labor contracts. J. Political Economy 89(5):841-864.** doi:10.1086/261010
**Shapley (1953). Stochastic games. PNAS 39(10):1095-1100.** doi:10.1073/pnas.39.10.1095
Dynamic contests: the laggard takes risk and the leader plays safe. Equilibrium play needs a zero-sum stochastic game
(Shapley). Mapping: our opponent cannot see our pending decisions in real time in a way that creates a meaningful game, and
human opponents are not equilibrium players. So a best response to a *modelled* opponent (P11) is the right frame. Full
game-theoretic solutions are not worth building. Gap: WIN, OPP. Effort: n/a.

---

## Shortlist (ranked) with experiment designs

All experiments: paired against P10b on the 230 team-weeks
(`node research/runpar.mjs research/dist/backtest.cjs <prefix> P10B,<NEW> 200 KS=200`, then
`python3 research/summ2.py <prefix> P10B,<NEW> P10B`). Report paired diff in pts/wk with 95% CI, win% vs real opponent,
switch rate vs P8, and decision latency p50/p95 on 12 workers. A paired per-week SD of ~4-6 pts gives a 95% CI half-width
of ~0.5-0.8 pts on 230 weeks. Gains under ~0.5 pt need either repeated outcome-resampling seeds (if btcommon supports it)
or should be judged on the mechanism diagnostics listed.

### 1. Multiagent (one-player-at-a-time) rollout as P10b's candidate generator (SEARCH, COUPLE)
*Basis: Bertsekas 2019/2020 multiagent and constrained rollout; Chang-Givan-Chong parallel rollout; KN/CRN racing.*
**Build:** at a tip-off, list the "contested" players (priced |advantage| below a threshold, or any held player with a
game tonight). That is typically 3-8 players, each with 2-4 options (lock / hold-start / hold-bench / sit / start, slot
choice resolved by assignExact). Fix an order (largest |advantage| uncertainty first). For player i, race its options with
players < i fixed at their chosen options and players > i at P8's choice, continuation by P8 (same CRN scenarios across
all comparisons). Fix the winner and move on. Final check: race the assembled joint decision vs P8's decision on a fresh
CRN batch (item 5).
**Measure:** pts/wk vs P10b; fraction of tip-offs where the final decision is outside P10b's candidate set; gains split by
decision type (lock vs start/sit vs the "hold and bench tonight" case holdYield forbids); latency.
**Expected gain:** +0.3 to +1.5 pts/wk. P10b's candidate set is generated from the same priced advantages that P8 uses,
so its blind spots are correlated with P8's. Coordinate-wise search breaks that. Rollout's cost-improvement property
carries over agent by agent. Latency is about 1-3x P10b, which fits the watchdog with 12 workers.

### 2. Truncated rollouts with a terminal value approximation, plus control variates (LOOK, SEARCH)
*Basis: Bertsekas 2022 (truncated rollout / terminal cost); Desai-Farias-Moallemi pathwise fitting; Goodson et al.
post-decision rollout.*
**Build:** stop each P8 continuation at end of day D+1 (or after k tip-off groups) and add a terminal value W(state) =
sum over players of a per-player value under current prices (the exact single-player DP value V_p(mu) is already
computed), calibrated by a fitted affine correction W' = a + b·W learned offline from full P8 rollouts (walk-forward).
Also use the untruncated P8 value of P8's own decision as a control variate for the challengers.
**Measure:** (a) offline: variance of paired candidate differences (truncated vs full) and rank agreement (Kendall tau) with
full-horizon rollouts on logged tip-off states; (b) backtest: pts/wk vs P10b at equal wall-clock, with the saved compute
spent on more candidates/scenarios, or on a depth-2 lookahead at lock decisions.
**Expected gain:** +0.2 to +1.0 pts/wk. Most rollout variance comes from games days later that rarely change the ranking
of tonight's options. Cutting it makes the 0.5 pt / 2 se switch test fire more often when it should. Risk: terminal-value
bias that differs by candidate (e.g. lock vs hold changes slot availability). Check with diagnostic (a) before any backtest.

### 3. Lagrangian-penalized information-relaxation bound, with a penalized-hindsight candidate scorer (BOUND, then SEARCH)
*Basis: Brown-Smith-Sun 2010; Ye-Zhu-Zhou 2014; Brown-Smith 2014; Balseiro-Brown 2019; Brown-Zhang 2023 (why not ALP).*
**Build (offline):** for each team-week and scenario, run the existing hindsight solver on per-game rewards minus the
martingale penalty built from the per-player Lagrangian value functions V_p(mu) (decomposes per player and game). Average
over ~200 scenarios to get an upper bound UB_IR, with SE.
**Measure:** UB_IR vs the Lagrangian bound (now ~8.4 above the best policy) and perfect hindsight. Then test a scorer variant: rank P10b
candidates by penalized-hindsight value, alone and as a tie-breaker/prior with P8 rollouts.
**Expected gain:** none directly from the bound, but it tells us whether the true remaining gap is ~8 pts or ~2-3 pts,
which decides whether items 1-2 are worth pushing further. As a scorer: 0 to +0.5 pts/wk. Brown & Smith report
penalized bounds that are often within 1-2% of good heuristics. If that happens here, it proves P10b near-optimal and lets
us stop.

### 4. Base-policy (P8) upgrades from the weakly-coupled-MDP literature (BASE)
*Basis: Brown & Smith 2020 (tie-breaking/mixing); Bumpensanti-Wang (thresholded resolving); Zhang-Frazier
(fluid-priority); Brown-Zhang 2022 (history-dependent multipliers); Chang-Givan-Chong (parallel rollout).*
**Build:** three cheap P8 variants. (a) **tie-break**: among choices with |priced advantage| < eps, break ties by un-priced
expected points or by the single-player stopValue margin rather than index order. (b) **thresholded resolve**: keep the
previous tip-off's prices unless the state has drifted (a DNP, or a big score on a held player), which reduces churn.
(c) **fluid-priority**: follow the fluid occupation plan's ordering. Then rerun P10b with the best variant as its base,
and test "parallel rollout" = max over {P8, best variant} continuations.
**Measure:** P8 variants vs P8 (pts/wk), then P10b(base = variant) vs P10b.
**Expected gain:** +0.2 to +1.0 pts/wk for P8. Roughly half of that transfers to P10b, since rollout gains and base gains
are partly substitutes. Very cheap (S effort, no latency cost), so it is ranked above riskier builds of similar size.

### 5. Winner's-curse-aware racing (SEARCH)
*Basis: Smith & Winkler 2006; Kim & Nelson 2001; Nelson & Matejcik 1995; OCBA/KG; Gumbel/Sequential Halving.*
**Build:** (a) after the race picks a challenger, re-evaluate challenger vs P8 on a fresh, independent CRN batch (e.g. 64-128
scenarios) and apply the 0.5 pt / 2 se test on *that batch only*. (b) Replace fixed halving rounds with KN-style paired
elimination plus OCBA allocation focused on incumbent vs best challenger. (c) Calibrate the switch threshold by
backtest: switch-gain realized vs predicted.
**Measure:** predicted vs realized gain of switches (calibration slope; it should be ~1, and the curse shows as < 1),
pts/wk vs P10b, latency.
**Expected gain:** +0.1 to +0.5 pts/wk, with lower variance of outcomes. It also makes items 1-2 safe: larger candidate sets
strengthen the winner's curse, so this should ship together with item 1.

Not shortlisted (reasons): full MCTS (cost about 5-20x for an effect we expect to be rare); SDDP/progressive hedging (integer
recourse, latency); end-to-end RL policies (large effort, weak expected margin over a near-bound base; a learned value
function is folded into item 2 instead); exact target-probability DP (breaks the decomposition). For WIN, the cheapest
literature-backed tweak is a lead-dependent variance preference only in the last ~2 days (Gaba-Tsetlin-Winkler;
Anderson-Cabral): favourite = prefer locking, underdog = prefer holding. It can be tested as a P11 beta schedule at no
latency cost.

---

## Verification log

S = verified by web search result showing bibliographic record or abstract; F = fetched the page; C = verified only through
citing works / reference lists; U = not verified.

| Citation | How verified |
|---|---|
| Kleinberg & Weinberg 2012 | S (Princeton record, arXiv 1201.4764) |
| Alaei 2014 / FOCS 2011 | S (arXiv 1106.0961, abstract and SICOMP note) |
| Jiang, Ma & Zhang 2025 | S (INFORMS DOI, arXiv); SODA 2022 venue not confirmed |
| Feldman, Svensson & Zenklusen | S (CRIS records; SICOMP 50(2)) |
| Dütting et al. 2020 | S (arXiv, LSE record) |
| Abels, Pitschmann & Schmand 2023 | S + F (arXiv abstract page fetched) |
| Faw et al. 2022 | S (NSF PAR record with DOI) |
| Baek & Ma 2019 (prophet, matroid x graph) | F (arXiv abstract fetched) |
| Kleinberg 2005 SODA | C (cited with pages 630-631 in several arXiv papers) |
| Dickerson et al. 2018 | S (AAAI OJS, arXiv) |
| Delong et al. (MOR) | S (arXiv 2110.07084, INFORMS DOI) |
| Gong et al. 2022 | S (MIT DSpace; author list corrected: Gong, Goyal, Iyengar, Simchi-Levi, Udwani, Wang) |
| Feng, Niazadeh & Saberi 2024 | S (INFORMS DOI, arXiv) |
| Rusmevichientong, Sumida & Topaloglu 2020 | S (INFORMS DOI) |
| Baek & Ma 2022 (bifurcating) | S (IDEAS, INFORMS DOI) |
| Huang et al. 2020 JACM | S (arXiv, HKU record) |
| Kleywegt & Papastavrou 1998 | S (IDEAS, INFORMS) |
| Whittle 1988 | C (secondary sources consistent on JAP 25A:287-298) |
| Hawkins 2003 thesis | S (MIT DSpace) |
| Adelman & Mersereau 2008 | S (INFORMS, Chicago Booth page) |
| Brown & Zhang 2023 (strength of relaxations) | S (INFORMS DOI, IDEAS) |
| Brown & Zhang 2022 (shared signals) | S (INFORMS DOI, IDEAS) |
| Brown & Smith 2020 | S (author PDF, INFORMS DOI) |
| Hu & Frazier 2017 | S (arXiv) |
| Zhang & Frazier 2021 | S (arXiv 2107.11911); journal version not confirmed |
| Gast, Gaujal & Yan (MOR 2024; arXiv 2211.01961) | S (arXiv, IDEAS) |
| Jasin & Kumar 2012 | S (INFORMS DOI, IDEAS) |
| Bumpensanti & Wang 2020 | S (arXiv, INFORMS DOI) |
| Vera & Banerjee 2021 | S (INFORMS DOI, Banerjee page) |
| Balseiro, Brown & Chen 2021 | S (INFORMS DOI, IDEAS) |
| Brown, Smith & Sun 2010 | S (author PDF, DukeSpace) |
| Ye, Zhu & Zhou 2014 | S (arXiv 1405.3363); journal version U |
| Brown & Smith 2011 | S (author PDF, INFORMS) |
| Brown & Smith 2014 | S (author PDF, INFORMS) |
| Brown & Smith 2022 FnT | S (now publishers page) |
| Brown & Haugh 2017 | S (INFORMS DOI, Optimization Online) |
| Balseiro & Brown 2019 | S (Duke scholars, SUFE listing with DOI) |
| Rogers 2002 | S (IDEAS) |
| Haugh & Kogan 2004 | S (INFORMS, IDEAS) |
| Andersen & Broadie 2004 | S (Columbia page, IAOR) |
| Meinshausen & Hambly 2004 | S (ORA Oxford, ETH report) |
| Bender, Schoenmakers & Zhang | S (arXiv 1112.2638); Math. Finance volume/year not confirmed |
| Desai, Farias & Moallemi 2012 | S (INFORMS, IDEAS) |
| Bertsekas, Tsitsiklis & Wu 1997 | S (MIT PDF) |
| Bertsekas & Castanon 1999 | S (IAOR, MIT DSpace) |
| Bertsekas multiagent rollout 2019/2021 | S (arXiv 1910.00120, IEEE JAS listing) |
| Bertsekas constrained multiagent rollout 2020 | S (arXiv 2002.07407) |
| Bertsekas 2020 book; 2022 book | S (author pages) |
| Goodson, Thomas & Ohlmann 2017 EJOR | S (IDEAS, Iowa repository) |
| Goodson, Thomas & Ohlmann 2016 TS | S (INFORMS DOI, IDEAS) |
| Chang, Givan & Chong 2004 | S (Sogang repository with DOI, dblp) |
| Chong, Givan & Chang 2000 CDC (hindsight optimization) | C/U: cited by later papers, the record itself was not found |
| Yoon et al. 2008 | S (mlanthology) |
| Van Hentenryck & Bent 2006 book; Bent & VH 2004 AAAI | S (publisher listings; AAAI PDF) |
| Chen, Lin, Yücesan & Chick 2000 | S (DOI record, reference lists) |
| Kim & Nelson 2001 | S (bibliographic page, WSC papers) |
| Nelson & Matejcik 1995 | S (IDEAS, INFORMS) |
| Frazier, Powell & Dayanik 2008 | S (Princeton PDF, listing) |
| Karnin, Koren & Somekh 2013 | F (PMLR page fetched; "Sequential Halving" name not in abstract, from my knowledge of the paper) |
| Garivier & Kaufmann 2016 | S (PMLR, arXiv) |
| Danihelka et al. 2022 | S (ICLR/OpenReview, mlanthology); Sequential Halving use via a secondary description |
| Smith & Winkler 2006 | S (Duke records, gwern PDF) |
| Browne et al. 2012 | S (IEEE, Maastricht) |
| Kocsis & Szepesvári 2006 | S (mlanthology, ualberta) |
| Couëtoux et al. 2011 | S (Springer chapter listing, AMiner) |
| Kearns, Mansour & Ng 2002 | S (Penn PDF, DOI) |
| Bubeck & Munos 2010 | S (COLT PDF, mlanthology) |
| Lecarpentier et al. 2018 | S (IJCAI proceedings) |
| Silver et al. 2018 | S (UCL Discovery, DOI) |
| Shapiro, Dentcheva & Ruszczyński (3rd ed.) | S (library catalogues) |
| Kleywegt, Shapiro & Homem-de-Mello 2002 | F (DOI resolves to SIAM, page 403); vol/pages from citing works; preprint S |
| Pereira & Pinto 1991 | S (IAOR, SDDP review) |
| Rockafellar & Wets 1991 | S (INFORMS, IIASA) |
| Powell 2019 EJOR | S (author preprint); volume/pages U (from memory) |
| Bello et al. 2016 | S (arXiv) |
| Kool et al. 2019 | S (arXiv, ICLR) |
| Mazyavkina et al. | S (arXiv); C&OR 2021 journal version U |
| Alomrani, Moravej & Khalil 2022 | S (arXiv, mlanthology TMLR) |
| Kong et al. 2019 | S (ICLR, mlanthology); author list differs between sources |
| Hunter, Vielma & Zaman | S (arXiv) |
| Haugh & Singal 2021 | S (SSRN, SUFE listing with DOI) |
| Becker & Sun 2016 | S (IDEAS, ASA magazine) |
| Beal, Norman & Ramchurn 2020 | S (journal page) |
| Rosenof 2023 | S (arXiv) |
| Easton & Newell 2019 | C (author CV only); "Newell & Easton" optimization paper U, omitted |
| Wu & Lin 1999 | C (Crossref reference lists only) |
| Kang, Filar, Lin & Spanjers 2004 | S (Flinders, UTS records) |
| Bäuerle & Rieder 2014 | S (KIT repository, INFORMS) |
| Chow et al. 2015 | S (NeurIPS proceedings) |
| Gaba, Tsetlin & Winkler 2004 | S (INFORMS, Duke) |
| Cabral 2003 | S (IDEAS); Anderson & Cabral 2007 S (Cabral's publication list) |
| Lazear & Rosen 1981 | S (NBER, IDEAS) |
| Shapley 1953 | S (PubMed) |

Requested items I could not find as named: "Feng, Niazadeh, Saberi — online stochastic matching with reusable
resources" (closest real works listed in Topics 1-2); "prophet inequality with reusable resources" as an exact title
(closest: Faw et al. 2022; Abels et al. 2023; Baek & Ma 2019); any paper on Lock-In or best-ball in-week formats (none
found).
