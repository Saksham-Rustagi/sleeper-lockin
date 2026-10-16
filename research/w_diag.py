"""Task W diagnostic: are the added free agents (and the dropped players) projected right? For every acted pick of a
method, the add's and the drop's games in weeks w, w+1: mean pre-game projection, mean actual (DNP = 0), share played,
and the same over all rostered / free-agent games. usage: python3 -I research/w_diag.py"""
import json, glob, statistics as st, collections

for sname, pref, afile in (("2025-26", "w25", "research/data/w/all2025.json"), ("2024-25", "w24", "research/data/w/all2024.json")):
    A = json.load(open(afile))
    games = collections.defaultdict(list)
    pre = {}
    for w, gs in A["games"].items():
        for g in gs: games[(g["pid"], int(w))].append(g)
    # pre-game projection as in wcommon (projection, else latest earlier one, else mean of last 10 played, else 12)
    byp = collections.defaultdict(list)
    for w, gs in A["games"].items():
        for g in gs: byp[g["pid"]].append(g)
    for p, gs in byp.items():
        gs.sort(key=lambda g: g["tip"]); last = None; acts = []
        for g in gs:
            pre[(p, g["tip"])] = g["proj_sleeper"] if g["proj_sleeper"] is not None else last if last is not None else (sum(acts[-10:]) / len(acts[-10:]) if acts else 12)
            if g["proj_sleeper"] is not None: last = g["proj_sleeper"]
            if g["played"]: acts.append(g["actual"])
    rows = [r for f in glob.glob(f"research/out/w/{pref}_d_*.json") for r in json.load(open(f))]
    for m in ("policy", "naive"):
        acc = {"add": [[], [], []], "drop": [[], [], []]}
        for r in rows:
            p = r["methods"][m]["pick"]
            if not p: continue
            for role in ("add", "drop"):
                if not p[role]: continue
                for w in (r["week"], r["week"] + 1):
                    for g in games.get((p[role], w), []):
                        acc[role][0].append(pre[(g["pid"], g["tip"])]); acc[role][1].append(g["actual"] if g["played"] else 0); acc[role][2].append(g["played"])
        for role, (pr, ac, pl) in acc.items():
            print(f"{sname} {m:7s} {role:4s}: {len(pr):5d} games  projection {st.mean(pr):5.1f}  actual {st.mean(ac):5.1f} (played {st.mean(pl):.0%}, "
                  f"{st.mean([a for a, q in zip(ac, pl) if q]):.1f} when played)")

# split the 2025-26 adds' games: Sleeper projection present vs fallback, played vs DNP; and the most-picked adds
A = json.load(open("research/data/w/all2025.json")); games = collections.defaultdict(list)
for w, gs in A["games"].items():
    for g in gs: games[(g["pid"], int(w))].append(g)
rows = [r for f in glob.glob("research/out/w/w25_d_*.json") for r in json.load(open(f))]
cnt = collections.Counter(); cell = collections.defaultdict(list)
for r in rows:
    p = r["methods"]["policy"]["pick"]
    if not p: continue
    cnt[p["add"]] += 1
    for w in (r["week"], r["week"] + 1):
        for g in games.get((p["add"], w), []):
            cell[(g["proj_sleeper"] is not None, g["played"])].append((g["proj_sleeper"], g["actual"]))
for k, v in sorted(cell.items()):
    print("2025-26 adds: projection present", k[0], "played", k[1], len(v), "mean proj", round(st.mean(x for x, _ in v if x is not None), 1) if k[0] else "-", "mean actual", round(st.mean(a for _, a in v), 1))
for p, n in cnt.most_common(12):
    gs = [g for (q, w), l in games.items() if q == p for g in l]
    pr = [g["proj_sleeper"] for g in gs if g["proj_sleeper"] is not None]
    print(f"  {A['names'].get(p, p):24s} picked {n:2d}x  season: games {len(gs)}, played {sum(g['played'] for g in gs)}, proj rows {len(pr)} mean {st.mean(pr) if pr else 0:.1f}, actual when played {st.mean([g['actual'] for g in gs if g['played']] or [0]):.1f}")
