"""Phase-2 gap study: E[P8], E[P8f] (gap3) paired with gap2 (same 2000 model scenarios per team-week: bound,
E[P2LAH], E[P7H] on the first 20, E[hindsight]); optional subset files (gap4: P8 and P9 on the first 10, gap5: live
P2LAH_LheldTie and P7H_LheldTie on the same 10). usage (from research/out): python3 ../summ_gap8.py"""
import glob, json, math, statistics as st

load = lambda pre: {(g["week"], g["rid"]): g for g in map(lambda f: json.load(open(f)), glob.glob(f"{pre}_*_*.json"))}
G2, G3, G4, G5 = load("gap2"), load("gap3"), load("gap4"), load("gap5")
keys = sorted(set(G2) & set(G3)); N = len(keys)
rows = []
for k in keys:
    a, b = G2[k], G3[k]; n7 = len(a["P7H"])
    p2 = st.mean(a["P2LAH"]); d7 = [x - y for x, y in zip(a["P7H"], a["P2LAH"][:n7])]
    d82 = [x - y for x, y in zip(b["P8"], a["P2LAH"])]; d87 = [x - y for x, y in zip(b["P8"][:n7], a["P7H"])]
    rows.append(dict(k=k, bound=b["bound"], hs=st.mean(a["HS"]), p2=p2, p7=p2 + st.mean(d7), p8=st.mean(b["P8"]), p8f=st.mean(b["P8f"]),
                     d82=st.mean(d82), v82=st.variance(d82) / len(d82), d87=st.mean(d87), v87=st.variance(d87) / n7))
m = lambda key: st.mean(r[key] for r in rows)
print(f"{N} team-weeks (gap2 x gap3, 2000 scenarios each; P7H on the first 20)")
print("| quantity (model, mean per team-week) | value | gap to bound |\n|---|---|---|")
print(f"| E[perfect hindsight] | {m('hs'):.1f} | |\n| **Lagrangian bound** | **{m('bound'):.1f}** | 0 |")
for key, lab in (("p8", "E[P8]"), ("p8f", "E[P8f]"), ("p7", "E[P7H] (all Phase-1 fixes, 20 sc.)"), ("p2", "E[P2LAH] (all Phase-1 fixes)")):
    print(f"| {lab} | {m(key):.1f} | {m('bound') - m(key):.1f} |")
print(f"P8 - P2LAH (2000 paired sc.): {m('d82'):+.2f} +- {1.96 * math.sqrt(sum(r['v82'] for r in rows)) / N:.2f}")
print(f"P8 - P7H (20 paired sc.):     {m('d87'):+.2f} +- {1.96 * math.sqrt(sum(r['v87'] for r in rows)) / N:.2f}")
for key, lab in (("p8", "P8"), ("p8f", "P8f"), ("p7", "P7H"), ("p2", "P2LAH")):
    g = sorted(r["bound"] - r[key] for r in rows)
    print(f"gap bound - E[{lab}]: mean {st.mean(g):.1f}, p10 {g[int(.1 * N)]:.1f}, p50 {g[N // 2]:.1f}, p90 {g[int(.9 * N)]:.1f}, max {g[-1]:.1f}")
print(f"share of the P2LAH->bound gap closed: P8 {100 * (m('p8') - m('p2')) / (m('bound') - m('p2')):.0f}%, P7H {100 * (m('p7') - m('p2')) / (m('bound') - m('p2')):.0f}%")
print(f"sanity: bound < E[P8] in {sum(r['bound'] < r['p8'] for r in rows)} team-weeks")
print("| weeks | team-weeks | bound | E[P8] | E[P7H] | E[P2LAH] | gap P8 | gap P7H |\n|---|---|---|---|---|---|---|---|")
for lo, hi in ((1, 6), (7, 12), (13, 18), (19, 23)):
    sub = [r for r in rows if lo <= r["k"][0] <= hi]; mm = lambda key: st.mean(r[key] for r in sub)
    print(f"| {lo}-{hi} | {len(sub)} | {mm('bound'):.1f} | {mm('p8'):.1f} | {mm('p7'):.1f} | {mm('p2'):.1f} | {mm('bound') - mm('p8'):.1f} | {mm('bound') - mm('p7'):.1f} |")
# subset: P8, P9 (gap4), live P7H_LheldTie and P2LAH_LheldTie (gap5) on the same first 10 scenarios
sk = sorted(set(G4) & set(G5) & set(G3))
if sk:
    n = len(G4[sk[0]]["P7H"])
    def col(get): return [x for k in sk for x in get(k)]
    P8 = col(lambda k: G3[k]["P8"][:n]); P9 = col(lambda k: G4[k]["P7H"]); L7 = col(lambda k: G5[k]["P7H"]); L2 = col(lambda k: G5[k]["P2LAH_LheldTie"][:n])
    B = st.mean(G3[k]["bound"] for k in sk)
    cl = lambda a, b: [st.mean(a[i * n:(i + 1) * n]) - st.mean(b[i * n:(i + 1) * n]) for i in range(len(sk))]  # per team-week (clustered)
    ci = lambda d: 1.96 * st.pstdev(d) / math.sqrt(len(d))
    print(f"\nsubset: {len(sk)} team-weeks x {n} paired scenarios (bound {B:.1f})")
    print("| policy | model E | gap to bound | vs live P7H_LheldTie (95% CI) |\n|---|---|---|---|")
    for lab, v in (("P9 (P8 + rollouts)", P9), ("P8", P8), ("live P7H_LheldTie", L7), ("P2LAH_LheldTie", L2)):
        d = cl(v, L7); print(f"| {lab} | {st.mean(v):.1f} | {B - st.mean(v):.1f} | {st.mean(d):+.2f} +- {ci(d):.2f} |")
    d = cl(P9, P8); print(f"P9 - P8: {st.mean(d):+.2f} +- {ci(d):.2f}")
