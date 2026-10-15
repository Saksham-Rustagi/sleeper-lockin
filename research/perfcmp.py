# Bit-identity check between two research/perfcheck.ts runs (before / after an optimisation), plus their timings.
# usage (from research/out): python3 ../perfcmp.py <basePrefix> <newPrefix>
# JSON numbers are printed by JS as the shortest round-trip decimal, so equal floats here = equal doubles there.
import glob, json, sys
from collections import defaultdict

base, new = sys.argv[1], sys.argv[2]
rows = 0; diffs = []; cnt = defaultdict(int); ms = defaultdict(lambda: [0.0, 0.0]); msw = defaultdict(lambda: [0.0, 0.0, 0])
for f in sorted(glob.glob(f"{base}_*.json")):
    g = f.replace(base + "_", new + "_", 1)
    try:
        a = json.load(open(f)); b = json.load(open(g))
    except FileNotFoundError:
        print("missing", g); continue
    rows += 1
    for pn, pa in a["pols"].items():
        pb = b["pols"].get(pn)
        if pb is None: diffs.append((f, pn, "missing policy")); continue
        cnt[pn] += 1 + len(pa.get("sc", []))
        if pa["real"] != pb["real"] or pa.get("locks") != pb.get("locks"): diffs.append((f, pn, "real", pa["real"], pb["real"]))
        for k, (x, y) in enumerate(zip(pa.get("sc", []), pb.get("sc", []))):
            if x != y: diffs.append((f, pn, f"sc{k}", x, y))
        ms[pn][0] += pa["ms"]; ms[pn][1] += pb["ms"]
        if "msWeek" in pa: msw[pn][0] += pa["msWeek"]; msw[pn][1] += pb["msWeek"]; msw[pn][2] += 1
print(f"{rows} team-weeks compared; totals compared per policy: {dict(cnt)}")
print(f"differences: {len(diffs)}")
for d in diffs[:20]: print("  ", d)
print("policy | real-outcome run: base s / new s (sum over team-weeks, parallel load) | speedup | model week: base ms / new ms | speedup")
for pn in ms:
    a, b = ms[pn]; s = f"{pn} | {a / 1000:.1f} / {b / 1000:.1f} | {a / b:.2f}x"
    if msw[pn][2]: x, y, n = msw[pn]; s += f" | {x / n:.1f} / {y / n:.1f} | {x / y:.2f}x"
    print(s)
