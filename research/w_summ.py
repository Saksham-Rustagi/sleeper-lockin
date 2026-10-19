"""Task W summary: real-outcome value of each waiver method's picks (research/WAIVERS_W.md).
usage: python3 -I research/w_summ.py [out.json]   (reads research/out/w/w25*, w24*)
Per team-week decision and method: H2 = edited - unedited real P8 points over weeks w, w+1; ROS = the same over weeks
w..23 while the pickup is kept (real roster still has the drop, still lacks the add); ROSp = ROS with weeks 18+ x2.
CIs: naive (decisions independent), week-clustered (decision week), team-clustered; gate uses the wider of the last
two. Pooled = inverse-variance mean of the two seasons."""
import json, glob, math, sys, statistics as st, collections, os

OUT = "research/out/w"
SEASONS = {"2025-26": ("w25", "research/data/season.json", "research/data/w/all2025.json"),
           "2024-25": ("w24", "research/data/season2024.json", "research/data/w/all2024.json")}
METHODS = ["policy", "p8f", "ros", "naive", "policy2000", "policyA"]
# metrics: P8 real outcomes (pre-registered: H2, ROS, ROSp); secondary evaluators (added after the P8 metric proved
# noisy): _hind = perfect-hindsight lineup ceiling of the real games, _pol = POLICY played on the real games
MET = ["H2", "ROS", "ROSp", "H2_hind", "ROS_hind", "H2_pol", "ROS_pol"]


def load(pref, sfile, afile):
    S = json.load(open(sfile)); A = json.load(open(afile))
    roster = {(W["week"], rid): t["players"] for W in S["weeks"] for rid, t in W["teams"].items()}
    LAST = max(W["week"] for W in S["weeks"])
    score = {"p8": {}, "hind": {}, "pol": {}}
    for f in glob.glob(f"{OUT}/{pref}_s*_*.json"):
        if "_sj" in f: continue
        score["p8"].update(json.load(open(f))["res"])
    for f in glob.glob(f"{OUT}/{pref}_h_*.json"):
        for k, (h, p) in json.load(open(f))["res"].items(): score["hind"][k] = h; score["pol"][k] = p
    dec = {}
    for f in glob.glob(f"{OUT}/{pref}_d_*.json") + glob.glob(f"{OUT}/{pref}p8f_d_*.json") + glob.glob(f"{OUT}/{pref}a_d_*.json"):
        for r in json.load(open(f)):
            k = (r["week"], r["rid"]); d = dec.setdefault(k, {"week": r["week"], "rid": r["rid"], "league": r["league"], "methods": {}})
            d["methods"].update(r["methods"]); d.setdefault("ms", {}).update(r["ms"]); d.setdefault("rss", []).append(r.get("rssMB"))
    key = lambda w, rid, pids: f"{w}|{rid}|{','.join(sorted(pids))}"
    missing = [0]

    def value(d, pick, ev):
        if not pick: return {"H2": 0.0, "ROS": 0.0, "ROSp": 0.0, "weeks": 0}
        sc = score[ev]
        h2 = ros = rosp = 0.0; n = 0
        for w in range(d["week"], LAST + 1):
            r = roster.get((w, d["rid"]))
            if not r or pick["add"] in r or (pick["drop"] and pick["drop"] not in r): break
            e = [x for x in r if x != pick["drop"]] + [pick["add"]]
            a, b = sc.get(key(w, d["rid"], e)), sc.get(key(w, d["rid"], r))
            if a is None or b is None: missing[0] += ev == "p8"; return None
            x = a - b; ros += x; rosp += x * (2 if w >= 18 else 1); n += 1
            if w <= d["week"] + 1: h2 += x
        return {"H2": h2, "ROS": ros, "ROSp": rosp, "weeks": n}

    rows = []
    for k, d in sorted(dec.items()):
        row = {"week": d["week"], "rid": d["rid"], "league": d["league"], "ms": d["ms"]}
        for m, v in d["methods"].items():
            val = value(d, v.get("pick"), "p8")
            if val is None: continue
            row[m] = {**val, "pick": v.get("pick"), "info": {kk: v.get(kk) for kk in ("sigDropGain", "nDroppable", "variants", "best")}}
            for ev in ("hind", "pol"):
                x = value(d, v.get("pick"), ev)
                if x: row[m].update({f"{k}_{ev}": x[k] for k in ("H2", "ROS")})
        rows.append(row)
    return rows, A, missing[0]


