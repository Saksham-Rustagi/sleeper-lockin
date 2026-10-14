"""Paired season comparison of research/p8exp.ts real-outcome runs (NSC=0), with win% vs the real opponent.
usage (from research/out): python3 ../summ_season.py <prefix,prefix,...> <POLICY:BASELINE,...>
Win% = share of team-weeks where the policy beats the real opponent's actual (human) score, as in summ2.py."""
import glob, json, math, statistics as st, sys

pres = sys.argv[1].split(","); pairs = [x.split(":") for x in sys.argv[2].split(",")]
S = json.load(open("../data/season.json"))
human = {(W["week"], str(r)): t["human_points"] for W in S["weeks"] for r, t in W["teams"].items()}
opp = {}
for W in S["weeks"]:
    for a, b in W["matchups"]: opp[(W["week"], str(a))] = (W["week"], str(b)); opp[(W["week"], str(b))] = (W["week"], str(a))
R = {}
for pre in pres:
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f)); R.setdefault((r["week"], str(r["rid"])), {}).update({p: v["real"] for p, v in r["pols"].items()})
def win(p, keys):
    w = n = 0
    for k in keys:
        o = opp.get(k)
        if o in human: w += 1 if R[k][p] > human[o] else .5 if R[k][p] == human[o] else 0; n += 1
    return w / n
ci = lambda d: 1.96 * st.pstdev(d) / math.sqrt(len(d))
print(f"{len(R)} team-weeks")
print("| policy | pts/wk | vs | paired diff (95% CI) | weeks 1-11 | weeks 12-23 | better/worse | win% (baseline) |\n|---|---|---|---|---|---|---|---|")
for p, b in pairs:
    keys = sorted(k for k in R if p in R[k] and b in R[k])
    d = [R[k][p] - R[k][b] for k in keys]; h1 = [R[k][p] - R[k][b] for k in keys if k[0] <= 11]; h2 = [R[k][p] - R[k][b] for k in keys if k[0] >= 12]
    print(f"| {p} | {st.mean(R[k][p] for k in keys):.1f} | {b} {st.mean(R[k][b] for k in keys):.1f} | {st.mean(d):+.2f} ± {ci(d):.2f} | {st.mean(h1):+.2f} ± {ci(h1):.2f} | "
          f"{st.mean(h2):+.2f} ± {ci(h2):.2f} | {sum(x > 0 for x in d)}/{sum(x < 0 for x in d)} | {win(p, keys):.3f} ({win(b, keys):.3f}) |")
