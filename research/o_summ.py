"""Task O summary of the pre-registered tests (a) detector, (b) lead time, (d) surge watch (research/REPORT.md
"Opportunity alerts"). usage: python3 -I research/o_summ.py research/out/o/v25_abs.json research/out/o/v25_surges.json"""
import json, sys, math, statistics as st, collections

absf, surf = sys.argv[1], sys.argv[2]
D = json.load(open(absf))


def ci(xs):
    if len(xs) < 2: return float("nan")
    return 1.96 * st.pstdev(xs) / math.sqrt(len(xs))


def fmt(xs): return f"{st.mean(xs):+.2f} ± {ci(xs):.2f}" if xs else "–"


# ---------- (a) ----------
rows = []
for r in D["rows"]:
    win = min(5, r["len"])
    cs = [c for c in r["cands"] if c["realMin"] is not None and c["nWin"] >= max(1, win // 2)]
    if not cs: continue
    for c in cs: c["g"] = c["realMin"] - c["base"]; c["gf"] = c["realFp"] - c["baseFp"]
    det = sorted(cs, key=lambda c: c["rank"])
    pri = sorted(cs, key=lambda c: -c["prior"])
    naive = sorted([c for c in cs if c["overlap"] >= 1 and c["base"] < 26], key=lambda c: -c["base"]) or sorted(cs, key=lambda c: -c["base"])
    rows.append((r, cs, det, pri, naive))
print(f"## (a) detector: {len(rows)} absences of rotation players (>= 2 games), 2025-26\n")
print("| ranking | P@1 (gain >= 4) | P@3 | recall@3 (absorbers >= 6) | top-1 min gain | top-1 fp/g gain | top-3 min gain | top-3 fp/g gain |")
print("|---|---|---|---|---|---|---|---|")
for name, k in (("detector", 2), ("prior only", 3), ("naive (same position, most minutes < 26)", 4)):
    t1 = [x[k][0] for x in rows]; t3 = [c for x in rows for c in x[k][:3]]
    rec = []
    for x in rows:
        ab = [c for c in x[1] if c["g"] >= 6]
        if ab: top = set(c["pid"] for c in x[k][:3]); rec.append(sum(c["pid"] in top for c in ab) / len(ab))
    print(f"| {name} | {st.mean(c['g'] >= 4 for c in t1):.0%} | {st.mean(c['g'] >= 4 for c in t3):.0%} | {st.mean(rec):.0%} | {fmt([c['g'] for c in t1])} | {fmt([c['gf'] for c in t1])} | {fmt([c['g'] for c in t3])} | {fmt([c['gf'] for c in t3])} |")
allc = [c for x in rows for c in x[1]]; rot = [c for c in allc if c["base"] >= 10]
print(f"| every teammate (mean) | | | | {fmt([c['g'] for c in allc])} | {fmt([c['gf'] for c in allc])} | | |")
print(f"| teammates with >= 10 baseline min | | | | {fmt([c['g'] for c in rot])} | {fmt([c['gf'] for c in rot])} | | |")
# calibration of predicted minutes gain (top-3), bins
print("\nPredicted vs realized minutes gain, detector top-3:\n")
print("| predicted gain | n | predicted | realized min | realized fp/g | predicted fp/g gain |")
print("|---|---|---|---|---|---|")
t3 = [c for x in rows for c in x[2][:3]]
for lo, hi in ((-99, 2), (2, 4), (4, 7), (7, 10), (10, 99)):
    s = [c for c in t3 if lo <= c["gain"] < hi]
    if s: print(f"| {lo if lo > -99 else '<'}{'-' + str(hi) if hi < 99 else '+'} | {len(s)} | {st.mean(c['gain'] for c in s):+.1f} | {fmt([c['g'] for c in s])} | {fmt([c['gf'] for c in s])} | {st.mean(c['estGain'] for c in s):+.1f} |")
# top-1 by the absent player's minutes
big = [x for x in rows if x[0]["mpg"] >= 30]
print(f"\nAbsent player >= 30 mpg ({len(big)} absences): detector top-1 P@1 {st.mean(x[2][0]['g'] >= 4 for x in big):.0%}, min gain {fmt([x[2][0]['g'] for x in big])}, fp/g {fmt([x[2][0]['gf'] for x in big])}")
fa_like = [c for x in rows for c in x[2][:3] if c["est"] >= 15 and c["gain"] >= 4]
print(f"Alert-grade top-3 candidates (expected gain >= 4 min, estimate >= 15 fp/g; any roster status): {len(fa_like)}; realized min gain {fmt([c['g'] for c in fa_like])}, "
      f"fp/g gain {fmt([c['gf'] for c in fa_like])}; estimate {st.mean(c['est'] for c in fa_like):.1f} vs realized fp/g {st.mean(c['realFp'] for c in fa_like):.1f}")

# ---------- (b) lead time ----------
print("\n## (b) lead time vs Sleeper's projection\n")
for unit in ("fp", "min"):
    cases = [(x[0], c) for x in rows for c in x[2][:3] if c["g"] >= 4 and c["gf"] >= 3]
    lead_g, lead_d, cens, det0, slp0, n = [], [], 0, 0, 0, 0
    cross = collections.Counter(); xlead = []
    for r, c in cases:
        base = c["projBase"] if unit == "fp" else c["projMinBase"]
        need = 0.5 * (c["gf"] if unit == "fp" else c["g"])
        if base is None: base = 0.0
        n += 1
        d_est = c["estGain"] if unit == "fp" else c["gain"]
        if d_est >= need: det0 += 1
        j_hit = None; dates = [s[0] for s in c["seq"] if s]
        for j, s in enumerate(c["seq"]):
            if not s or not s[3]: continue  # DNP: no information
            v = (s[1] if s[1] is not None else 0) if unit == "fp" else (s[2] if s[2] is not None else 0)
            if v - base >= need: j_hit = j; break
        dc = d_est >= need
        cross[(dc, "never" if j_hit is None else "game 0" if j_hit == 0 else "later")] += 1
        if dc and j_hit is not None and j_hit > 0: xlead.append(j_hit)
        if j_hit is None: cens += 1; continue
        if j_hit == 0: slp0 += 1
        lead_g.append(j_hit)
        d0 = next(s[0] for s in c["seq"] if s); dj = c["seq"][j_hit][0]
        y0, m0, dd0 = map(int, d0.split("-")); y1, m1, dd1 = map(int, dj.split("-"))
        import datetime
        lead_d.append((datetime.date(y1, m1, dd1) - datetime.date(y0, m0, dd0)).days)
    q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))] if xs else float("nan")
    print(f"- {unit}: {n} cases (top-3 with realized >= +4 min and >= +3 fp/g). Detector's estimate at game 0 already >= half the realized "
          f"gain: {det0 / n:.0%}. Sleeper reached half the realized gain at game 0 (no lead): {slp0 / n:.0%}; later: {len(lead_g) - slp0} "
          f"({(len(lead_g) - slp0) / n:.0%}); never within the absence: {cens} ({cens / n:.0%}). Among cases Sleeper reached: lead "
          f"mean {st.mean(lead_g):.2f} games (median {q(lead_g, .5)}, p75 {q(lead_g, .75)}), {st.mean(lead_d):.1f} days (median {q(lead_d, .5)}, p75 {q(lead_d, .75)})")
    hist = collections.Counter(lead_g)
    print(f"  games until Sleeper caught up: {dict(sorted(hist.items()))}, censored {cens}")
    print(f"  paired: detector caught up at game 0 AND Sleeper at game 0 {cross[(True, 'game 0')]}, Sleeper later {cross[(True, 'later')]} "
          f"(lead {st.mean(xlead) if xlead else float('nan'):.2f} games), Sleeper never {cross[(True, 'never')]}; detector not at game 0: Sleeper at game 0 "
          f"{cross[(False, 'game 0')]}, later {cross[(False, 'later')]}, never {cross[(False, 'never')]}")

# ---------- (d) surge ----------
S = json.load(open(surf))
print(f"\n## (d) surge watch: {S['n']} flags of league free agents in {S['evals']} evaluations\n")
for r in S["rows"]:
    s = [x for x in r["seq"] if x][:5]
    rf = st.mean(x[5] for x in s) if s else float("nan"); pf = st.mean((x[1] if x[1] is not None else 0) for x in s) if s else float("nan")
    print(f"- {r['date']} {r['name']} ({r['team']}): {r['why']}; next {len(s)} team games: {rf:.1f} fp/g, {st.mean(x[4] for x in s) if s else float('nan'):.1f} min; Sleeper projected {pf:.1f}")
