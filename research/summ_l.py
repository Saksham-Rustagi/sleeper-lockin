"""Task L validation summary (run from research/out): P10c (l/v25, l/v24) vs the published P10b runs (s10, s24p10b).
- reproducibility: team-weeks where the confirmation changed nothing must equal P10b's total exactly;
- what the confirmation does per week (confirmations, switches added, race switches vetoed, extra continuations,
  decision time), by kind of the added switch;
- task H's runner-up re-evaluation on P10c (FRESH=96): sum per team-week of the fresh gain of the best challenger not
  chosen (when the race scored it > 0.25 better), mean ± 95% CI over team-weeks; by race-gap bin and kind.
usage: python3 -E ../summ_l.py"""
import glob, json, math, statistics as st

def load(pre, pol):
    R = {}
    for f in glob.glob(f"{pre}_*_*.json"):
        r = json.load(open(f))
        if pol in r["pols"]: R[(r["week"], int(r["rid"]))] = r["pols"][pol]
    return R
def ci(x): return 1.96 * st.stdev(x) / math.sqrt(len(x)) if len(x) > 1 else float("nan")
for name, cpre, bpre in [("2025-26", "l/v25", "s10"), ("2024-25", "l/v24", "s24p10b")]:
    C, B = load(cpre, "P10c"), load(bpre, "P10b")
    keys = sorted(set(C) & set(B))
    if not keys: print(f"{name}: no data"); continue
    n = len(keys)
    same = [k for k in keys if C[k]["stats"]["confSwitch"] + C[k]["stats"]["confVeto"] == 0]
    bad = [k for k in same if abs(C[k]["real"] - B[k]["real"]) > 1e-9]
    print(f"\n### {name}: {n} team-weeks")
    print(f"- reproducibility: {len(same)} team-weeks without a changed decision, {len(bad)} of them differ from P10b {bad[:5]}")
    S = [C[k]["stats"] for k in keys]
    rows = [x for s in S for x in s["log"]]
    out = {o: sum(1 for x in rows if x[11] == o) / n for o in range(5)}
    print(f"- per week: decisions {st.mean(s['decisions'] for s in S):.1f}, raced {st.mean(s['raced'] for s in S):.1f}, confirmations {st.mean(s['conf'] for s in S):.2f}, "
          f"switches added {st.mean(s['confSwitch'] for s in S):.2f}, race switches vetoed {st.mean(s['confVeto'] for s in S):.2f}, "
          f"switches total {st.mean(s['switched'] for s in S):.2f} (P10b {st.mean(B[k]['stats']['switched'] for k in keys):.2f}), "
          f"kinds {dict(sorted({w: round(sum(s['why'].get(w, 0) for s in S) / n, 2) for s in S for w in s['why']}.items()))}")
    print(f"- outcomes per week: none {out[0]:.2f}, switched by confirmation {out[1]:.2f}, vetoed {out[2]:.2f}, race switch confirmed {out[3]:.2f}, not confirmed {out[4]:.2f}")
    cr = [x for x in rows if x[7] > 0]
    if cr:
        print(f"- confirmed candidates: race gain {st.mean(x[8] for x in cr):+.2f}, confirmation gain {st.mean(x[9] for x in cr):+.2f} (se {st.mean(x[10] for x in cr):.2f}); "
              f"switched ones: race {st.mean([x[8] for x in cr if x[11] == 1] or [float('nan')]):+.2f} -> confirmation {st.mean([x[9] for x in cr if x[11] == 1] or [float('nan')]):+.2f}")
    sims = [s["sims"] + s["confSims"] for s in S]; bs = [B[k]["stats"]["sims"] for k in keys]
    print(f"- continuations per week: {st.mean(sims):.0f} (race {st.mean(s['sims'] for s in S):.0f} + confirmation {st.mean(s['confSims'] for s in S):.0f}); P10b {st.mean(bs):.0f}; "
          f"decision time {st.mean(s['ms'] for s in S) / 1000:.0f} s/wk (P10b {st.mean(B[k]['stats']['ms'] for k in keys) / 1000:.0f} s/wk; single process, 12 jobs)")
    # runner-up re-evaluation
    F = [C[k].get("fresh", []) for k in keys]
    tot = [sum(e["m"] for e in f) for f in F]
    print(f"- runner-up re-evaluation (P10c): {st.mean(len(f) for f in F):.2f} decisions/wk, **{st.mean(tot):+.2f} ± {ci(tot):.2f} pts/wk** if always switched")
    print("\n| race gap of the rejected runner-up | decisions/wk | race gap | fresh re-evaluation (mean ± 95% CI) | per week |\n|---|---|---|---|---|")
    allE = [e for f in F for e in f]
    for lo, hi in [(0.25, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 99)]:
        es = [e for e in allE if lo < e["gap"] <= hi]
        if not es: continue
        m = [e["m"] for e in es]
        print(f"| {lo}-{hi if hi < 99 else ''} | {len(es) / n:.2f} | {st.mean(e['gap'] for e in es):+.2f} | {st.mean(m):+.3f} ± {ci(m):.3f} | {sum(m) / n:+.2f} |")
    for kind in ("lock", "out", "in"):
        es = [e["m"] for e in allE if e["why"].split(" ")[0] == kind]
        if es: print(f"- runner-up kind {kind}: {len(es) / n:.2f}/wk, fresh {st.mean(es):+.3f} ± {ci(es):.3f} each")
