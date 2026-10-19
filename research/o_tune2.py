"""Task O tuning on 2024-25 only: least squares of a teammate's realized minutes gain on the prior-table gain, his recent
trend (last 3 - baseline) and the with/without delta (shrunk with k pseudo-games). usage: python3 -I research/o_tune2.py abs24.json"""
import json, sys


def lstsq(X, y):
    m = len(X[0]); A = [[sum(r[i] * r[j] for r in X) for j in range(m)] + [sum(r[i] * t for r, t in zip(X, y))] for i in range(m)]
    for i in range(m):
        piv = max(range(i, m), key=lambda r: abs(A[r][i])); A[i], A[piv] = A[piv], A[i]
        for r in range(m):
            if r != i and A[i][i]:
                f = A[r][i] / A[i][i]; A[r] = [a - f * b for a, b in zip(A[r], A[i])]
    return [A[i][m] / A[i][i] if A[i][i] else 0.0 for i in range(m)]


def mean(v): return sum(v) / len(v)

B = [0, 3, 8, 14, 20, 26, 32, 99]
OV = [1, 0.6, 0.3, 0.1]
d = json.load(open(sys.argv[1]))
# share table from the same data (fit = tuning season)
cells = {}
for r in d["rows"]:
    for c in r["cands"]:
        if c["realMin"] is None or c["nWin"] < max(1, min(5, r["len"]) // 2): continue
        b = next(i for i in range(len(B) - 1) if B[i] <= c["base"] < B[i + 1])
        o = min(range(4), key=lambda j: abs(OV[j] - c["overlap"]))
        cells.setdefault((b, o), []).append((c["realMin"] - c["base"]) / r["mpg"])
share = {k: mean(v) for k, v in cells.items()}
print("share table:", [[round(share.get((b, o), 0), 3) for o in range(4)] for b in range(len(B) - 1)])
for k in (2, 4, 8, 16):
    X, y = [], []
    for r in d["rows"]:
        for c in r["cands"]:
            if c["realMin"] is None or c["nWin"] < max(1, min(5, r["len"]) // 2): continue
            b = next(i for i in range(len(B) - 1) if B[i] <= c["base"] < B[i + 1]); o = min(range(4), key=lambda j: abs(OV[j] - c["overlap"]))
            n = c["wo"]["n"] + 0.5 * c["wo"]["nPrev"]; dl = c["wo"]["delta"] if c["wo"]["delta"] is not None else 0
            X.append([share.get((b, o), 0) * r["mpg"], c["last3"] - c["base"], n / (n + k) * dl, 1.0]); y.append(c["realMin"] - c["base"])
    beta = lstsq(X, y)
    pred = [sum(b * x for b, x in zip(beta, r)) for r in X]; my = mean(y)
    r2 = 1 - sum((a - b) ** 2 for a, b in zip(y, pred)) / sum((a - my) ** 2 for a in y)
    print(f"k={k}: beta prior {beta[0]:.3f}  trend {beta[1]:.3f}  wo {beta[2]:.3f}  const {beta[3]:.3f}  R2 {r2:.3f}  n {len(y)}  with wo>0: {sum(1 for r in X if r[2] != 0)}")
