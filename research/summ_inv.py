"""Invariant counts per policy from research/invariants.ts main-mode outputs (several prefixes).
usage (from research/out): python3 ../summ_inv.py <prefix>:<policy>[:real|sim],...   e.g. inv4:P8,inv4:P8:sim,inv2:P7H
'real' = the policy's real-outcome run (default); 'sim' = the model-scenario run stored under P2LAH_sim."""
import glob, json, sys

cols = []
for spec in sys.argv[1].split(","):
    pre, pol, *kind = spec.split(":"); kind = kind[0] if kind else "real"
    R = [json.load(open(f)) for f in glob.glob(f"{pre}_*_*.json")]
    if kind == "sim": reps = [r["P2LAH_sim"]["rep"] for r in R]; n = sum(r["P2LAH_sim"]["n"] for r in R); lab = f"{pol} sim ({n} wk)"
    else: reps = [r[pol]["rep"] for r in R]; n = len(R); lab = f"{pol} real ({n} wk)"
    c, a = {}, {}
    for rep in reps:
        for k, v in rep["counts"].items(): c[k] = c.get(k, 0) + v
        for k, v in rep["amounts"].items(): a[k] = a.get(k, 0) + v
    ov = sum(r[pol].get("overrides", 0) for r in R) if kind == "real" else 0
    cols.append((lab, c, a, n, ov))
keys = sorted({k for _, c, _, _, _ in cols for k in c}, key=lambda k: ("LSFI".index(k[0]), k))
print("| check | " + " | ".join(l for l, *_ in cols) + " |\n|---|" + "---|" * len(cols))
print("| **L_* rule violations** | " + " | ".join(f"**{sum(v for k, v in c.items() if k.startswith('L_'))}**" for _, c, _, _, _ in cols) + " |")
for k in keys:
    cells = []
    for _, c, a, n, _ in cols:
        v = c.get(k, 0); cells.append("0" if not v else f"{v} ({v / n:.2f}/wk" + (f", {a[k] / n:.2f} pts/wk)" if k in a else ")"))
    print(f"| {k} | " + " | ".join(cells) + " |")
