"""Task O (c): real-points value of the opportunity alerts and the minutes-override calibration of the Waivers page
(research/REPORT.md "Opportunity alerts"). usage: python3 -I research/o_vsumm.py [> research/out/o/v25_value.md]
Scores: task W's (research/out/w/w25_s*, w25_h*) + task O's (research/out/o/<prefix>_s*, _h*)."""
import json, glob, math, statistics as st, collections, os

OW, OO = "research/out/w", "research/out/o"
S = json.load(open("research/data/season.json"))
roster = {(W["week"], rid): t["players"] for W in S["weeks"] for rid, t in W["teams"].items()}
LAST = max(W["week"] for W in S["weeks"])
p8, hind, pol = {}, {}, {}
for f in glob.glob(f"{OW}/w25_s*_*.json") + glob.glob(f"{OO}/*_s[0-9]*_*.json"):
    if "_sj" in f: continue
    p8.update(json.load(open(f))["res"])
for f in glob.glob(f"{OW}/w25_h_*.json") + glob.glob(f"{OO}/*_h[0-9]*_*.json"):
    if "_hj" in f: continue
    for k, (h, p) in json.load(open(f))["res"].items(): hind[k] = h; pol[k] = p
key = lambda w, rid, pids: f"{w}|{rid}|{','.join(sorted(pids))}"


def value(week, rid, add, drop, sc, h=2):
    """(H1, H2) edited - real roster, task W's kept rule; None if a score is missing"""
    out = [0.0, 0.0]
    for w in range(week, min(week + h - 1, LAST) + 1):
        r = roster.get((w, rid))
        if not r or add in r or (drop and drop not in r): break
        e = [x for x in r if x != drop] + [add]
        a, b = sc.get(key(w, rid, e)), sc.get(key(w, rid, r))
        if a is None or b is None: return None
        if w == week: out[0] += a - b
        out[1] += a - b
    return out


def cl(xs, labs):
    n = len(xs); mu = sum(xs) / n; g = collections.defaultdict(list)
    for x, l in zip(xs, labs): g[l].append(x)
    v = sum(sum(x - mu for x in c) ** 2 for c in g.values()) * len(g) / max(1, len(g) - 1)
    return 1.96 * math.sqrt(v) / n


def est(xs, wk, tm):
    if not xs: return "–"
    mu = sum(xs) / len(xs); return f"{mu:+.2f} ± {max(cl(xs, wk), cl(xs, tm)):.2f}"


def ols(x, y):
    mx, my = st.mean(x), st.mean(y); sxx = sum((a - mx) ** 2 for a in x)
    b = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sxx if sxx else float("nan")
    # slope SE (naive)
    res = [c - my - b * (a - mx) for a, c in zip(x, y)]; se = math.sqrt(sum(r * r for r in res) / max(1, len(x) - 2) / sxx) if sxx else float("nan")
    return b, se


# ---------- value of the alerts ----------
dec = json.load(open(f"{OO}/o25al_dec.json"))
print("## (c) value of acting on the alerts (2025-26, our league)\n")
print(f"{len(dec)} team-week decisions in {len(set(d['week'] for d in dec))} weeks (every team adds the week's top alert, drops the page's cheapest unprotected player).\n")
print("| evaluator | H1 (week w) | H2 (weeks w, w+1) | n |")
print("|---|---|---|---|")
for name, sc in (("P8 real outcomes (pre-registered)", p8), ("hindsight lineup ceiling", hind), ("POLICY on real outcomes", pol)):
    v = [(d, value(d["week"], d["rid"], d["add"], d["drop"], sc)) for d in dec]; v = [(d, x) for d, x in v if x is not None]
    wk = [d["week"] for d, _ in v]; tm = [d["rid"] for d, _ in v]
    print(f"| {name} | {est([x[0] for _, x in v], wk, tm)} | {est([x[1] for _, x in v], wk, tm)} | {len(v)} |")
# by source and the added players
A = json.load(open(f"{OO}/v25_alerts.json")); names = {}
try:
    names = json.load(open("research/data/w/all2025.json"))["names"]
except Exception: pass
print("\nTop alert per week (the add):\n")
print("| week | add | source | estimate fp/g | H2 P8 (mean over teams) | H2 hindsight |")
print("|---|---|---|---|---|---|")
for w in sorted(set(d["week"] for d in dec)):
    ds = [d for d in dec if d["week"] == w]; d0 = ds[0]
    a = [value(d["week"], d["rid"], d["add"], d["drop"], p8) for d in ds]; a = [x[1] for x in a if x]
    h = [value(d["week"], d["rid"], d["add"], d["drop"], hind) for d in ds]; h = [x[1] for x in h if x]
    print(f"| {w} | {names.get(d0['add'], d0['add'])} | {d0['source']} | {d0['est']} | {st.mean(a):+.1f} | {st.mean(h):+.1f} |" if a and h else f"| {w} | {names.get(d0['add'], d0['add'])} | {d0['source']} | {d0['est']} | – | – |")
