"""Engine v2 phase 1 summary: invariant counts, monotonicity, optimality gap.
usage (from research/out):  python3 ../summ_phase1.py [inv_prefix=inv] [gap_prefix=gap] [mono7_prefix=mono7]
Prints markdown tables (pasted into research/REPORT.md) and writes mono7_tasks.txt (worst P2LAH monotonicity cases)."""
import glob, json, math, statistics as st, sys

inv_p, gap_p, m7_p = (sys.argv[1:] + ["inv", "gap", "mono7"][len(sys.argv[1:]):])[:3]
load = lambda pre: [json.load(open(f)) for f in sorted(glob.glob(f"{pre}_*_*.json"))]
INV, GAP, M7 = load(inv_p), load(gap_p), load(m7_p)
base = {}
for f in glob.glob("base_hy_*.json"):
    for r in json.load(open(f)): base[(r["week"], str(r["rid"]))] = r
ci = lambda xs: 1.96 * st.stdev(xs) / math.sqrt(len(xs)) if len(xs) > 1 else float("nan")

def merge(reps):
    c, a, ex = {}, {}, {}
    for r in reps:
        for k, v in r["counts"].items(): c[k] = c.get(k, 0) + v
        for k, v in r["amounts"].items(): a[k] = a.get(k, 0) + v
        for k, v in r["examples"].items(): ex.setdefault(k, []).extend(v)
    return c, a, ex

# ---------------- invariants ----------------
if INV:
    print(f"## invariants: {len(INV)} team-weeks")
    mism = [(r["week"], r["rid"], p, r[p]["total"], base[(r["week"], r["rid"])][p]) for r in INV for p in ("P2LAH", "P7H")
            if (r["week"], r["rid"]) in base and abs(round(r[p]["total"] * 10) / 10 - base[(r["week"], r["rid"])][p]) > 1e-9]
    print(f"instrumented totals differing from the backtest (base_hy): {len(mism)} {mism[:5]}")
    sets = {"P2LAH real": [r["P2LAH"]["rep"] for r in INV], "P7H real": [r["P7H"]["rep"] for r in INV],
            "P2LAH sim": [r["P2LAH_sim"]["rep"] for r in INV]}
    nweeks = {"P2LAH real": len(INV), "P7H real": len(INV), "P2LAH sim": sum(r["P2LAH_sim"]["n"] for r in INV)}
    if GAP:
        sets["P7H sim"] = [g["P7H_rep"] for g in GAP]; nweeks["P7H sim"] = sum(len(g["P7H"]) for g in GAP)
    M = {k: merge(v) for k, v in sets.items()}
    keys = sorted({k for c, _, _ in M.values() for k in c}, key=lambda k: ("LSFI".index(k[0]), k))
    cols = list(M)
    print("\n| check | " + " | ".join(f"{c} ({nweeks[c]} wk)" for c in cols) + " |")
    print("|---|" + "---|" * len(cols))
    for k in keys:
        cells = []
        for c in cols:
            n = M[c][0].get(k, 0); amt = M[c][1].get(k)
            cells.append("0" if not n else f"{n} ({n / nweeks[c]:.2f}/wk{'' if amt is None else f', {amt / nweeks[c]:.2f} pts/wk'})")
        print(f"| {k} | " + " | ".join(cells) + " |")
    print("\nexamples:")
    for k in keys:
        if k.startswith("I_") or k in ("F_deadline_replaced",): continue
        exs = [e for c in cols for e in M[c][2].get(k, [])[:2]]
        if exs: print(f"- {k}: " + " / ".join(exs[:3]))
    ov = sum(r["P7H"]["overrides"] for r in INV); to = sum(r["P7H"]["tipoffs"] for r in INV)
    print(f"\nP7H real: {ov} start/sit overrides in {to} tip-offs")

    # ---------------- monotonicity (P2LAH) ----------------
    drops = [(r["week"], r["rid"], d) for r in INV for d in r["mono"]["drops"]]
    n = len(drops); NM = INV[0]["mono"]["n"]
    sig = [x for x in drops if x[2]["gain"] > 3 * x[2]["se"]]
    sig05 = [x for x in sig if x[2]["gain"] > 0.5]
    print(f"\n## monotonicity P2LAH: {n} (team-week, player) drops x {NM} paired scenarios")
    print(f"drop raises E[total] by > 3 SE: {len(sig)} ({100 * len(sig) / n:.1f}%); of those > 0.5 pt: {len(sig05)}; "
          f"expected false positives at 3 SE ~ {0.00135 * n:.1f}")
    g = sorted(d["gain"] for _, _, d in drops)
    print(f"drop gain distribution: p50 {g[n // 2]:+.2f}  p90 {g[int(.9 * n)]:+.2f}  p99 {g[int(.99 * n)]:+.2f}  max {g[-1]:+.2f}")
    print("\n| team-week | dropped player | games | E[total] change if dropped (95% CI) |\n|---|---|---|---|")
    top = sorted(sig, key=lambda x: -x[2]["gain"])
    for w, r, d in top[:12]: print(f"| w{w} r{r} | {d['name']} | {d['games']} | {d['gain']:+.2f} ± {1.96 * d['se']:.2f} |")
    with open("mono7_tasks.txt", "w") as f:
        by = {}
        for w, r, d in top[:24]: by.setdefault((w, r), []).append(str(d["j"]))
        f.write(",".join(f"{w}:{r}:{'+'.join(js)}" for (w, r), js in by.items()))