def stats(xs, wk, tm):
    n = len(xs); mu = sum(xs) / n
    sd = st.pstdev(xs) if n > 1 else 0.0; naive = 1.96 * sd / math.sqrt(n)

    def clustered(lab):
        g = collections.defaultdict(list)
        for x, l in zip(xs, lab): g[l].append(x)
        # cluster-robust SE of the mean: sqrt(sum_c (sum_i (x_i - mu))^2) / n
        v = sum(sum(x - mu for x in c) ** 2 for c in g.values()) * len(g) / max(1, len(g) - 1)
        return 1.96 * math.sqrt(v) / n
    return mu, naive, clustered(wk), clustered(tm), n


def fmt(mu, ci): return f"{mu:+.2f} ± {ci:.2f}"


def main():
    res = {}; per = {}
    for sname, (pref, sfile, afile) in SEASONS.items():
        rows, A, miss = load(pref, sfile, afile)
        if not rows: continue
        per[sname] = (rows, A); print(f"## {sname}: {len(rows)} team-week decisions, missing scores {miss}")
        nm = lambda p: A["names"].get(p, p) if p else "-"
        for m in METHODS:
            have = [r for r in rows if m in r]
            if not have: continue
            acted = [r for r in have if r[m]["pick"]]
            line = f"{m:10s} n={len(have):3d} acts {len(acted) / len(have):5.1%}"
            for met in MET:
                if any(met not in r[m] for r in have): continue
                mu, nv, cw, ct, n = stats([r[m][met] for r in have], [r["week"] for r in have], [r["rid"] for r in have])
                line += f" | {met} {fmt(mu, max(cw, ct))}"
                res[(sname, m, "none", met)] = (mu, nv, cw, ct, n)
            print(line)
        for m in METHODS:
            if m == "policy": continue
            have = [r for r in rows if m in r and "policy" in r]
            if not have: continue
            same = sum(1 for r in have if (r[m]["pick"] or {}).get("add") == (r["policy"]["pick"] or {}).get("add") and (r[m]["pick"] or {}).get("drop") == (r["policy"]["pick"] or {}).get("drop"))
            line = f"{m:10s} vs policy n={len(have):3d} same pick {same / len(have):5.1%}"
            for met in MET:
                if any(met not in r[m] or met not in r["policy"] for r in have): continue
                xs = [r[m][met] - r["policy"][met] for r in have]
                mu, nv, cw, ct, n = stats(xs, [r["week"] for r in have], [r["rid"] for r in have])
                res[(sname, m, "policy", met)] = (mu, nv, cw, ct, n)
                line += f" | {met} {fmt(mu, max(cw, ct))}"
            print(line)
    # pooled
    print("## pooled (inverse-variance; CI = wider of week / team clustered)")
    pooled = {}
    for (s, m, base, met) in list(res):
        if s != "2025-26": continue
        a = res[(s, m, base, met)]; b = res.get(("2024-25", m, base, met))
        ca = max(a[2], a[3]) / 1.96
        if b:
            cb = max(b[2], b[3]) / 1.96; wa, wb = 1 / max(ca, 1e-9) ** 2, 1 / max(cb, 1e-9) ** 2
            mu = (a[0] * wa + b[0] * wb) / (wa + wb); se = math.sqrt(1 / (wa + wb))
        else: mu, se = a[0], ca
        pooled[(m, base, met)] = (mu, 1.96 * se)
        print(f"{m:10s} vs {base:6s} {met:4s} {fmt(mu, 1.96 * se)}  (2025-26 {fmt(a[0], max(a[2], a[3]))}" + (f", 2024-25 {fmt(b[0], max(b[2], b[3]))})" if b else ")"))
    json.dump({"res": {"|".join(k): v for k, v in res.items()}, "pooled": {"|".join(k): v for k, v in pooled.items()}}, open(sys.argv[1] if len(sys.argv) > 1 else f"{OUT}/w_summary.json", "w"), indent=1)
    # markdown tables (research/out/w/w_tables.md)
    L = []
    cell = lambda t: fmt(t[0], max(t[2], t[3])) if t else "—"
    for sname, (rows, A) in per.items():
        L += [f"\n**{sname}: real points of each method's pick minus no move** (per team-week decision; 95% CI = wider of week- / team-clustered)\n",
              "| method | decisions | acts | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |", "|---|---|---|---|---|---|---|---|---|---|"]
        for m in METHODS:
            have = [r for r in rows if m in r]
            if not have: continue
            acts = sum(1 for r in have if r[m]["pick"]) / len(have)
            L.append(f"| {m} | {len(have)} | {acts:.0%} | " + " | ".join(cell(res.get((sname, m, "none", met))) for met in MET) + " |")
        L += [f"\n**{sname}: method minus current (policy), paired**\n",
              "| method | decisions | same pick | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |", "|---|---|---|---|---|---|---|---|---|---|"]
        for m in METHODS:
            if m == "policy": continue
            have = [r for r in rows if m in r and "policy" in r]
            if not have: continue
            same = sum(1 for r in have if (r[m]["pick"] or {}).get("add") == (r["policy"]["pick"] or {}).get("add") and (r[m]["pick"] or {}).get("drop") == (r["policy"]["pick"] or {}).get("drop")) / len(have)
            L.append(f"| {m} | {len(have)} | {same:.0%} | " + " | ".join(cell(res.get((sname, m, "policy", met))) for met in MET) + " |")
    L += ["\n**Pooled over both seasons (inverse-variance; method minus current / minus no move)**\n",
          "| comparison | H2 (P8) | ROS (P8) | ROSp (P8) | H2 hindsight | ROS hindsight | H2 POLICY | ROS POLICY |", "|---|---|---|---|---|---|---|---|"]
    for base in ("policy", "none"):
        for m in METHODS:
            if (m, base, "H2") not in pooled or (m == "policy" and base == "policy"): continue
            L.append(f"| {m} − {'current' if base == 'policy' else 'no move'} | " + " | ".join(fmt(*pooled[(m, base, met)]) if (m, base, met) in pooled else "—" for met in MET) + " |")
    open(f"{OUT}/w_tables.md", "w").write("\n".join(L) + "\n")
    # nonsense + cost
    print("## nonsense (method's own valuation) and cost")
    for sname, (rows, A) in per.items():
        for m in ("policy", "p8f", "ros", "policy2000", "policyA"):
            have = [r for r in rows if m in r]
            if not have: continue
            picks = [r[m]["pick"] for r in have if r[m]["pick"]]
            dg = [p for p in picks if p.get("dropOnly", 0) > 0]; dg2 = [p for p in picks if p.get("dropOnly", 0) > 2 * p.get("se", 0)]
            px = [p for p in picks if p.get("total", 0) - p.get("ros", 0) > p.get("gainNoDrop", 0)]
            sig = sum(r[m]["info"]["sigDropGain"] or 0 for r in have); nd = sum(r[m]["info"]["nDroppable"] or 0 for r in have)
            ms = st.mean(r["ms"].get(m, 0) for r in have) / 1000
            print(f"{sname} {m:10s} picks {len(picks):3d}: drop alone 'gains' {len(dg) / max(1, len(picks)):5.1%} (> 2se {len(dg2) / max(1, len(picks)):4.1%}), "
                  f"add+drop > add alone {len(px) / max(1, len(picks)):5.1%}; drop evaluations with a significant gain {sig}/{nd} ({sig / max(1, nd):.1%}); {ms:.0f} s/team-week")
    calibration(per)


