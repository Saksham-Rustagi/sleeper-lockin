"""P10b racing budget (kMax) study: paired real-outcome runs of research/p10run.ts (DECLOG=1) on a team-week sample.
usage (from research/out): python3 ../summ_kmax.py <prefix> <BASE_POLICY> <POLICY,...> [<identity prefix>]
- totals: paired diff vs BASE_POLICY, naive and week-clustered 95% CI, better/worse, win% vs the real opponent
- races: raced decisions / week, scenarios per race (mean, share at kMax), switches / week, continuations / race, s per raced
  decision (one process per team-week, 14 in parallel)
- decisions: on the real outcomes both runs face the same states until their first different decision; reported: team-weeks
  with any different decision, decisions compared on identical states, and how often they differ there
- identity: BASE_POLICY totals vs the same policy in <identity prefix> (an earlier run of the same engine)"""
import glob, json, math, os, statistics as st, sys

pre, base, pols = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
ident = sys.argv[4] if len(sys.argv) > 4 else None
S = json.load(open(os.environ.get("SEASON", "../data/season.json")))
human = {(W["week"], str(r)): t["human_points"] for W in S["weeks"] for r, t in W["teams"].items() if t["human_points"] is not None}
opp = {}
for W in S["weeks"]:
    for a, b in W["matchups"]: opp[(W["week"], str(a))] = (W["week"], str(b)); opp[(W["week"], str(b))] = (W["week"], str(a))
R = {}
for f in glob.glob(f"{pre}_*_*.json"):
    r = json.load(open(f)); R[(r["week"], str(r["rid"]))] = r["pols"]
keys = sorted(R)
print(f"{len(keys)} team-weeks ({pre})")
if ident:
    same = diff = miss = 0
    for k in keys:
        f = f"{ident}_{k[0]}_{k[1]}.json"
        if not os.path.exists(f): miss += 1; continue
        o = json.load(open(f))["pols"].get(base)
        if o is None: miss += 1; continue
        if o["real"] == R[k][base]["real"]: same += 1
        else: diff += 1; print(f"  identity: w{k[0]} r{k[1]} {base} {R[k][base]['real']} vs {ident} {o['real']}")
    print(f"identity of {base} vs {ident}: {same} identical, {diff} different, {miss} missing\n")

def clustered(d, ks):
    n = len(d); m = sum(d) / n; byw = {}
    for x, k in zip(d, ks): byw[k[0]] = byw.get(k[0], 0) + (x - m)
    return 1.96 * math.sqrt(sum(v * v for v in byw.values())) / n
def win(p):
    w = n = 0
    for k in keys:
        o = opp.get(k)
        if o in human: x = R[k][p]["real"]; w += 1 if x > human[o] else .5 if x == human[o] else 0; n += 1
    return w / n
print("| policy | pts/wk | paired diff vs %s | 95%% CI naive | 95%% CI week-clustered | better/worse | win%% vs real opp. |" % base)
print("|---|---|---|---|---|---|---|")
for p in [base] + pols:
    t = [R[k][p]["real"] for k in keys]; d = [R[k][p]["real"] - R[k][base]["real"] for k in keys]
    if p == base: print(f"| {p} | {st.mean(t):.2f} | | | | | {win(p):.3f} |"); continue
    print(f"| {p} | {st.mean(t):.2f} | {st.mean(d):+.2f} | ± {1.96 * st.stdev(d) / math.sqrt(len(d)):.2f} | ± {clustered(d, keys):.2f} | {sum(x > 0 for x in d)}/{sum(x < 0 for x in d)} | {win(p):.3f} |")

print("\n| policy | raced / wk | scenarios per race: mean (share at kMax) | continuations / race | switches / wk | s per raced decision |")
print("|---|---|---|---|---|---|")
for p in [base] + pols:
    raced = sw = sims = 0; scen = []; atmax = 0; ms = 0
    kmax = 256
    if "kMax=" in p: kmax = int(p.split("kMax=")[1].split(",")[0])
    for k in keys:
        s = R[k][p]["stats"]; raced += s["raced"]; sw += s["switched"]; sims += s["sims"]; ms += s["ms"]
        for row in s["log"]: scen.append(row[1]); atmax += row[1] >= kmax
    n = len(keys)
    print(f"| {p} | {raced / n:.1f} | {st.mean(scen):.0f} ({atmax / len(scen):.0%}) | {sims / raced:.0f} | {sw / n:.2f} | {ms / raced / 1000:.1f} |")

print(f"\nDecisions on identical states (vs {base}):")
print("| policy | team-weeks with a different decision | decisions compared on identical states | different there | of which: switch / keep P8's |")
print("|---|---|---|---|---|")
for p in pols:
    tw_diff = comp = dif = sw = keep = 0
    for k in keys:
        a, b = R[k][base].get("dec"), R[k][p].get("dec")
        if a is None or b is None: continue
        for i, (x, y) in enumerate(zip(a, b)):
            comp += 1
            if x != y:
                tw_diff += 1; dif += 1
                if y.endswith(":-"): keep += 1
                else: sw += 1
                break
    print(f"| {p} | {tw_diff}/{len(keys)} | {comp} | {dif} ({dif / max(1, comp):.1%}) | {sw} / {keep} |")
