"""Task L, exploratory (written after the season results): do P10c's extra switches pay on real outcomes?
Per team-week: d = P10c - P10b (real total) and c = decisions the confirmation changed (switches added).
- slope of d on c (pts per added switch; OLS through the origin, week-clustered bootstrap CI), vs the model's +0.38;
- first changed decision: until it, both runs face identical states, so a team-week's d is the realized effect of
  that change plus everything after it; mean d by the confirmation's estimate at the first change.
usage (from research/out): python3 -E ../summ_l_diag.py"""
import glob, json, math, random, statistics as st

def load(pre, pol):
    R = {}
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f))
        if pol in r["pols"]: R[(r["week"], int(r["rid"]))] = r["pols"][pol]
    return R
rows = []
for name, cpre, bpre in [("2025-26", "l/v25", "s10"), ("2024-25", "l/v24", "s24p10b")]:
    C, B = load(cpre, "P10c"), load(bpre, "P10b")
    for k in set(C) & set(B):
        log = C[k]["stats"]["log"]; first = next((x for x in log if x[11] == 1), None)
        rows.append((name, k, C[k]["real"] - B[k]["real"], C[k]["stats"]["confSwitch"], first))
def slope(rs):
    sxy = sum(d * c for _, _, d, c, _ in rs); sxx = sum(c * c for _, _, d, c, _ in rs); return sxy / sxx if sxx else float("nan")
for name in ["2025-26", "2024-25", "both"]:
    rs = [r for r in rows if name == "both" or r[0] == name]
    if not rs: continue
    weeks = sorted({(r[0], r[1][0]) for r in rs}); byw = {w: [r for r in rs if (r[0], r[1][0]) == w] for w in weeks}
    random.seed(1); bs = []
    for _ in range(2000):
        s = [r for w in random.choices(weeks, k=len(weeks)) for r in byw[w]]; bs.append(slope(s))
    bs.sort(); b = slope(rs)
    print(f"{name}: {len(rs)} team-weeks, {st.mean(r[3] for r in rs):.2f} switches added/wk, P10c-P10b {st.mean(r[2] for r in rs):+.2f}; "
          f"pts per added switch {b:+.2f} (95% CI {bs[50]:+.2f} .. {bs[1949]:+.2f}); model predicted +0.38")
    print("| confirmation mean at the first added switch | team-weeks | P10c - P10b (mean ± 95% CI) |\n|---|---|---|")
    for lo, hi in [(0, 0.5), (0.5, 1), (1, 2), (2, 99)]:
        ds = [r[2] for r in rs if r[4] and lo < r[4][9] <= hi]
        if len(ds) > 1: print(f"| {lo}..{hi if hi < 99 else ''} | {len(ds)} | {st.mean(ds):+.2f} ± {1.96 * st.stdev(ds) / math.sqrt(len(ds)):.2f} |")
    ds = [r[2] for r in rs if not r[4]]
    if len(ds) > 1: print(f"| (no added switch) | {len(ds)} | {st.mean(ds):+.2f} ± {1.96 * st.stdev(ds) / math.sqrt(len(ds)):.2f} |")
