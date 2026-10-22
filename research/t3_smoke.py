# Task T3: backtest smoke - the current tree with MIDGAME=1 (mid-game forfeit hook at every tip-off) vs the previous bundle.
# usage: python3 research/t3_smoke.py <prefix new> <prefix ref> <policies,comma>   (files research/out/<prefix>_<w>.json)
import json, glob, sys
new, ref, pols = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
def load(pre):
    rows = {}
    for f in glob.glob(f"research/out/{pre}_*.json"):
        for r in json.load(open(f)): rows[(r["week"], r["rid"])] = r
    return rows
A, B = load(new), load(ref)
assert A.keys() == B.keys(), "different team-weeks"
diff = 0; groups = 0; checks = 0
for k in sorted(A):
    for p in pols:
        if A[k][p] != B[k][p]: diff += 1; print("DIFF", k, p, A[k][p], B[k][p])
        mg = A[k].get(p + "_mg")
        if mg: groups += mg[0]; checks += mg[1]
print(f"{len(A)} team-weeks x {len(pols)} policies: {diff} totals differ; mid-game hook: {groups} tip-offs seen, {checks} evaluated")
for w in sorted({k[0] for k in A}):
    print(f"week {w}: " + ", ".join(f"{p} {sum(A[k][p] for k in A if k[0] == w) / sum(1 for k in A if k[0] == w):.2f} (ref {sum(B[k][p] for k in B if k[0] == w) / sum(1 for k in B if k[0] == w):.2f})" for p in pols))
