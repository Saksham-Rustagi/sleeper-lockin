"""Compute and search statistics of P10 runs (research/p10run.ts outputs).
usage (from research/out): python3 ../summ_p10.py <prefix,prefix,...> <POLICY,...> [kMax=256]
Per policy: tip-off decisions per week, how many were raced (>= 2 candidates), candidates per raced decision, scenarios
and continuations per raced decision, how often the race stopped before kMax, switches away from P8's decision (and
which kind of change), decision time per tip-off and per week (single process)."""
import glob, json, statistics as st, sys

pres = sys.argv[1].split(","); pols = sys.argv[2].split(","); kmax = int(sys.argv[3]) if len(sys.argv) > 3 else 256
R = {}
for pre in pres:
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f))
        for p, v in r["pols"].items():
            if v.get("stats"): R.setdefault(p, []).append((v["stats"], v["msFirst"]))
q = lambda xs, a: sorted(xs)[min(len(xs) - 1, int(a * len(xs)))] if xs else float("nan")
print("| policy | team-weeks | tip-off decisions/wk | raced/wk | candidates per raced | scenarios per raced: mean (p50, p90) | stopped before kMax | continuations per raced | switched/wk (kind) | ms per decision (raced) | decision s/wk | run s/wk |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
for p in pols:
    if p not in R: print(f"| {p} | no data |"); continue
    S = [s for s, _ in R[p]]; n = len(S); log = [x for s in S for x in s["log"]]
    dec = sum(s["decisions"] for s in S); raced = sum(s["raced"] for s in S); ms = sum(s["ms"] for s in S)
    why = {}
    for s in S:
        for k, v in s["why"].items(): why[k] = why.get(k, 0) + v
    ks = [x[1] for x in log]
    print(f"| {p} | {n} | {dec / n:.1f} | {raced / n:.1f} | {st.mean(x[0] for x in log):.1f} | {st.mean(ks):.0f} ({q(ks, .5)}, {q(ks, .9)}) | "
          f"{sum(k < kmax for k in ks) / len(ks):.0%} | {st.mean(x[2] for x in log):.0f} | {sum(s['switched'] for s in S) / n:.2f} "
          f"({', '.join(f'{k} {v / n:.2f}' for k, v in sorted(why.items(), key=lambda kv: -kv[1]))}) | {ms / dec:.0f} ({ms / max(1, raced):.0f}) | "
          f"{ms / n / 1000:.1f} | {st.mean(m for _, m in R[p]) / 1000:.1f} |")
