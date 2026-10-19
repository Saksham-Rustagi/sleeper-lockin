"""Task O tuning on 2024-25 only: expected minutes of a free agent over his next 5 team games from his last-3 / last-10
minutes and Sleeper's projected minutes for his next game (least squares over every evaluation, research/o_val.ts
surgefeat). Also: how the fitted surge rule's flags would have turned out in 2024-25 (in-sample).
usage: python3 -I research/o_tune3.py research/out/o/tune24_surgefeat.json"""
import json, sys, statistics as st


def lstsq(X, y):
    m = len(X[0]); A = [[sum(r[i] * r[j] for r in X) for j in range(m)] + [sum(r[i] * t for r, t in zip(X, y))] for i in range(m)]
    for i in range(m):
        piv = max(range(i, m), key=lambda r: abs(A[r][i])); A[i], A[piv] = A[piv], A[i]
        for r in range(m):
            if r != i and A[i][i]:
                f = A[r][i] / A[i][i]; A[r] = [a - f * b for a, b in zip(A[r], A[i])]
    return [A[i][m] / A[i][i] if A[i][i] else 0.0 for i in range(m)]


d = json.load(open(sys.argv[1])); F = d["feats"]
c = {k: i for i, k in enumerate(d["cols"])}
X = [[f[c["last3"]], f[c["last10"]], f[c["projMin"]], f[c["hasProj"]], 1.0] for f in F]
y = [f[c["nextMin"]] for f in F]
b = lstsq(X, y)
pred = [sum(x * w for x, w in zip(r, b)) for r in X]; my = st.mean(y)
r2 = 1 - sum((a - p) ** 2 for a, p in zip(y, pred)) / sum((a - my) ** 2 for a in y)
print(f"n {len(y)}  nextMin = {b[0]:.3f} last3 + {b[1]:.3f} last10 + {b[2]:.3f} projMin + {b[3]:.3f} hasProj + {b[4]:.3f}   R2 {r2:.3f}")
# fp: rate x predicted minutes vs realized next-5 fp; and Sleeper's projection
est = [f[c["rate"]] * max(0, p) for f, p in zip(F, pred)]
yf = [f[c["nextFp"]] for f in F]; sp = [f[c["projFp"]] for f in F]
print(f"fp: est bias {st.mean(e - a for e, a in zip(est, yf)):+.2f} MAE {st.mean(abs(e - a) for e, a in zip(est, yf)):.2f};  "
      f"Sleeper next-game projection (0 if none) bias {st.mean(s - a for s, a in zip(sp, yf)):+.2f} MAE {st.mean(abs(s - a) for s, a in zip(sp, yf)):.2f}")
# where the fitted estimate beats Sleeper by a margin: outcomes
for mm, fp, edge in [(8, 20, 5), (6, 18, 4), (5, 16, 4), (4, 15, 3), (6, 15, 5)]:
    sel = [i for i, f in enumerate(F) if f[c["played3"]] == 3 and f[c["last3"]] >= f[c["projMin"]] + mm and est[i] >= fp and est[i] >= f[c["projFp"]] + edge]
    if not sel: print(f"  rule +{mm} min, est >= {fp}, edge {edge}: no evaluations"); continue
    print(f"  rule +{mm} min, est >= {fp}, edge {edge}: {len(sel)} evaluations; realized {st.mean(yf[i] for i in sel):.1f} fp/g, est {st.mean(est[i] for i in sel):.1f}, "
          f"Sleeper {st.mean(sp[i] for i in sel):.1f}; realized >= Sleeper + 5: {st.mean(yf[i] >= sp[i] + 5 for i in sel):.0%}; minutes {st.mean(y[i] for i in sel):.1f} vs pred {st.mean(pred[i] for i in sel):.1f}")
