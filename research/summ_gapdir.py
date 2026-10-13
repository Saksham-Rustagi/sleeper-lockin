"""Gap summary for a directory/prefix of research/gap.ts outputs; skips malformed or partial files.
usage (from research/out): python3 ../summ_gapdir.py 'gap_oldengine/*.json'"""
import glob, json, math, statistics as st, sys

ok, bad = [], []
for f in sorted(glob.glob(sys.argv[1])):
    try:
        g = json.load(open(f))
        if all(isinstance(x, (int, float)) for x in g["P7H"]) and all(isinstance(x, (int, float)) for x in g["P2LAH"]): ok.append(g)
        else: bad.append(f)
    except Exception: bad.append(f)
print(f"{len(ok)} valid team-weeks, {len(bad)} skipped (malformed/partial): {bad[:5]}")
rows = []
for g in ok:
    e2 = st.mean(g["P2LAH"]); n = len(g["P7H"]); d = [a - b for a, b in zip(g["P7H"], g["P2LAH"][:n])]
    rows.append(dict(w=g["week"], r=g["rid"], b=g["bound"], hs=st.mean(g["HS"]), free=g["free"], p2=e2, p2la=st.mean(g["P2LA"]), p7=e2 + st.mean(d), sd7=st.stdev(d), n=n))
m = lambda k: st.mean(x[k] for x in rows)
q = lambda a, p: a[int(p * (len(a) - 1))]
se7 = math.sqrt(sum(x["sd7"] ** 2 / x["n"] for x in rows)) / len(rows)
print(f"weeks {sorted({x['w'] for x in rows})}; P7H scenarios per team-week {sorted({x['n'] for x in rows})}")
print(f"| mean per team-week | value |\n|---|---|")
for k, lab in (("free", "no-slot-limit relaxation"), ("hs", "E[perfect hindsight]"), ("b", "Lagrangian bound"), ("p7", "E[P7H] (control variate)"), ("p2", "E[P2LAH]"), ("p2la", "E[P2LA]")):
    print(f"| {lab} | {m(k):.1f}{f' ± {1.96 * se7:.1f}' if k == 'p7' else ''} |")
for k, lab in (("p2", "P2LAH"), ("p7", "P7H")):
    gp = sorted(x["b"] - x[k] for x in rows)
    print(f"gap bound - E[{lab}]: mean {st.mean(gp):.1f}, p10 {q(gp, .1):.1f}, p50 {q(gp, .5):.1f}, p90 {q(gp, .9):.1f}, max {gp[-1]:.1f}")
print(f"sanity: bound < E[P2LAH] in {sum(x['b'] < x['p2'] for x in rows)}; bound > E[hindsight] in {sum(x['b'] > x['hs'] for x in rows)}")
