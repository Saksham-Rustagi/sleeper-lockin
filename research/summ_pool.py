"""Both seasons pooled: per season the paired diff with its week-clustered SE (weekly means of the team-week diffs),
then the inverse-variance weighted mean of the two seasons.
usage (from research/out): python3 ../summ_pool.py <2025-26 prefixes> <2024-25 prefixes> <POLICY:BASELINE,...>
e.g. python3 ../summ_pool.py s8,s9 s24,s24b P8:P7H_LheldTie,P9:P8"""
import glob, json, math, statistics as st, sys


def load(pres):
    R = {}
    for pre in pres.split(","):
        for f in glob.glob(f"{pre}_*_*.json"):
            r = json.load(open(f)); R.setdefault((r["week"], int(r["rid"])), {}).update({p: v["real"] for p, v in r["pols"].items()})
    return R


def est(R, p, b):
    keys = [k for k in R if p in R[k] and b in R[k]]
    if not keys: return None
    d = {k: R[k][p] - R[k][b] for k in keys}
    wm = [st.mean(v for k, v in d.items() if k[0] == w) for w in sorted({k[0] for k in keys})]
    return st.mean(d.values()), st.stdev(wm) / math.sqrt(len(wm)), len(keys)


A, B = load(sys.argv[1]), load(sys.argv[2])
print("| comparison | 2025-26 (real league) | 2024-25 (synthetic) | pooled (inverse variance) |\n|---|---|---|---|")
for p, b in (x.split(":") for x in sys.argv[3].split(",")):
    ea, eb = est(A, p, b), est(B, p, b)
    cell = lambda e: f"{e[0]:+.2f} ± {1.96 * e[1]:.2f} (n={e[2]})" if e else "-"
    pooled = "-"
    if ea and eb:
        wa, wb = 1 / ea[1] ** 2, 1 / eb[1] ** 2
        m = (wa * ea[0] + wb * eb[0]) / (wa + wb); se = 1 / math.sqrt(wa + wb)
        pooled = f"**{m:+.2f} ± {1.96 * se:.2f}**"
    print(f"| {p} − {b} | {cell(ea)} | {cell(eb)} | {pooled} |")
