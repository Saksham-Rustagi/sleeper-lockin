# Task T3: summary of research/t3_mono.ts (the mid-game forfeit option on real 2025-26 team-weeks, synthetic in-game
# states, decisions scored on fresh model scenarios).   python3 research/t3_mono.py <prefix>   (files research/out/<prefix>_*.json)
import json, glob, sys, math
rows = []; weeks = 0; ms = 0
for f in glob.glob(f"research/out/{sys.argv[1]}_*.json"):
    d = json.load(open(f)); weeks += 1; ms += d["ms"]
    for r in d["rows"]: r["tw"] = (d["week"], d["rid"]); rows.append(r)
def mse(xs):
    n = len(xs)
    if n < 2: return (sum(xs) / n if n else float("nan"), float("nan"))
    m = sum(xs) / n; return m, math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1) / n)
def cluster(vals):  # mean per decision, se clustered by team-week
    by = {}
    for k, v in vals: by.setdefault(k, []).append(v)
    n = sum(len(v) for v in by.values()); m = sum(sum(v) for v in by.values()) / n
    s = sum((sum(v) - len(v) * m) ** 2 for v in by.values()); G = len(by)
    return m, math.sqrt(s * G / max(1, G - 1)) / n
cands = sum(r["cands"] for r in rows); picks = [r for r in rows if r["pick"] >= 0]
defer = sum(1 for r in rows for e in r["evals"] if e["deferred"])
print(f"{weeks} team-weeks, {len(rows)} decision moments with a starter in a game in progress, {cands} players evaluated")
print(f"forfeits: {len(picks)} ({100 * len(picks) / max(1, len(rows)):.1f}% of moments), deferred (clear gain only at a later tip-off): {defer}")
if picks:
    race = [next(e["gain"] for e in r["evals"] if e["p"] == r["pick"]) for r in picks]
    fr = [r["fresh"]["m"] for r in picks]
    neg = sum(1 for r in picks if r["fresh"]["m"] < 0); sig = sum(1 for r in picks if r["fresh"]["m"] + 2 * r["fresh"]["se"] < 0)
    m, se = cluster([(r["tw"], r["fresh"]["m"]) for r in picks])
    print(f"  race gain (selection) mean {sum(race) / len(race):.2f}; FRESH gain mean {m:.2f} ± {1.96 * se:.2f} (95% CI, clustered by team-week)")
    print(f"  fresh gain < 0: {neg} of {len(picks)}; significantly < 0 (mean + 2 se < 0): {sig}")
    for lab, sel in (("out for the game", True), ("normal game", False)):
        xs = [r["fresh"]["m"] for r in picks if next(s for s in r["syn"] if s["p"] == r["pick"])["out"] == sel]
        if xs: a, b = mse(xs); print(f"  forfeited player {lab}: {len(xs)} forfeits, fresh gain {a:.2f} ± {1.96 * b:.2f}")
allv = [(r["tw"], r["fresh"]["m"] if r["pick"] >= 0 else 0.0) for r in rows]
m, se = cluster(allv)
print(f"option value per decision moment: {m:.3f} ± {1.96 * se:.3f}; per team-week: {m * len(rows) / weeks:.2f} pts")
print(f"compute: {sum(r['ms'] for r in rows) / max(1, len(rows)) / 1000:.1f} s per moment (one thread, P8 engine, kMax 256); total {ms / 1000 / 3600:.2f} CPU-h")
