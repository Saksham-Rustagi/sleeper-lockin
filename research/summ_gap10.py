"""Phase 3 model study: P10 / P10b vs P8, P9, P7H_LheldTie, P2LAH_LheldTie on the same 46 team-weeks x 10 model
scenarios (research/gap.ts seeds; gap4 = P8 + P9, gap5 = P2LAH_LheldTie + P7H_LheldTie, gap10 / gap10b = P10 / P10b).
usage (from research/out): python3 ../summ_gap10.py [POLICY,...]   (default: all available, on their common scenarios)
CIs are clustered by team-week (mean over its 10 scenarios first, then the CI over the 46 team-week means)."""
import glob, json, math, statistics as st

def load(pre):
    R = {}
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f)); R[(r["week"], int(r["rid"]))] = r
    return R

g4, g5, g10, g10b = load("gap4"), load("gap5"), load("gap10"), load("gap10b")
V = {}  # policy -> team-week -> list of 10 totals
for k, r in g4.items(): V.setdefault("P8", {})[k] = r["P8"][:10]; V.setdefault("P9", {})[k] = r["P7H"]
for k, r in g5.items(): V.setdefault("P7H_LheldTie", {})[k] = r["P7H"]; V.setdefault("P2LAH_LheldTie", {})[k] = r["P2LAH_LheldTie"][:10]
for name, G in (("P10", g10), ("P10b", g10b)):
    for k, r in G.items():
        V.setdefault(name, {})[k] = r["P7H"]
        if k in g4 and any(abs(a - b) > 0.051 for a, b in zip(r["P8"][:10], g4[k]["P8"][:10])): print(f"WARNING {name} {k}: P8 differs from gap4 (scenarios not the same)")
bound = {k: r["bound"] for k, r in g4.items()}
pols = [p for p in ["P10", "P10b", "P8", "P9", "P7H_LheldTie", "P2LAH_LheldTie"] if p in V]
import sys
if len(sys.argv) > 1: pols = [p for p in pols if p in sys.argv[1].split(",")]  # optional: only these policies
common = sorted(set.intersection(*(set(V[p]) for p in pols)))
ns = min(len(V[p][k]) for p in pols for k in common)  # the same scenarios for every policy (P10b ran on the first 5)
for p in pols: V[p] = {k: V[p][k][:ns] for k in common}
print(f"{len(common)} team-weeks x {ns} scenarios (common to {', '.join(pols)})")
ci = lambda xs: 1.96 * st.stdev(xs) / math.sqrt(len(xs))
print("| policy | model E | gap to bound | vs P8 | vs P9 | vs live P7H_LheldTie |\n|---|---|---|---|---|---|")
b = st.mean(bound[k] for k in common)
for p in pols:
    m = st.mean(st.mean(V[p][k]) for k in common)
    cells = []
    for q in ["P8", "P9", "P7H_LheldTie"]:
        if q == p or q not in V: cells.append("0" if q == p else "-"); continue
        d = [st.mean(a - c for a, c in zip(V[p][k], V[q][k])) for k in common]
        cells.append(f"{st.mean(d):+.2f} ± {ci(d):.2f}")
    print(f"| {p} | {m:.1f} | {b - m:.1f} | " + " | ".join(cells) + " |")
if "P10" in V and "P10b" in V:
    d = [st.mean(a - c for a, c in zip(V["P10b"][k], V["P10"][k])) for k in common]
    print(f"\nP10b - P10: {st.mean(d):+.2f} ± {ci(d):.2f}")
for name, G in (("P10", g10), ("P10b", g10b)):
    if not G: continue
    c = {}
    for r in G.values():
        for k, v in r["P7H_rep"]["counts"].items(): c[k] = c.get(k, 0) + v
    n = sum(len(r["P7H"]) for r in G.values())
    print(f"\n{name} checker on {n} model weeks: L_* {sum(v for k, v in c.items() if k.startswith('L_'))}; " + ", ".join(f"{k} {v} ({v / n:.2f}/wk)" for k, v in sorted(c.items()) if k[0] in "SF"))
