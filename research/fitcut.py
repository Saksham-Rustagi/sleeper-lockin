# Approximate policy iteration, step 2: fit cut-off = coef . features to the simulated true cut-offs.
# Cross-fitted (train odd weeks -> test even, and vice versa). Scores held-out "regret": points lost by deciding on the
# wrong side of the true cut-off (|X - y| when wrong), vs the heuristic rule (lock iff X >= heuristic cut-off).
import json, glob, sys, numpy as np
pref = sys.argv[1] if len(sys.argv) > 1 else 'ld0'; tag = sys.argv[2] if len(sys.argv) > 2 else 'v1'
R = []
for f in glob.glob(f'/root/sleeper-lockin/research/out/{pref}_*.json'): R += json.load(open(f))
F = np.array([r['f'] for r in R]); y = np.array([r['y'] for r in R]); X = np.array([r['X'] for r in R]); wk = np.array([r['week'] for r in R]); se = np.array([r['se'] for r in R])
print(f'{len(R)} decisions; true cut-off mean {y.mean():.1f}, heuristic mean {F[:,1].mean():.1f}, corr {np.corrcoef(y, F[:,1])[0,1]:.2f}')
def regret(cut, m): wrong = (X[m] >= cut[m]) != (X[m] >= y[m]); return np.abs(X[m] - y[m])[wrong].sum()
tot = {'heuristic': 0.0, 'learned': 0.0}; nweeks = len(set(wk))
for train_par, test_par in [(1, 0), (0, 1)]:
    tr = wk % 2 == train_par; te = ~tr
    w = np.exp(-np.abs(X[tr] - y[tr]) / 8) / (se[tr] ** 2 + 4)   # focus on decisions near the cut-off
    W = np.sqrt(w)[:, None]
    coef, *_ = np.linalg.lstsq(F[tr] * W, y[tr] * W[:, 0], rcond=None)
    cut = F @ coef
    rh, rl = regret(F[:, 1], te), regret(cut, te)
    tot['heuristic'] += rh; tot['learned'] += rl
    name = 'odd' if train_par == 1 else 'even'
    json.dump({'coef': coef.tolist(), 'trained_on': name, 'n': int(tr.sum())}, open(f'/root/sleeper-lockin/research/cut/{tag}_{name}.json', 'w'))
    rmse_h = np.sqrt(np.mean((F[te,1] - y[te]) ** 2)); rmse_l = np.sqrt(np.mean((cut[te] - y[te]) ** 2))
    print(f'train {name:4s} -> test: cut-off error (RMSE) heuristic {rmse_h:.1f} vs learned {rmse_l:.1f}; regret heuristic {rh:.0f} vs learned {rl:.0f} pts')
# final rule on all weeks (for the live app)
w = np.exp(-np.abs(X - y) / 8) / (se ** 2 + 4); W = np.sqrt(w)[:, None]
coef, *_ = np.linalg.lstsq(F * W, y * W[:, 0], rcond=None)
json.dump({'coef': coef.tolist(), 'trained_on': 'all', 'n': len(R)}, open(f'/root/sleeper-lockin/research/cut/{tag}_all.json', 'w'))
names = ['const', 'heuristic', 'own future value', 'open slots', 'games/slot', 'week left', 'own games left', 'heur*left', 'games/slot*left', 'ownval*left']
print('coef (all weeks):', ', '.join(f'{n} {c:+.2f}' for n, c in zip(names, coef)))
print(f"held-out regret per team-week: heuristic {tot['heuristic']/230:.2f} vs learned {tot['learned']/230:.2f} pts (decision-level, base continuation)")
