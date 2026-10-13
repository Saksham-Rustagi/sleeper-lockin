"""Paired season comparison across backtest output prefixes (merged by team-week).
usage (from research/out): python3 ../summ_fix.py <prefix,prefix,...> <POLICY:BASELINE,...>
e.g. python3 ../summ_fix.py fix_p2,fix_P7H,fix_P7H_L P2LAH:P2LAH_L,P7H:P7H_L,P7H_L:P2LAH_L
Win% = share of team-weeks where the policy's score beats the real opponent's actual (human) score (as summ2.py)."""
import glob, json, math, statistics as st, sys

pres = sys.argv[1].split(","); pairs = [x.split(":") for x in sys.argv[2].split(",")]
S = {}
for pre in pres:
    for f in glob.glob(f"{pre}_*.json"):
        for r in json.load(open(f)):
            S.setdefault((r["week"], str(r["rid"])), {}).update(r)
def win(p, keys):
    w = n = 0
    for k in keys:
        r = S[k]; o = (k[0], str(r["opp"])) if r.get("opp") else None
        if o in S: w += 1 if r[p] > S[o]["human"] else .5 if r[p] == S[o]["human"] else 0; n += 1
    return w / n if n else float("nan")
ci = lambda d: 1.96 * st.pstdev(d) / math.sqrt(len(d))
print("| policy | pts/wk | vs | paired diff (95% CI) | weeks 1-11 | weeks 12-23 | better/worse weeks | win% vs real opp | locks/wk | s/wk |")
print("|---|---|---|---|---|---|---|---|---|---|")
for p, b in pairs:
    keys = sorted(k for k, r in S.items() if p in r and b in r)
    d = [S[k][p] - S[k][b] for k in keys]
    h1 = [S[k][p] - S[k][b] for k in keys if k[0] <= 11]; h2 = [S[k][p] - S[k][b] for k in keys if k[0] >= 12]
    up = sum(x > 0 for x in d); dn = sum(x < 0 for x in d)
    print(f"| {p} | {st.mean(S[k][p] for k in keys):.1f} | {b} {st.mean(S[k][b] for k in keys):.1f} | {st.mean(d):+.2f} ± {ci(d):.2f} | "
          f"{st.mean(h1):+.2f} ± {ci(h1):.2f} | {st.mean(h2):+.2f} ± {ci(h2):.2f} | {up}/{dn} | {win(p, keys):.3f} (vs {win(b, keys):.3f}) | "
          f"{st.mean(S[k].get(p + '_locks', 0) for k in keys):.2f} | {st.mean(S[k].get(p + '_ms', 0) for k in keys) / 1000:.1f} |")
print(f"({len(S)} team-weeks; humans {st.mean(r['human'] for r in S.values()):.1f}, hindsight {st.mean(r['hindsight'] for r in S.values()):.1f})")