def calibration(per):
    """Predicted 2-week gain of acted picks (the method's own simulation) vs realized H2 (P8 / hindsight / POLICY), by
    predicted-gain bin. Post-hoc diagnostic (winner's curse, threshold), not part of the selection rule."""
    print("## calibration: predicted 2-week gain (simulation) vs realized H2, acted picks")
    for sname, (rows, A) in per.items():
        for m in ("policy", "p8f", "policy2000", "ros", "policyA"):
            have = [r for r in rows if m in r and r[m]["pick"]]
            for lo, hi in ((3, 5), (5, 8), (8, 15), (15, 999), (3, 999)):
                b = [r for r in have if lo <= r[m]["pick"]["sim"] < hi]
                if len(b) < 5: continue
                pr = st.mean(r[m]["pick"]["sim"] for r in b)
                f = lambda k: f"{st.mean(r[m][k] for r in b):+6.2f} ± {1.96 * st.pstdev([r[m][k] for r in b]) / math.sqrt(len(b)):5.2f}"
                print(f"{sname} {m:10s} predicted {lo:>2}-{hi if hi < 999 else '':<3} n={len(b):3d}: predicted {pr:5.2f}  real P8 {f('H2')}  hindsight {f('H2_hind')}  POLICY {f('H2_pol')}")


if __name__ == "__main__":
    main()
