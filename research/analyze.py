import json, glob, statistics as st, math, sys, collections
files = sys.argv[1:] or glob.glob("/root/sleeper-lockin/research/out/roll_*.json")
R = []
for f in files: R += json.load(open(f))
pols = [p for p in ["APP", "P1", "P2", "P3", "P3W", "P4", "P4S"] if p in R[0]]
by = {(r["week"], r["rid"]): r for r in R}
print(f"team-weeks: {len(R)}  weeks: {len(set(r['week'] for r in R))}")
print("\nPOINTS PER WEEK")
for p in pols + ["human", "hindsight"]:
    v = [r[p] for r in R]; print(f"  {p:9s} mean {st.mean(v):6.1f}  median {st.median(v):6.1f}  p10 {sorted(v)[len(v)//10]:6.1f}")
def ci(d):
    m = st.mean(d); se = st.pstdev(d) / math.sqrt(len(d)); return f"{m:+.1f} ± {1.96*se:.1f}"
print("\nPAIRED DIFFERENCES (same team, same week, same real games)")
for a, b in [("P1", "APP"), ("P2", "P1"), ("P3", "P2"), ("P3W", "P3"), ("P4", "P2"), ("P4S", "P2"), ("P4S", "P3"), ("P3", "APP"), ("P4S", "APP")]:
    if a in pols and b in pols: print(f"  {a}-{b}: {ci([r[a]-r[b] for r in R])}")

def winrate(me, opp_field):
    w = n = 0
    for r in R:
        if not r["opp"]: continue
        o = by.get((r["week"], r["opp"]))
        if not o: continue
        a, b = r[me], o[opp_field]
        w += 1 if a > b else 0.5 if a == b else 0; n += 1
    return w / n, n
print("\nWIN RATE vs your real opponent playing ...")
print(f"  {'policy':9s} {'vs P2 bot':>10s} {'vs APP bot':>10s} {'vs HUMAN (actual score)':>24s}")
for p in pols:
    a, n = winrate(p, "P2"); b, _ = winrate(p, "APP"); c, _ = winrate(p, "human")
    print(f"  {p:9s} {a:10.3f} {b:10.3f} {c:24.3f}   (n={n})")
hu, _ = winrate("human", "human"); print(f"  {'human':9s} {'':10s} {'':10s} {hu:24.3f}")

print("\nBY WEEK TYPE (mean pts)")
days = {}
S = json.load(open("/root/sleeper/research/season.json"))
for w in S["weeks"]: days[w["week"]] = len(w["dates"])
grp = collections.defaultdict(list)
for r in R: grp["short (<=5 days)" if days[r["week"]] <= 5 else "full"].append(r)
for k, rs in grp.items():
    print(f"  {k:17s} n={len(rs):3d} " + " ".join(f"{p}={st.mean([r[p] for r in rs]):.1f}" for p in pols + ["hindsight"]))
print("\nMY TEAM (roster 8, MiningMath) 2025 weeks:")
mine = sorted([r for r in R if r["rid"] == "8"], key=lambda r: r["week"])
print("  mean " + " ".join(f"{p}={st.mean([r[p] for r in mine]):.1f}" for p in pols + ["human", "hindsight"]))
a = sum(1 for r in mine if r["P3"] > r["human"]); print(f"  P3 beat your actual score in {a}/{len(mine)} weeks")
ms = [r.get("P3_ms", 0) for r in R]; print(f"\nrollout runtime per team-week: median {st.median(ms)/1000:.1f}s max {max(ms)/1000:.1f}s")
