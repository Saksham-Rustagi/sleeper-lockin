"""Task L: replay confirmation rules offline on the model-scenario tuning data (research/l_tune.ts outputs) and pick
P10c's parameters by the pre-registered procedure (research/REPORT.md "P10b acceptance fix", Pre-registration).
Per probe entry e (a raced decision on a model world): race gain m, kind (first word of why), race switch acc, and the
challenger's paired gains over P8's decision on 512 fresh scenarios d[0..511]. Confirmation sample = d[0:M]; the
truth = mean(d[256:512]) (independent of the confirmation for every M <= 256).
Rule (g, kinds, M, z, all): a race switch is kept unless all=True and the confirmation fails; a non-switch becomes a
switch iff m > g, kind in kinds, and the confirmation passes; pass = mean(d[0:M]) > max(0, z * se).
Gain vs P10b per model week = sum_e (switch_rule(e) - acc_e) * truth_e / weeks; 95% CI clustered by model week.
usage: python3 -E research/l_tune.py [prefixes, default l/t25,l/t24] [--top N]"""
import glob, json, math, sys, itertools, statistics as st

pres = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "l/t25,l/t24").split(",")
TOP = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 15
W = []  # model weeks: list of entries
races = sims = 0
for pre in pres:
    for f in sorted(glob.glob(f"research/out/{pre}_*_*.json")):
        r = json.load(open(f))
        for w in r["worlds"]:
            W.append((pre, r["week"], r["rid"], w["k"], w["probe"])); races += w["stats"]["raced"]; sims += w["stats"]["sims"]
nW = len(W)
if not nW: sys.exit("no data")
def mse(x):
    n = len(x); m = sum(x) / n; return m, math.sqrt(sum((v - m) ** 2 for v in x) / (n - 1) / n)
for _, _, _, _, P in W:
    for e in P:
        e["kind"] = e["why"].split(" ")[0]; e["T"] = sum(e["d"][256:512]) / len(e["d"][256:512])
        e["C"] = {M: mse(e["d"][:M]) for M in (64, 128, 256)}
KINDS = {"lock": {"lock"}, "lock+in": {"lock", "in"}, "all": None}
def evaluate(g, kinds, M, z, allc):
    per, nsw, nveto, nconf = [], 0, 0, 0
    for _, _, _, _, P in W:
        s = 0.0
        for e in P:
            if e["acc"]:
                if not allc: continue
                nconf += 1; m, se = e["C"][M]
                if not (m > max(0.0, z * se)): s -= e["T"]; nveto += 1
            else:
                if not (e["m"] > g) or (KINDS[kinds] is not None and e["kind"] not in KINDS[kinds]): continue
                nconf += 1; m, se = e["C"][M]
                if m > max(0.0, z * se): s += e["T"]; nsw += 1
        per.append(s)
    m = st.mean(per); ci = 1.96 * st.stdev(per) / math.sqrt(len(per))
    return dict(g=g, kinds=kinds, M=M, z=z, all=allc, gain=m, ci=ci, sw=nsw / nW, veto=nveto / nW, conf=nconf / nW, extra=2 * M * nconf / nW)
grid = [evaluate(*v) for v in itertools.product([0.25, 0.5], ["lock", "lock+in", "all"], [64, 128, 256], [0, 0.5, 1.0, 1.645], [False, True])]
best = max(r["gain"] for r in grid)
# pre-registered parsimony: within 0.05 pts/wk of the best: smallest M, then all=False, then fewest kinds, then g=0.5, then largest z
order = {"lock": 0, "lock+in": 1, "all": 2}
band = [r for r in grid if r["gain"] >= best - 0.05]
pick = min(band, key=lambda r: (r["M"], r["all"], order[r["kinds"]], -r["g"], -r["z"]))
print(f"model weeks {nW}, raced decisions/wk {races / nW:.1f}, race continuations/wk {sims / nW:.0f}, probe entries/wk {sum(len(P) for *_, P in W) / nW:.2f}")
# descriptive: entries by kind and race-gain bin (truth = fresh mean)
print("\n| race switch | kind | race gain | entries/wk | race gain (mean) | fresh truth (mean ± 95% CI) |\n|---|---|---|---|---|---|")
bins = [(0.25, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 99)]
for acc in (0, 1):
    for kind in ("lock", "in", "out", "other"):
        for lo, hi in bins:
            es = [e for *_, P in W for e in P if e["acc"] == acc and (e["kind"] if e["kind"] in ("lock", "in", "out") else "other") == kind and lo < e["m"] <= hi]
            if len(es) < 3: continue
            T = [e["T"] for e in es]; print(f"| {'yes' if acc else 'no'} | {kind} | {lo}-{hi if hi < 99 else ''} | {len(es) / nW:.2f} | {st.mean(e['m'] for e in es):+.2f} | {st.mean(T):+.3f} ± {1.96 * st.stdev(T) / math.sqrt(len(T)):.3f} (n={len(T)}) |")
print(f"\n| g | kinds | M | z | confirm race switches | gain vs P10b pts/wk (95% CI) | switches added/wk | race switches vetoed/wk | confirmations/wk | extra continuations/wk |\n|---|---|---|---|---|---|---|---|---|---|")
for r in sorted(grid, key=lambda r: -r["gain"])[:TOP]:
    mark = " **(pick)**" if r is pick else ""
    print(f"| {r['g']} | {r['kinds']} | {r['M']} | {r['z']} | {r['all']} | {r['gain']:+.3f} ± {r['ci']:.3f}{mark} | {r['sw']:.2f} | {r['veto']:.2f} | {r['conf']:.2f} | {r['extra']:.0f} |")
print(f"\npick: confirm={pick['M']}, confGate={pick['g']}, confKinds={pick['kinds'] if pick['kinds'] != 'all' else ''}, confZ={pick['z']}, confAll={str(pick['all']).lower()}  "
      f"(tuning gain {pick['gain']:+.3f} ± {pick['ci']:.3f}; best in grid {best:+.3f})")
json.dump({"pick": pick, "grid": grid, "weeks": nW}, open("research/out/l/tune_summary.json", "w"), indent=1)
