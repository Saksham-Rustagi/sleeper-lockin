"""Paired comparison on the 2024-25 synthetic-league season (research/p8exp.ts outputs, NSC=0).
usage (from research/out): python3 ../summ_s24.py <prefix,prefix,...> <POLICY:BASELINE,...> [season file] [OPP policy]
CIs: 'naive' treats the team-weeks as independent (as summ_season.py); 'week-clustered' averages each week's 30
team-weeks first (the 3 leagues share most players, so team-weeks of one week are correlated) and takes the CI over the
23 week means. Per league = rids 1-10 / 11-20 / 21-30.
Win% (no human scores in the synthetic leagues) = share of team-weeks where the policy beats the opponent's score under
the OPP policy (default P7H_LheldTie = the live bot), from the same runs; matchups from the season file
(default ../data/season2024.json)."""
import glob, json, math, statistics as st, sys

pres = sys.argv[1].split(","); pairs = [x.split(":") for x in sys.argv[2].split(",")]
R = {}
for pre in pres:
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f)); R.setdefault((r["week"], int(r["rid"])), {}).update({p: v["real"] for p, v in r["pols"].items()})
S = json.load(open(sys.argv[3] if len(sys.argv) > 3 else "../data/season2024.json")); OPP = sys.argv[4] if len(sys.argv) > 4 else "P7H_LheldTie"
opp = {}
for W in S["weeks"]:
    for a, b in W["matchups"]: opp[(W["week"], int(a))] = (W["week"], int(b)); opp[(W["week"], int(b))] = (W["week"], int(a))


def win(p, keys):
    w = [1 if R[k][p] > R[o][OPP] else .5 if R[k][p] == R[o][OPP] else 0 for k in keys for o in [opp.get(k)] if o in R and OPP in R[o]]
    return sum(w) / len(w) if w else float("nan")


ci = lambda d: 1.96 * st.stdev(d) / math.sqrt(len(d)) if len(d) > 1 else float("nan")
print(f"{len(R)} team-weeks")
print(f"| policy | pts/wk | vs | paired diff | 95% CI naive | 95% CI week-clustered | league A / B / C | weeks 1-11 / 12-23 | better/worse | win% vs opp's {OPP} (baseline) |\n|---|---|---|---|---|---|---|---|---|---|")
for p, b in pairs:
    keys = sorted(k for k in R if p in R[k] and b in R[k])
    if not keys: print(f"| {p} | - | {b} | no data |"); continue
    d = {k: R[k][p] - R[k][b] for k in keys}
    weeks = sorted({k[0] for k in keys}); wm = [st.mean(v for k, v in d.items() if k[0] == w) for w in weeks]
    m = lambda xs: st.mean(xs) if xs else float("nan")
    lg = [m([v for k, v in d.items() if (k[1] - 1) // 10 == i]) for i in range(3)]
    h1 = m([v for k, v in d.items() if k[0] <= 11]); h2 = m([v for k, v in d.items() if k[0] >= 12])
    print(f"| {p} | {st.mean(R[k][p] for k in keys):.1f} | {b} {st.mean(R[k][b] for k in keys):.1f} | {st.mean(d.values()):+.2f} | ± {ci(list(d.values())):.2f} | "
          f"± {ci(wm):.2f} | {lg[0]:+.1f} / {lg[1]:+.1f} / {lg[2]:+.1f} | {h1:+.2f} / {h2:+.2f} | {sum(x > 0 for x in d.values())}/{sum(x < 0 for x in d.values())} | {win(p, keys):.1%} ({win(b, keys):.1%}) |")
