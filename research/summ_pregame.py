# Summary of the pre-game planner tests (research/pregame.ts, season mode).
# usage (from research/out): python3 ../summ_pregame.py <prefix>
import glob, json, math, sys

pre = sys.argv[1]
rows = [json.load(open(f)) for f in sorted(glob.glob(f"{pre}_*.json"))]
print(f"{len(rows)} team-week-days")
print("case | tonight starters | scenarios | search s | lineup s | key-teammate conditions | lock cut-off SE (median)")
allc = []
for r in rows:
    ses = sorted(x["lockSe"] for x in r["rows"] if not x["lockCutAboveGrid"])
    keys = sum(1 for x in r["rows"] for c in x["conditional"] if c["key"])
    print(f"w{r['week']} r{r['rid']} day {r['day']} | {len(r['rows'])} | {r['scenarios']} | {r['seconds'] - r['lineupSeconds']:.0f} | {r['lineupSeconds']:.0f} | {keys} | {ses[len(ses) // 2] if ses else '-'}")
    for c in r["check"]:
        c["case"] = f"w{r['week']} r{r['rid']} d{r['day']}"; allc.append(c)
eng = [k for k in allc[0] if k in ("P10b", "P8") ] if allc else []
ev = [c for c in allc if "best" in c]
early = [c for c in allc if "(tonight)" in str(c.get("P10b", ""))]
print(f"\nstarters: {len(allc)}; decided by P10b at the morning-after tip-off: {len(ev)}; resolved by P10b tonight (late tip-off): {len(early)}")
def agree(a, b): return sum(1 for c in ev if c[a] == c[b])
if ev:
    print(f"table = P10b: {agree('table', 'P10b')}/{len(ev)}; table = P8: {sum(1 for c in ev if c['table'] == c['P8'])}/{len(ev)}; P10b = P8: {sum(1 for c in ev if c['P10b'] == c['P8'])}/{len(ev)}")
    print(f"best action (deep evaluation): table {sum(1 for c in ev if c['table'] == c['best'])}/{len(ev)}, P10b {sum(1 for c in ev if c['P10b'] == c['best'])}/{len(ev)}, P8 {sum(1 for c in ev if c['P8'] == c['best'])}/{len(ev)}")
    sc = [c for c in ev if all(c.get(k) for k in ("regretTable", "regretEngine", "regretP8"))]
    print(f"decisions where all three choices could be scored (forced action applicable): {len(sc)}/{len(ev)}; infeasible-action cases: {[(c['case'], c['player'], c.get('feasible')) for c in ev if c not in sc]}")
    for k, lab in (("regretTable", "table"), ("regretEngine", "P10b"), ("regretP8", "P8")):
        xs = [c[k] for c in sc]
        m = sum(x["m"] for x in xs); se = math.sqrt(sum(x["se"] ** 2 for x in xs))
        print(f"total regret vs the best of lock/keep/free, {lab}: {m:.2f} ± {1.96 * se:.2f} pts over {len(xs)} decisions ({m / max(1, len(rows)):.2f} per team-week-day)")
    d = [(c["regretTable"]["m"] - c["regretEngine"]["m"]) for c in sc]
    print(f"table - P10b regret, paired: {sum(d):.2f} (decisions where they differ: {sum(1 for c in sc if c['table'] != c['P10b'])})")
    print("\ndisagreements (table vs P10b):")
    for c in ev:
        if c["table"] != c["P10b"]:
            f = lambda r: f"{r['m']} ± {r['se']}" if r else "n/a"
            print(f"  {c['case']} {c['player']} x={c['x']}: table {c['table']} (lock >= {c['tableCut']}, free < {c['tableLetGo']}, {c['tableWhy']}) vs P10b {c['P10b']} / P8 {c['P8']}; values {c['values']} best {c['best']}; regret table {f(c['regretTable'])}, P10b {f(c['regretEngine'])}")