# ---------------- P7H monotonicity ----------------
if M7 and GAP:
    G = {(g["week"], g["rid"]): g for g in GAP}
    I = {(r["week"], r["rid"]): {d["j"]: d for d in r["mono"]["drops"]} for r in INV}
    print("\n## monotonicity P7H (paired with gap.ts P7H runs on the same scenarios and seeds)")
    print("| team-week | dropped player | P2LAH change (1000 sc.) | P7H change (n sc.) |\n|---|---|---|---|")
    allg = []
    for m in M7:
        full = G[(m["week"], m["rid"])]["P7H"]
        for d in m["drops"]:
            diff = [a - b for a, b in zip(d["totals"], full)]; allg += diff
            p2 = I[(m["week"], m["rid"])][d["j"]]
            print(f"| w{m['week']} r{m['rid']} | {d['name']} | {p2['gain']:+.2f} ± {1.96 * p2['se']:.2f} | {st.mean(diff):+.2f} ± {ci(diff):.2f} (n={len(diff)}) |")
    print(f"pooled P7H change over these drops: {st.mean(allg):+.2f} ± {ci(allg):.2f} (n={len(allg)})")

# ---------------- gap ----------------
if GAP:
    print(f"\n## optimality gap: {len(GAP)} team-weeks")
    rows = []
    for g in GAP:
        n7 = len(g["P7H"]); p2 = g["P2LAH"]
        e2 = st.mean(p2); d7 = [a - b for a, b in zip(g["P7H"], p2[:n7])]
        rows.append(dict(w=g["week"], r=g["rid"], bound=g["bound"], free=g["free"], HS=st.mean(g["HS"]), P2LA=st.mean(g["P2LA"]), P2LAH=e2,
                         se2=st.stdev(p2) / math.sqrt(len(p2)), P7H=e2 + st.mean(d7), d7=st.mean(d7), sd7=st.stdev(d7), n7=n7,
                         P7Hraw=st.mean(g["P7H"]), real2=base.get((g["week"], g["rid"]), {}).get("P2LAH"), real7=base.get((g["week"], g["rid"]), {}).get("P7H"),
                         hsreal=base.get((g["week"], g["rid"]), {}).get("hindsight")))
    N = len(rows); m = lambda k: st.mean(x[k] for x in rows)
    # SE of the season mean of E[P7H] (control variate): independent across team-weeks
    se7 = math.sqrt(sum(x["sd7"] ** 2 / x["n7"] + x["se2"] ** 2 for x in rows)) / N
    se2 = math.sqrt(sum(x["se2"] ** 2 for x in rows)) / N
    print("\n| quantity (model expectation, per team-week) | mean | gap to bound |\n|---|---|---|")
    print(f"| no-slot-limit relaxation (mu = 0) | {m('free'):.1f} | |")
    print(f"| E[perfect hindsight] (upper bound) | {m('HS'):.1f} | |")
    print(f"| **Lagrangian bound** (upper bound) | **{m('bound'):.1f}** | 0 |")
    print(f"| E[P7H] (live; {rows[0]['n7']} sc./wk, CRN control variate) | {m('P7H'):.1f} ± {1.96 * se7:.2f} | {m('bound') - m('P7H'):.1f} ± {1.96 * se7:.2f} |")
    print(f"| E[P2LAH] (2000 sc./wk) | {m('P2LAH'):.1f} ± {1.96 * se2:.2f} | {m('bound') - m('P2LAH'):.1f} |")
    print(f"| E[P2LA] (2000 sc./wk) | {m('P2LA'):.1f} | {m('bound') - m('P2LA'):.1f} |")
    print(f"\nP7H - P2LAH under the model: {m('d7'):+.2f} ± {1.96 * math.sqrt(sum(x['sd7'] ** 2 / x['n7'] for x in rows)) / N:.2f}"
          f" (backtest on real outcomes: {st.mean(x['real7'] - x['real2'] for x in rows if x['real7'] is not None):+.2f})")
    print(f"real outcomes (backtest) for the same team-weeks: P2LAH {st.mean(x['real2'] for x in rows):.1f}, P7H {st.mean(x['real7'] for x in rows):.1f}, hindsight {st.mean(x['hsreal'] for x in rows):.1f}")
    viol = [x for x in rows if x["bound"] < x["P2LAH"] - 3 * x["se2"]]
    print(f"sanity: bound < E[P2LAH] - 3 SE in {len(viol)} team-weeks; bound > E[hindsight] in {sum(x['bound'] > x['HS'] for x in rows)}; "
          f"bound < E[P7H] estimate in {sum(x['bound'] < x['P7H'] for x in rows)} (P7H estimate noisy: per-week 95% CI ~ ±{st.mean(1.96 * math.sqrt(x['sd7'] ** 2 / x['n7'] + x['se2'] ** 2) for x in rows):.1f})")
    for key, lab in (("P2LAH", "P2LAH"), ("P7H", "P7H")):
        gp = sorted(x["bound"] - x[key] for x in rows); rel = sorted((x["bound"] - x[key]) / x["bound"] for x in rows)
        q = lambda a, p: a[min(len(a) - 1, int(p * len(a)))]
        print(f"gap bound - E[{lab}] per team-week: mean {st.mean(gp):.1f}  p10 {q(gp, .1):.1f}  p50 {q(gp, .5):.1f}  p90 {q(gp, .9):.1f}  max {gp[-1]:.1f};"
              f" relative mean {100 * st.mean(rel):.1f}%  p90 {100 * q(rel, .9):.1f}%")
    print("\n| weeks | team-weeks | bound | E[hindsight] | E[P7H] | E[P2LAH] | gap P7H | gap P2LAH |\n|---|---|---|---|---|---|---|---|")
    for a, b in ((1, 6), (7, 12), (13, 18), (19, 23)):
        sub = [x for x in rows if a <= x["w"] <= b]; mm = lambda k: st.mean(x[k] for x in sub)
        print(f"| {a}-{b} | {len(sub)} | {mm('bound'):.1f} | {mm('HS'):.1f} | {mm('P7H'):.1f} | {mm('P2LAH'):.1f} | {mm('bound') - mm('P7H'):.1f} | {mm('bound') - mm('P2LAH'):.1f} |")
    print("\nworst team-weeks by gap to P2LAH (E[P7H] with its own 95% CI):")
    print("| team-week | bound | E[hindsight] | E[P2LAH] | E[P7H] | gap P2LAH | gap P7H |\n|---|---|---|---|---|---|---|")
    for x in sorted(rows, key=lambda x: -(x["bound"] - x["P2LAH"]))[:10]:
        c7 = 1.96 * math.sqrt(x["sd7"] ** 2 / x["n7"] + x["se2"] ** 2)
        print(f"| w{x['w']} r{x['r']} | {x['bound']:.1f} | {x['HS']:.1f} | {x['P2LAH']:.1f} | {x['P7H']:.1f} ± {c7:.1f} | {x['bound'] - x['P2LAH']:.1f} | {x['bound'] - x['P7H']:.1f} |")
    print("\nsmallest gaps:")
    for x in sorted(rows, key=lambda x: (x["bound"] - x["P2LAH"]))[:5]:
        print(f"  w{x['w']} r{x['r']}: bound {x['bound']:.1f}, E[P2LAH] {x['P2LAH']:.1f}, E[P7H] {x['P7H']:.1f}")
