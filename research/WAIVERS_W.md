# Task W: which method should the Waivers page use? (season-long waiver backtest)

*(Findings are added above this line when the runs finish. The design below was written and committed before any
result existed: commit "task W pre-registration".)*

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
