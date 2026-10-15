# Phase 5 summaries (run from research/out).
#   sim (validation b):  python3 ../summ_p11.py sim <prefix,prefix,...> <BASE> [ARM ...]
#       research/p11run.ts sim-mode outputs; per model week (week, rid, j) every arm's outcome is the mean over its late-week
#       completions (K = 1, or KC for weeks still open at the branch). Win = binary vs the opponent's final; RB win =
#       P(his final < ours | his state at our last tip-off) (Rao-Blackwellized, same expectation, less noise).
#       --c0: only completion 0 (the drawn week): pairs runs whose branch moments differ (e.g. the ramp schedule).
#   real (validation a): python3 ../summ_p11.py real <prefix,...> <BASE> [ARM ...]
#       real-mode outputs; BASE may be "s10:P10" = P10 from the Phase-3 season run (same seeds, reproduced exactly).
# Paired diffs with 95% CIs: naive (over model / team-weeks) and clustered by week (mean of the week's diffs, CI over weeks).
import json, glob, sys, math, collections

def win(t, o): return 1.0 if t > o else 0.5 if t == o else 0.0

C0 = '--c0' in sys.argv  # only completion 0 (the drawn week itself): pairs runs with different branch moments

def load(prefixes, mode):
    rows = {}
    for pre in prefixes.split(','):
        # season tag from the prefix's last two digits (p11/u25, p11/c24; s10 = 2025-26): keys pair arms of one season
        base_pre = pre.split(':')[0]
        sea = base_pre[-2:] if base_pre[-2:].isdigit() and not base_pre.startswith('s10') else '25'
        if ':' in pre:  # s10:P10 (Phase-3 season run): pols[name].real
            pre, nm = pre.split(':')
            for f in glob.glob(f'{pre}_*.json'):
                d = json.load(open(f)); k = (sea, d['week'], str(d['rid']), 0)
                rows.setdefault(k, {})[nm] = {'total': d['pols'][nm]['real']}
            continue
        for f in glob.glob(f'{pre}_*.json'):
            d = json.load(open(f))
            if mode == 'sim':
                for r in d['rows']:
                    k = (sea, r['week'], str(r['rid']), r['j']); e = rows.setdefault(k, {})
                    comps = r.get('comps') or [{'c': 0, 'oppFinal': r['oppFinal'], 'pols': r['pols']}]
                    if C0: comps = comps[:1]
                    if r.get('pB') is not None or '_pB' not in e: e['_pB'] = r.get('pB')
                    e['_K'] = len(comps)
                    for nm in comps[0]['pols']:
                        vs = [c['pols'][nm] for c in comps]
                        e[nm] = {'total': sum(v['total'] for v in vs) / len(vs), 'win': sum(win(v['total'], c['oppFinal']) for v, c in zip(vs, comps)) / len(vs),
                                 'rb': sum(v.get('smooth', win(v['total'], c['oppFinal'])) for v, c in zip(vs, comps)) / len(vs),
                                 'stats': [v.get('stats') for v in vs], 'viol': vs[0].get('viol'), 'scratch': vs[0].get('scratch'), 'total0': vs[0]['total']}
            else:
                k = (sea, d['week'], str(d['rid']), 0); e = rows.setdefault(k, {}); e['_opp'] = d['oppActual']; e['_calib'] = d.get('calib')
                for nm, v in d['pols'].items(): e[nm] = {**v, 'stats': [v.get('stats')]}
    if mode == 'real':
        for e in rows.values():
            for nm, v in e.items():
                if not nm.startswith('_') and '_opp' in e: v['win'] = v['rb'] = win(v['total'], e['_opp'])
    return rows

def ci(xs):
    n = len(xs); m = sum(xs) / n; v = sum((x - m) ** 2 for x in xs) / max(1, n - 1)
    return m, 1.96 * math.sqrt(v / n)

def summarize(rows, base, arms, label='', stratum=None):
    out = []
    for a in arms:
        ks = [k for k, e in rows.items() if a in e and base in e and 'win' in e[a] and 'win' in e[base] and (stratum is None or stratum(e))]
        if not ks: continue
        res = dict(arm=a, n=len(ks))
        for key in ('win', 'rb', 'total'):
            d = [rows[k][a][key] - rows[k][base][key] for k in ks]
            byw = collections.defaultdict(list)
            for k, x in zip(ks, d): byw[(k[0], k[1])].append(x)
            m, e = ci(d); _, ew = ci([sum(v) / len(v) for v in byw.values()])
            res[key] = (sum(rows[k][a][key] for k in ks) / len(ks), sum(rows[k][base][key] for k in ks) / len(ks), m, e, ew)
        res['flips'] = (sum(1 for k in ks if rows[k][a]['win'] > rows[k][base]['win']), sum(1 for k in ks if rows[k][a]['win'] < rows[k][base]['win']))
        res['viol'] = sum((rows[k][a].get('viol') or 0) for k in ks)
        st = [s for k in ks for s in rows[k][a]['stats'] if s]
        wd = [s['win'] for s in st if s.get('win')]
        nd = sum(w['decisions'] for w in wd)
        res['wdec'] = nd / max(1, len(st)); res['tilt'] = sum(w['absTilt'] for w in wd) / max(1, nd)
        res['sw'] = sum(s.get('switched', 0) for s in st) / max(1, len(st))
        out.append(res)
    print(f"| arm{label} | weeks | win% (base) | win% diff (CI naive / week) | RB win% (base) | **RB win% diff** (CI naive / week) | flips up / down | pts/wk (base) | pts diff (CI naive / week) | rule viol. | win-phase decisions/wk | mean abs tilt | changed/wk |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in out:
        w, b, t = r['win'], r['rb'], r['total']
        print(f"| {r['arm']} | {r['n']} | {100*w[0]:.1f} ({100*w[1]:.1f}) | {100*w[2]:+.2f} ± {100*w[3]:.2f} / ± {100*w[4]:.2f} | {100*b[0]:.2f} ({100*b[1]:.2f}) | **{100*b[2]:+.2f}** ± {100*b[3]:.2f} / ± {100*b[4]:.2f} | {r['flips'][0]} / {r['flips'][1]} | {t[0]:.1f} ({t[1]:.1f}) | {t[2]:+.2f} ± {t[3]:.2f} / ± {t[4]:.2f} | {r['viol']} | {r['wdec']:.1f} | {r['tilt']:.4f} | {r['sw']:.2f} |")
    return out

if __name__ == '__main__':
    mode, prefixes, base = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = load(prefixes, mode)
    if ':' in base: base = base.split(':')[1]
    arms = [a for a in sys.argv[4:] if not a.startswith('--')] or sorted({a for e in rows.values() for a in e if not a.startswith('_') and a != base})
    summarize(rows, base, arms)
    if mode == 'sim':
        print(); print('Strata by P10\'s win probability at the branch (close: 0.02-0.98, those weeks have KC completions):')
        summarize(rows, base, arms, ' (close)', lambda e: e.get('_pB') is not None and 0.02 < e['_pB'] < 0.98)
        summarize(rows, base, arms, ' (decided)', lambda e: not (e.get('_pB') is not None and 0.02 < e['_pB'] < 0.98))
        ks = list(rows); close = [k for k in ks if rows[k].get('_pB') is not None and 0.02 < rows[k]['_pB'] < 0.98]
        print(f"\nmodel weeks {len(ks)}, close at the branch {len(close)} ({100*len(close)/max(1,len(ks)):.0f}%), completions {sum(rows[k]['_K'] for k in ks)}")
