# Task T3: the standard P10b season backtest with the mid-game forfeit option at every tip-off (MIDGAME=1) vs the published
# Phase-3 run s10 (same runner, same seeds).   python3 research/t3_season.py <prefix new> <prefix ref> <policy>
import json, glob, sys
new, ref, pol = sys.argv[1], sys.argv[2], sys.argv[3]
def load(pre):
    out = {}
    for f in glob.glob(f"research/out/{pre}_*_*.json"):
        d = json.load(open(f)); out[(d["week"], str(d["rid"]))] = d
    return out
A, B = load(new), load(ref)
common = sorted(set(A) & set(B))
same = sum(1 for k in common if A[k]["pols"][pol]["real"] == B[k]["pols"][pol]["real"])
mx = max((abs(A[k]["pols"][pol]["real"] - B[k]["pols"][pol]["real"]) for k in common), default=0)
rep = sum(1 for k in common if json.dumps(A[k][pol]["rep"], sort_keys=True) == json.dumps(B[k][pol]["rep"], sort_keys=True))
# race statistics on the keys both runs have, timing excluded (s10 predates task L's conf* counters, all 0 here)
def same_stats(a, b): return all(a[x] == b[x] for x in a if x in b and x != "ms") and all(not a[x] for x in a if x not in b)
st = sum(1 for k in common if same_stats(A[k]["pols"][pol]["stats"], B[k]["pols"][pol]["stats"]))
g = sum(A[k]["pols"][pol].get("midgame", {}).get("groups", 0) for k in common); c = sum(A[k]["pols"][pol].get("midgame", {}).get("checks", 0) for k in common)
mean = lambda D: sum(D[k]["pols"][pol]["real"] for k in common) / max(1, len(common))
print(f"{len(common)} team-weeks in both ({len(A)} new, {len(B)} ref): {same} identical {pol} totals, max |diff| {mx:.2f}; "
      f"invariant reports identical {rep}; race statistics identical {st}")
print(f"mean {pol}: new {mean(A):.2f} / ref {mean(B):.2f} pts/wk; mid-game hook: {g} tip-offs seen, {c} with a candidate")
