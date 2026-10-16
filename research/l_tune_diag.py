"""Task L tuning diagnostics for the picked rule (confirm 128, gate 0.25, any kind, mean > 0): what the confirmation adds
over simply lowering the race's threshold (switch whenever race gain > gate, no confirmation), and how well the
confirmation separates good from bad challengers (truth = mean of fresh scenarios 256-511).
usage: python3 -E research/l_tune_diag.py"""
import glob, json, math, statistics as st
W = []
for pre in ["l/t25", "l/t24"]:
    for f in sorted(glob.glob(f"research/out/{pre}_*_*.json")):
        for w in json.load(open(f))["worlds"]: W.append(w["probe"])
n = len(W)
def week(rule):
    per = [sum(e["T"] for e in P if rule(e)) for P in W]; return st.mean(per), 1.96 * st.stdev(per) / math.sqrt(n)
for P in W:
    for e in P:
        e["T"] = sum(e["d"][256:]) / 256; e["C"] = sum(e["d"][:128]) / 128
cand = lambda e: not e["acc"] and e["m"] > 0.25
for lab, rule in [("no confirmation: switch every challenger with race gain > 0.25", cand),
                  ("no confirmation, race gain > 0.5", lambda e: not e["acc"] and e["m"] > 0.5),
                  ("**picked: race gain > 0.25 and confirmation mean > 0**", lambda e: cand(e) and e["C"] > 0),
                  ("the confirmation's rejects (race gain > 0.25, confirmation mean <= 0)", lambda e: cand(e) and e["C"] <= 0)]:
    m, c = week(rule); k = sum(1 for P in W for e in P if rule(e)) / n
    T = [e["T"] for P in W for e in P if rule(e)]
    print(f"| {lab} | {k:.2f} | {st.mean(T):+.3f} | {m:+.2f} ± {c:.2f} |")
# calibration: confirmation mean vs truth, binned
es = [e for P in W for e in P if cand(e)]
print("\n| confirmation mean | n | truth mean |\n|---|---|---|")
for lo, hi in [(-99, -1), (-1, 0), (0, 0.5), (0.5, 1), (1, 2), (2, 99)]:
    b = [e["T"] for e in es if lo < e["C"] <= hi]
    if b: print(f"| {lo}..{hi} | {len(b)} | {st.mean(b):+.3f} ± {1.96 * st.stdev(b) / math.sqrt(len(b)) if len(b) > 1 else 0:.3f} |")
