"""Summarise research/p8exp.ts outputs: model-scenario means (paired vs a baseline), real-outcome means, cost.
usage (from research/out): python3 ../summ_exp.py <prefix> <baseline policy>"""
import glob, json, math, statistics as st, sys

pre, base = sys.argv[1], sys.argv[2]
R = [json.load(open(f)) for f in sorted(glob.glob(f"{pre}_*_*.json"))]
pols = list(R[0]["pols"])
print(f"{len(R)} team-weeks x {len(R[0]['pols'][base]['sc'])} scenarios")
print("| policy | model E[total] | vs base (95% CI) | real outcomes | vs base (95% CI) | ms / sim. week | first-run ms |\n|---|---|---|---|---|---|---|")
for p in pols:
    d = [a - b for r in R for a, b in zip(r["pols"][p]["sc"], r["pols"][base]["sc"])]
    # CI by team-week clusters (scenarios within a team-week share prices)
    cl = [st.mean(a - b for a, b in zip(r["pols"][p]["sc"], r["pols"][base]["sc"])) for r in R]
    dr = [r["pols"][p]["real"] - r["pols"][base]["real"] for r in R]
    m = st.mean(x for r in R for x in r["pols"][p]["sc"])
    print(f"| {p} | {m:.2f} | {st.mean(d):+.2f} ± {1.96 * st.pstdev(cl) / math.sqrt(len(cl)):.2f} | {st.mean(r['pols'][p]['real'] for r in R):.1f} | "
          f"{st.mean(dr):+.2f} ± {1.96 * st.pstdev(dr) / math.sqrt(len(dr)):.2f} | {st.mean(r['pols'][p]['msWeek'] for r in R):.2f} | {st.mean(r['pols'][p]['msFirst'] for r in R):.0f} |")
