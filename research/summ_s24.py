"""Paired comparison on the 2024-25 synthetic-league season (research/p8exp.ts outputs, NSC=0).
usage (from research/out): python3 ../summ_s24.py <prefix,prefix,...> <POLICY:BASELINE,...>
CIs: 'naive' treats the team-weeks as independent (as summ_season.py); 'week-clustered' averages each week's 30
team-weeks first (the 3 leagues share most players, so team-weeks of one week are correlated) and takes the CI over the
23 week means. Per league = rids 1-10 / 11-20 / 21-30."""
import glob, json, math, statistics as st, sys

pres = sys.argv[1].split(","); pairs = [x.split(":") for x in sys.argv[2].split(",")]
R = {}
for pre in pres:
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f)); R.setdefault((r["week"], int(r["rid"])), {}).update({p: v["real"] for p, v in r["pols"].items()})
ci = lambda d: 1.96 * st.stdev(d) / math.sqrt(len(d)) if len(d) > 1 else float("nan")
print(f"{len(R)} team-weeks")
print("| policy | pts/wk | vs | paired diff | 95% CI naive | 95% CI week-clustered | league A / B / C | weeks 1-11 / 12-23 | better/worse |\n|---|---|---|---|---|---|---|---|---|")
for p, b in pairs:
    keys = sorted(k for k in R if p in R[k] and b in R[k])
    if not keys: print(f"| {p} | - | {b} | no data |"); continue
    d = {k: R[k][p] - R[k][b] for k in keys}
    weeks = sorted({k[0] for k in keys}); wm = [st.mean(v for k, v in d.items() if k[0] == w) for w in weeks]
    lg = [st.mean(v for k, v in d.items() if (k[1] - 1) // 10 == i) for i in range(3)]
    h1 = st.mean(v for k, v in d.items() if k[0] <= 11); h2 = st.mean(v for k, v in d.items() if k[0] >= 12)
    print(f"| {p} | {st.mean(R[k][p] for k in keys):.1f} | {b} {st.mean(R[k][b] for k in keys):.1f} | {st.mean(d.values()):+.2f} | ± {ci(list(d.values())):.2f} | "
          f"± {ci(wm):.2f} | {lg[0]:+.1f} / {lg[1]:+.1f} / {lg[2]:+.1f} | {h1:+.2f} / {h2:+.2f} | {sum(x > 0 for x in d.values())}/{sum(x < 0 for x in d.values())} |")
