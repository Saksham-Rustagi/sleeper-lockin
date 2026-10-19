"""Task O tuning on 2024-25 ONLY (the 2025-26 validation is untouched): how much of an absent rotation player's minutes
each teammate absorbs, by the teammate's baseline minutes and position overlap; and the detector's ranking metrics for
a parameter grid. usage: python3 -I research/o_tune.py research/out/o/<abs24>.json [more.json ...]"""
import json, sys, collections, statistics as st


def buckets(path):
    d = json.load(open(path))
    B = [0, 3, 8, 14, 20, 26, 32, 99]
    agg = collections.defaultdict(list)
    for r in d["rows"]:
        for c in r["cands"]:
            if c["realMin"] is None or c["nWin"] < max(1, min(5, r["len"]) // 2): continue
            b = next(i for i in range(len(B) - 1) if B[i] <= c["base"] < B[i + 1])
            ov = 1 if c["overlap"] >= 1 else 0.6 if c["overlap"] >= 0.6 else 0.3 if c["overlap"] >= 0.3 else 0.1
            agg[(b, ov)].append((c["realMin"] - c["base"]) / r["mpg"])
    print("share of the absent player's minutes absorbed per teammate (mean, n) by baseline minutes x position overlap")
    ovs = [1, 0.6, 0.3, 0.1]
    print("base      " + "".join(f"{o:>16}" for o in ovs))
    for i in range(len(B) - 1):
        print(f"{B[i]:>2}-{B[i+1]:<5}  " + "".join(f"{st.mean(agg[(i, o)]):>+9.3f} ({len(agg[(i, o)]):>4})" if agg[(i, o)] else f"{'-':>16}" for o in ovs))


def metrics(path):
    d = json.load(open(path)); P = d["P"]
    top1, top3, rec, mae, fpe, n_abs = [], [], [], [], [], 0
    for r in d["rows"]:
        cs = [c for c in r["cands"] if c["realMin"] is not None and c["nWin"] >= max(1, min(5, r["len"]) // 2)]
        if not cs: continue
        n_abs += 1
        cs.sort(key=lambda c: c["rank"])
        g = lambda c: c["realMin"] - c["base"]
        top1.append(g(cs[0])); top3 += [g(c) for c in cs[:3]]
        absorbers = [c for c in cs if g(c) >= 6]
        if absorbers: rec.append(sum(1 for c in absorbers if c["rank"] < 3) / len(absorbers))
        mae += [abs(c["gain"] - g(c)) for c in cs if c["base"] >= 3 or c["gain"] >= 2]
        # fp per minute quality given the realized minutes (players with >= 10 min in the window)
        fpe += [c["rate"] * c["realMin"] - c["realFp"] for c in cs if c["realMin"] >= 10]
    p1 = sum(x >= 4 for x in top1) / len(top1); p3 = sum(x >= 4 for x in top3) / len(top3)
    print(f"{json.dumps({k: P.get(k) for k in ('bPrior', 'bTrend', 'bWo', 'rateK')})}: absences {n_abs}  P@1 {p1:.3f}  P@3 {p3:.3f}  recall@3 {st.mean(rec):.3f}  "
          f"top1 gain {st.mean(top1):+.2f}  top3 gain {st.mean(top3):+.2f}  minutes MAE {st.mean(mae):.2f}  fp|min bias {st.mean(fpe):+.2f} MAE {st.mean(abs(x) for x in fpe):.2f}")


if __name__ == "__main__":
    buckets(sys.argv[1])
    for f in sys.argv[1:]: metrics(f)