# the page's own pick in the same team-weeks (reference)
pg = [(d, value(d["week"], d["rid"], d["page"]["add"], d["page"]["drop"], p8)) for d in dec if d.get("page")]
pg = [(d, x) for d, x in pg if x is not None]
if pg: print(f"\nReference: the Waivers page's own pick in those team-weeks ({len(pg)} with a pick): H2 P8 {est([x[1] for _, x in pg], [d['week'] for d, _ in pg], [d['rid'] for d, _ in pg])}")

# ---------- calibration ----------
print("\n## (c) calibration of the Waivers page's predicted gains: Sleeper projections vs minutes override\n")
def rows_of(pref):
    out = []
    for f in glob.glob(f"{OW}/{pref}_d_*.json"):
        if f.endswith(".log"): continue
        out += json.load(open(f))
    return out
flag = {w["week"]: set(w["overrides"]) for w in A["weeks"]}
try:
    flag_or = {w["week"]: set(w["overrides"]) for w in json.load(open(f"{OO}/v25_alerts_or.json"))["weeks"]}
except Exception: flag_or = {}
print("| search | picks | predicted | realized P8 | realized hindsight | P8 - predicted | hindsight - predicted | slope P8 | slope hindsight |")
print("|---|---|---|---|---|---|---|---|---|")
allm = {}
for label, pref, fl in (("Sleeper projections (task W policy)", "w25", flag), ("minutes override (pre-registered)", "o25ov", flag), ("override, only raise (exploratory, live default)", "o25ovr", flag_or),
                        ("Sleeper projections; flagged = only-raise set", "w25", flag_or)):
    R = rows_of(pref)
    if not R: continue
    pk = []
    for r in R:
        p = r["methods"]["policy"]["pick"]
        if not p: continue
        a = value(r["week"], r["rid"], p["add"], p["drop"], p8); b = value(r["week"], r["rid"], p["add"], p["drop"], hind)
        if a is None or b is None: continue
        pk.append((r, p["total"], a[1], b[1]))
    wk = [x[0]["week"] for x in pk]; tm = [x[0]["rid"] for x in pk]
    s8, e8 = ols([x[1] for x in pk], [x[2] for x in pk]); sh, eh = ols([x[1] for x in pk], [x[3] for x in pk])
    print(f"| {label} | {len(pk)} | {st.mean(x[1] for x in pk):.2f} | {est([x[2] for x in pk], wk, tm)} | {est([x[3] for x in pk], wk, tm)} | "
          f"{est([x[2] - x[1] for x in pk], wk, tm)} | {est([x[3] - x[1] for x in pk], wk, tm)} | {s8:.2f} ± {1.96 * e8:.2f} | {sh:.2f} ± {1.96 * eh:.2f} |")
    mv = []
    for r in R:
        for m in r["methods"]["policy"]["moves"]:
            b = value(r["week"], r["rid"], m[0], m[1], hind)
            if b is None: continue
            mv.append((r["week"], r["rid"], m[0], m[2], b[1], m[0] in fl.get(r["week"], set())))
    allm[label] = mv
print("\nAll evaluated moves (18 per team-week), hindsight H2:\n")
print("| search | moves | predicted | realized | realized - predicted | slope | flagged adds: n | predicted | realized | realized - predicted | slope |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for label, mv in allm.items():
    wk = [x[0] for x in mv]; tm = [x[1] for x in mv]; s, e = ols([x[3] for x in mv], [x[4] for x in mv])
    fm = [x for x in mv if x[5]]
    fs = ols([x[3] for x in fm], [x[4] for x in fm]) if len(fm) > 3 else (float("nan"), float("nan"))
    print(f"| {label} | {len(mv)} | {st.mean(x[3] for x in mv):.2f} | {st.mean(x[4] for x in mv):.2f} | {est([x[4] - x[3] for x in mv], wk, tm)} | {s:.2f} ± {1.96 * e:.2f} | "
          f"{len(fm)} | {st.mean(x[3] for x in fm) if fm else float('nan'):.2f} | {st.mean(x[4] for x in fm) if fm else float('nan'):.2f} | "
          f"{est([x[4] - x[3] for x in fm], [x[0] for x in fm], [x[1] for x in fm])} | {fs[0]:.2f} ± {1.96 * fs[1]:.2f} |")
