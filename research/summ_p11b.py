# Phase 5 extra summaries (run from research/out).
#   python3 ../summ_p11b.py risk p11/risk          risk response by margin (research/p11risk.ts)
#   python3 ../summ_p11b.py vr p11/a25 <ARM>        variance reduction of the smooth score vs one paired opponent sample
#   python3 ../summ_p11b.py calib p11/a25           the opponent model in the real season: F_opp(actual final) at our tip-offs
import json, glob, sys, math, collections

def ci(xs):
    n = len(xs); m = sum(xs) / n; v = sum((x - m) ** 2 for x in xs) / max(1, n - 1)
    return m, 1.96 * math.sqrt(v / n)

mode, pre = sys.argv[1], sys.argv[2]
files = [json.load(open(f)) for f in glob.glob(f'{pre}_*.json')]
if mode == 'risk':
    by = collections.defaultdict(list); per = []
    for d in files:
        if not d.get('res'): continue
        m = {r['margin']: r for r in d['res']}; per.append(m)
        for r in d['res']: by[r['margin']].append(r)
    print(f'states: {len(per)}')
    print('| margin (our projected final - his mean) | states | mean dial gamma | P(win) at the decision | decision changed vs P8 | sd of our final: chosen - P8 (95% CI) | E[points]: chosen - P8 | P(win): chosen - P8 |')
    print('|---|---|---|---|---|---|---|---|')
    for mg in sorted(by):
        rs = by[mg]; sd = ci([r['dSd'] for r in rs]); mp = ci([r['dMean'] for r in rs]); dw = ci([r['dWin'] for r in rs])
        pw = [r['pwin'] for r in rs if r['pwin'] is not None]
        print(f"| {mg:+d} | {len(rs)} | {sum(r['gamma'] for r in rs)/len(rs):+.4f} | {sum(pw)/max(1,len(pw)):.3f} | {100*sum(r['changed'] for r in rs)/len(rs):.0f}% | {sd[0]:+.2f} ± {sd[1]:.2f} | {mp[0]:+.2f} ± {mp[1]:.2f} | {100*dw[0]:+.2f} ± {100*dw[1]:.2f} pp |")
    # the invariants per state (risk = change in the sd of our final; tolerance 0.25 pt of sd)
    ms = sorted(by); lo, hi = ms[0], ms[-1]; close = 0
    far_more = sum(1 for m in per if m[hi]['dSd'] > m[close]['dSd'] + 0.25)
    hope_less = sum(1 for m in per if m[lo]['dSd'] < m[close]['dSd'] - 0.25)
    g_strict = sum(1 for m in per if not (m[hi]['gamma'] <= m[close]['gamma'] + 1e-12 and m[lo]['gamma'] >= m[close]['gamma'] - 1e-12))
    # relative to neutral: far ahead never more risk-seeking than max(close, 0); hopeless never more averse than min(close, 0)
    g_bad = sum(1 for m in per if m[hi]['gamma'] > max(m[close]['gamma'], 0) + 1e-12 or m[lo]['gamma'] < min(m[close]['gamma'], 0) - 1e-12)
    behind = sum(1 for m in per if all(m[x]['gamma'] >= 0 for x in ms if x < 0)); ahead = sum(1 for m in per if all(m[x]['gamma'] <= 0 for x in ms if x > 0))
    print(f'\nper state (realized risk, tolerance 0.25 pt of sd): far ahead (+{hi}) took more risk than close (0): {far_more}/{len(per)}; hopeless ({lo}) took less risk than close: {hope_less}/{len(per)}')
    print(f'dial: strict order gamma(far ahead) <= gamma(close) <= gamma(hopeless) violated in {g_strict}/{len(per)} (close is rarely exactly even: slightly ahead -> mildly averse, while far ahead / hopeless are neutral = points decide);')
    print(f'      relative to neutral (far ahead never more risk-seeking than max(close, 0), hopeless never more averse than min(close, 0)) violated in {g_bad}/{len(per)};')
    print(f'      gamma >= 0 at every margin behind: {behind}/{len(per)}; gamma <= 0 at every margin ahead: {ahead}/{len(per)}')
elif mode == 'vr':
    arm = sys.argv[3]; ratios = []; vs_all = []; vb_all = []
    for d in files:
        st = d['pols'].get(arm, {}).get('stats') or {}
        for K, ms, vs, mb, vb in (st.get('win') or {}).get('vr', []):
            if vs > 0: ratios.append(vb / vs)
            vs_all.append(vs); vb_all.append(vb)
    ratios.sort()
    print(f'decisions with the diagnostic: {len(vs_all)}; per-scenario variance of the paired difference (P8 decision vs first challenger):')
    print(f'  smooth F_opp(T): mean {sum(vs_all)/len(vs_all):.5f}; one paired opponent sample (old P4): mean {sum(vb_all)/len(vb_all):.5f}; ratio of means {sum(vb_all)/max(1e-12,sum(vs_all)):.1f}x')
    print(f'  per decision ratio: median {ratios[len(ratios)//2]:.1f}x, p25 {ratios[len(ratios)//4]:.1f}x, p75 {ratios[3*len(ratios)//4]:.1f}x; decisions where both are 0: {sum(1 for a, b in zip(vs_all, vb_all) if a == 0 and b == 0)}')
elif mode == 'calib':
    import datetime
    rows = collections.defaultdict(list)
    for d in files:
        cal = d.get('calib') or []
        if not cal: continue
        days = sorted({datetime.datetime.fromtimestamp((t - 11 * 3600e3) / 1000, datetime.timezone.utc).date() for t, *_ in cal})
        for t, locked, mean, sd, pit in cal:
            dl = len([x for x in days if x >= datetime.datetime.fromtimestamp((t - 11 * 3600e3) / 1000, datetime.timezone.utc).date()])
            rows[min(dl, 7)].append((pit, mean, d['oppActual'], sd))
    print('| our game days left | tip-offs | PIT quintiles of his actual final | predicted mean | actual mean | predicted sd |')
    print('|---|---|---|---|---|---|')
    for dl in sorted(rows):
        rs = rows[dl]; h = [0] * 5
        for p, *_ in rs: h[min(4, int(p * 5))] += 1
        print(f"| {dl if dl < 7 else '7+'} | {len(rs)} | {h} | {sum(r[1] for r in rs)/len(rs):.1f} | {sum(r[2] for r in rs)/len(rs):.1f} | {sum(r[3] for r in rs)/len(rs):.1f} |")
