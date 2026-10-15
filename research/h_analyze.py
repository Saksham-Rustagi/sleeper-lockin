# Task H analysis of research/htrace.ts outputs (research/out/h/*). Run with: python3 -E research/h_analyze.py
# Writes research/out/h/part1.md, part2.md, h_fill_curve.png, h_all9_cdf.png, summary.json.
import json, glob, os, math, statistics as St
from collections import defaultdict
from datetime import datetime, timezone, timedelta

OUT = 'research/out/h'
SLOTN = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL']
ET = timezone(timedelta(hours=-5))
def etd(t): return datetime.fromtimestamp(t / 1000, ET)

def load(prefix):
    rows = {}
    for f in glob.glob(f'{OUT}/{prefix}_*.json'):
        d = json.load(open(f)); rows[(d['week'], d['rid'])] = d
    return rows

def ci(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2: return (St.mean(xs) if xs else float('nan'), float('nan'), len(xs))
    return (St.mean(xs), 1.96 * St.stdev(xs) / math.sqrt(len(xs)), len(xs))
def fmt(c, d=2): return f"{c[0]:.{d}f} ± {c[1]:.{d}f}" if not math.isnan(c[1]) else f"{c[0]:.{d}f}"
def q(xs, p):
    xs = sorted(xs);
    if not xs: return float('nan')
    k = (len(xs) - 1) * p; f = math.floor(k); c = min(f + 1, len(xs) - 1); return xs[f] + (xs[c] - xs[f]) * (k - f)

# ---------------- agents per team-week ----------------
def agents_of(season):
    """{agent: {(w,rid): (row, slots, total)}} merged over the traced files of a season."""
    base = load('r25' if season == 25 else 'r24'); b10 = load('r25b' if season == 25 else 'r24b')
    A = defaultdict(dict)
    for k, d in base.items():
        for pn in ('P7H_LheldTie', 'P8'):
            if pn in d['pols']: A[pn][k] = (d, d['pols'][pn]['slots'], d['pols'][pn]['total'])
        A['hindsight'][k] = (d, d['hs']['slots'], d['hs']['total'])
        if d.get('human') and d['human'].get('total') is not None: A['human'][k] = (d, d['human']['slots'], d['human']['total'])
    for k, d in b10.items():
        if 'P10b' in d['pols']: A['P10b'][k] = (d, d['pols']['P10b']['slots'], d['pols']['P10b']['total'])
    return A

def week_frame(d):
    g = d['games']; T0 = min(x[1] for x in g); T1 = max(x[2] for x in g)
    days = sorted({etd(x[1]).date() for x in g})
    tips = sorted(x[1] for x in g)
    return T0, T1, days, tips

def part1(season, keys=None):
    A = agents_of(season); out = {}
    for ag, tws in A.items():
        if keys is not None: tws = {k: v for k, v in tws.items() if k in keys}
        if not tws: continue
        all9_el, all9_dow, all9_gday, all9_tipped, emptyN, neg, weak, slots_n = [], [], [], [], 0, 0, 0, 0
        byType = defaultdict(list); byTypeX = defaultdict(list); byTypeLock = defaultdict(list)
        openByDay = defaultdict(list); openPtsByDay = defaultdict(list); fill = defaultdict(list); fillVal = defaultdict(list); valLag = []
        lockStats = {'n': 0, 'later_better': 0, 'shortfall': 0.0, 'hours_after_end': [], 'at_deadline': 0}
        for k, (d, slots, total) in tws.items():
            T0, T1, days, tips = week_frame(d); span = T1 - T0
            secs = []
            for s, sl in enumerate(slots):
                slots_n += 1; x = sl['x'] or 0
                if sl['how'] in ('none', 'unmatched', 'offroster') or sl['tSec'] is None:
                    if x <= 0: emptyN += 1
                    secs.append(None); byTypeX[SLOTN[s]].append(x); continue
                if x < 0: neg += 1
                if x < 10: weak += 1
                t = sl['tSec']; secs.append(t)
                byType[SLOTN[s]].append((t - T0) / span); byTypeX[SLOTN[s]].append(x); byTypeLock[SLOTN[s]].append(1 if sl['how'] == 'lock' else 0)
                if sl['how'] == 'lock' and ag != 'hindsight':
                    # own-player ex-post check: did one of his later games beat the locked score?
                    p = sl['p']; later = [g for g in d['games'] if g[0] == p and g[1] > d['games'][sl['g']][2]]
                    lockStats['n'] += 1
                    if later:
                        best = max((g[4] if g[3] else 0) for g in later)
                        if best > x: lockStats['later_better'] += 1; lockStats['shortfall'] += best - x
                    if sl.get('tLock') is not None:
                        lockStats['hours_after_end'].append((sl['tLock'] - d['games'][sl['g']][2]) / 3600e3)
                        nxt = [g[1] for g in later];
                        if nxt and abs(min(nxt) - sl['tLock']) < 1: lockStats['at_deadline'] += 1
            last = max([t for t in secs if t is not None] + [T0]) if all(t is not None for t in secs) else T1
            all9_el.append((last - T0) / span); all9_dow.append(etd(last).strftime('%a'))
            ld = etd(last).date(); all9_gday.append(sum(1 for x in days if x <= ld) / len(days))
            all9_tipped.append(sum(1 for t in tips if t <= last) / len(tips))
            # open slots / points at the start of each game day (first tip of the day)
            for i, day in enumerate(days):
                t = min(x[1] for x in d['games'] if etd(x[1]).date() == day)
                op = [s for s, ts in enumerate(secs) if ts is None or ts >= t]
                openByDay[i + 1].append(len(op)); openPtsByDay[i + 1].append(sum((slots[s]['x'] or 0) for s in op))
            # secured share of final points vs elapsed fraction
            vals = [(d['games'][sl['g']][2] if (secs[s] is not None and (sl.get('g') if sl.get('g') is not None else -1) >= 0) else None) for s, sl in enumerate(slots)]
            for s, sl in enumerate(slots):
                if secs[s] is not None and vals[s] is not None: valLag.append((secs[s] - vals[s]) / 3600e3)
            for j in range(0, 21):
                tt = T0 + span * j / 20
                fill[j].append(sum((slots[s]['x'] or 0) for s, ts in enumerate(secs) if ts is not None and ts <= tt) / max(1e-9, total))
                fillVal[j].append(sum((slots[s]['x'] or 0) for s, ts in enumerate(vals) if ts is not None and ts <= tt) / max(1e-9, total))
        out[ag] = dict(n=len(tws), total=St.mean(v[2] for v in tws.values()), all9_el=all9_el, all9_dow=all9_dow, all9_gday=all9_gday, all9_tipped=all9_tipped,
                       empty=emptyN / slots_n, neg=neg / slots_n, weak=weak / slots_n, byType={t: (St.median(v), St.mean(byTypeLock[t])) for t, v in byType.items()},
                       byTypeX={t: St.mean(v) for t, v in byTypeX.items()},
                       openByDay={i: (St.mean(v), St.mean(openPtsByDay[i]), len(v)) for i, v in openByDay.items()}, fill={j: St.mean(v) for j, v in fill.items()}, fillVal={j: St.mean(v) for j, v in fillVal.items()},
                       valLag=St.mean(valLag) if valLag else None, fillAt={p: St.mean(fill[p // 5]) for p in (25, 50, 75)}, fillValAt={p: St.mean(fillVal[p // 5]) for p in (25, 50, 75)},
                       lock=dict(n=lockStats['n'], perWeek=lockStats['n'] / len(tws), laterBetter=lockStats['later_better'] / max(1, lockStats['n']),
                                 shortfallPerWeek=lockStats['shortfall'] / len(tws), hoursAfterEnd=St.median(lockStats['hours_after_end']) if lockStats['hours_after_end'] else None,
                                 atDeadline=lockStats['at_deadline'] / max(1, len(lockStats['hours_after_end']))))
    return out

def part1_md(res, title):
    order = [a for a in ('human', 'P7H_LheldTie', 'P8', 'P10b', 'hindsight') if a in res]
    L = [f'### {title}', '', '| | ' + ' | '.join(order) + ' |', '|---|' + '---|' * len(order)]
    row = lambda name, f: L.append(f'| {name} | ' + ' | '.join(f(res[a]) for a in order) + ' |')
    row('team-weeks', lambda r: str(r['n']))
    row('mean total (pts/wk)', lambda r: f"{r['total']:.1f}")
    row('all 9 secured: % of game-time elapsed p10 / p50 / p90', lambda r: f"{100*q(r['all9_el'],.1):.0f} / {100*q(r['all9_el'],.5):.0f} / {100*q(r['all9_el'],.9):.0f}")
    row('all 9 secured: % of own games tipped p10 / p50 / p90', lambda r: f"{100*q(r['all9_tipped'],.1):.0f} / {100*q(r['all9_tipped'],.5):.0f} / {100*q(r['all9_tipped'],.9):.0f}")
    row('all 9 secured: day of week (most common, share)', lambda r: (lambda c: f"{c[0][0]} {100*c[0][1]/len(r['all9_dow']):.0f}%, {c[1][0]} {100*c[1][1]/len(r['all9_dow']):.0f}%")(sorted(((x, r['all9_dow'].count(x)) for x in set(r['all9_dow'])), key=lambda z: -z[1]) + [('-', 0)]))
    row('% of final points secured (committed) at 25 / 50 / 75% of game-time', lambda r: ' / '.join(f"{100*r['fillAt'][p]:.0f}" for p in (25, 50, 75)))
    row('% of final points already scored (counted game over) at 25 / 50 / 75%', lambda r: ' / '.join(f"{100*r['fillValAt'][p]:.0f}" for p in (25, 50, 75)))
    row("mean hours from the counted game's end to the commitment (lock or final game end)", lambda r: f"{r['valLag']:.1f}" if r['valLag'] is not None else '-')
    row('slots ending empty / at 0 (%)', lambda r: f"{100*r['empty']:.1f}")
    row('slots < 10 pts (%) / negative (%)', lambda r: f"{100*r['weak']:.1f} / {100*r['neg']:.1f}")
    row('locks of a non-final game per week', lambda r: f"{r['lock']['perWeek']:.1f}" if r['lock']['n'] else '-')
    row('… own later game beat the lock (% of locks; shortfall pts/wk)', lambda r: f"{100*r['lock']['laterBetter']:.0f}% ; {r['lock']['shortfallPerWeek']:.1f}" if r['lock']['n'] else '-')
    row('… median hours from game end to lock; % locked at the deadline', lambda r: f"{r['lock']['hoursAfterEnd']:.1f} h; {100*r['lock']['atDeadline']:.0f}%" if r['lock']['hoursAfterEnd'] is not None else '-')
    L += ['', 'Per slot type: median secure time (% of game-time elapsed) / share secured by a lock (vs final game held) / mean counted pts', '',
          '| slot | ' + ' | '.join(order) + ' |', '|---|' + '---|' * len(order)]
    for t in ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL']:
        L.append(f'| {t} | ' + ' | '.join((lambda bt, bx: f"{100*bt[0]:.0f}% / {100*bt[1]:.0f}% / {bx:.1f}" if bt else '-')(res[a]['byType'].get(t), res[a]['byTypeX'].get(t, 0)) for a in order) + ' |')
    L += ['', 'Open (not yet secured) slots and their final points at the first tip-off of each game day', '',
          '| game day | ' + ' | '.join(order) + ' |', '|---|' + '---|' * len(order)]
    for i in range(1, 8):
        if not any(i in res[a]['openByDay'] for a in order): continue
        L.append(f'| {i} | ' + ' | '.join((lambda v: f"{v[0]:.1f} slots, {v[1]:.0f} pts" if v else '-')(res[a]['openByDay'].get(i)) for a in order) + ' |')
    return '\n'.join(L) + '\n'

# ---------------- Part 2: decomposition ----------------
CATS = ['sit_should_start_forced', 'sit_should_start_free', 'start_should_sit', 'start_should_sit_dnp', 'kept_should_go', 'went_should_keep',
        'went_should_keep_free', 'held_then_let_go', 'lock_early', 'place_game', 'place_keep']
CATDESC = {
    'sit_should_start_forced': 'sat a player the priced DP would start; no eligible slot was free (capacity)',
    'sit_should_start_free': 'sat a player the priced DP would start while an eligible slot was free',
    'start_should_sit': 'started a player the priced DP would sit (he played)',
    'start_should_sit_dnp': 'started a player the priced DP would sit (DNP)',
    'kept_should_go': 'kept (locked / counted) a score below the DP threshold',
    'went_should_keep': 'let go a score above the DP threshold (no eligible slot free afterwards)',
    'went_should_keep_free': 'let go a score above the DP threshold while an eligible slot was free',
    'held_then_let_go': 'slot-time charged while holding a score later given up',
    'lock_early': 'lock before the player\'s next tip-off (price of the lock slot above the cheapest)',
    'place_game': 'game played in a pricier slot than the cheapest eligible one',
    'place_keep': 'held / locked score in a pricier slot than needed',
    'empty': 'priced slot-time left empty',
}
def decomp(rows_by_pol):
    """rows_by_pol: {pol: [(key, dec, gapBoundMinusW)]} -> per category mean ± CI per team-week"""
    res = {}
    for pn, lst in rows_by_pol.items():
        r = {}
        for c in CATS: r[c] = ci([x[1]['cat'].get(c, 0) + x[1]['cat'].get(c + '_final', 0) for x in lst])
        for c in ('kept_should_go', 'went_should_keep', 'went_should_keep_free'): r[c + '_final'] = ci([x[1]['cat'].get(c + '_final', 0) for x in lst])
        r['empty'] = ci([x[1]['empty'] for x in lst])
        r['sum'] = ci([sum(x[1]['cat'].values()) + x[1]['empty'] for x in lst])
        r['gap'] = ci([x[2] for x in lst]); r['noise'] = ci([x[1]['noise'] for x in lst]); r['n'] = len(lst)
        withInfo = [x for x in lst if 'info' in x[1]]
        for kk in ('forced_blocked_by_held', 'forced_blocked_by_locks', 'forced_blocked_by_games_starters'):
            r[kk] = ci([x[1]['info'].get(kk, 0) for x in withInfo]) if len(withInfo) > 1 else (float('nan'), float('nan'), 0)
        res[pn] = r
    return res
def decomp_md(res, title):
    pols = list(res)
    L = [f'### {title}', '', '| category (pts/wk, 95% CI over team-weeks) | ' + ' | '.join(f'{p} (n={res[p]["n"]})' for p in pols) + ' |', '|---|' + '---|' * len(pols)]
    for c in CATS + ['empty']:
        L.append(f'| {c}: {CATDESC[c]} | ' + ' | '.join(fmt(res[p][c]) for p in pols) + ' |')
        if c == 'sit_should_start_forced':
            for kk in ('forced_blocked_by_held', 'forced_blocked_by_locks', 'forced_blocked_by_games_starters'):
                L.append(f'| … {kk.replace("forced_blocked_by_", "slot blocked by ")} (runs with this split) | ' + ' | '.join(fmt(res[p][kk]) if res[p][kk][2] else '-' for p in pols) + ' |')
        if c + '_final' in res[pols[0]]: L.append(f'| … of which the player\'s final game | ' + ' | '.join(fmt(res[p][c + '_final']) for p in pols) + ' |')
    L.append('| **sum of decision terms** | ' + ' | '.join(f"**{fmt(res[p]['sum'])}**" for p in pols) + ' |')
    L.append('| bound − W | ' + ' | '.join(fmt(res[p]['gap']) for p in pols) + ' |')
    L.append('| noise (= bound − W − sum; zero-mean under the model) | ' + ' | '.join(fmt(res[p]['noise']) for p in pols) + ' |')
    return '\n'.join(L) + '\n'

def real_decomp(prefix_pols, keys=None):
    out = {}
    for prefix, pn in prefix_pols:
        rows = load(prefix); lst = []
        for k, d in rows.items():
            if keys is not None and k not in keys: continue
            if pn in d['pols']: lst.append((k, d['pols'][pn]['dec'], d['bound'] - d['pols'][pn]['total']))
        if lst: out[f'{pn} [{prefix}]'] = lst
    return decomp(out)
def model_decomp(prefix, pn):
    rows = load(prefix); lst = []
    for k, d in rows.items():
        sc = d['pols'].get(pn) or []
        if not sc: continue
        # average over the scenarios of a team-week first (cluster = team-week)
        cat = defaultdict(float)
        for x in sc:
            for c, v in x['dec']['cat'].items(): cat[c] += v / len(sc)
        dec = {'cat': dict(cat), 'empty': St.mean(x['dec']['empty'] for x in sc), 'noise': St.mean(x['dec']['noise'] for x in sc)}
        if all('info' in x['dec'] for x in sc):
            inf = defaultdict(float)
            for x in sc:
                for c, v in x['dec']['info'].items(): inf[c] += v / len(sc)
            dec['info'] = dict(inf)
        lst.append((k, dec, d['bound'] - St.mean(x['total'] for x in sc)))
    return decomp({f'{pn} model [{prefix}]': lst}) if lst else {}

# ---------------- Part 2: what the race sees ----------------
def race_stats(prefix):
    rows = load(prefix); n_tw = 0; dec = 0; best = []; kinds = defaultdict(lambda: [0, 0.0]); fresh = []; freshKind = defaultdict(list); sw = 0; near = 0
    for k, d in rows.items():
        r = d['pols'].get('P10b');
        if not r: continue
        n_tw += 1
        for e in r['race']:
            dec += 1; sw += 1 if e['pick'] else 0
            ch = [c for i, c in enumerate(e['c']) if i > 0]
            if not ch: continue
            b = max(ch, key=lambda c: c[3]); best.append(b[3])
            if 0 < b[3] <= 0.5 or (b[3] > 0.5 and not e['pick']): near += 1
            kinds[b[0].split(' ')[0]][0] += 1; kinds[b[0].split(' ')[0]][1] += b[3]
            if 'fresh' in e:
                fj, m, se, nn = e['fresh']; fresh.append((m, se, e['c'][fj][0].split(' ')[0], e['c'][fj][3], k)); freshKind[e['c'][fj][0].split(' ')[0]].append(m)
    perweek = defaultdict(float)
    for m, se, kd, rm, k in fresh: perweek[k] += m
    pw = [perweek.get(k, 0.0) for k, d in rows.items() if d['pols'].get('P10b')]
    pwPos = defaultdict(float)
    for m, se, kd, rm, k in fresh:
        if m > 2 * se: pwPos[k] += m
    bins = {}
    for lo, hi in ((0.25, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 99)):
        sel = [x for x in fresh if lo <= x[3] < hi]
        if sel: bins[f'{lo}-{hi}'] = dict(n=len(sel), perWeek=len(sel) / max(1, n_tw), raceMean=St.mean(x[3] for x in sel), freshMean=St.mean(x[0] for x in sel),
                                          freshSE=math.sqrt(sum(x[1] ** 2 for x in sel)) / len(sel), gainPerWeek=sum(x[0] for x in sel) / max(1, n_tw))
    return dict(n_tw=n_tw, decisions=dec / max(1, n_tw), freshBins=bins, switched=sw / max(1, n_tw), bestGain=dict(p50=q(best, .5), p90=q(best, .9), share_pos=sum(1 for b in best if b > 0) / max(1, len(best))),
                nearMiss=near / max(1, n_tw), kinds={kk: (v[0] / max(1, n_tw), v[1] / max(1, v[0])) for kk, v in kinds.items()},
                fresh=dict(n=len(fresh), perWeek=len(fresh) / max(1, n_tw), raceMean=St.mean(x[3] for x in fresh) if fresh else None, freshMean=St.mean(x[0] for x in fresh) if fresh else None,
                           sig=sum(1 for x in fresh if x[0] > 2 * x[1]), sigNeg=sum(1 for x in fresh if x[0] < -2 * x[1]),
                           sumPerWeek=ci(pw), sumPosSigPerWeek=St.mean([pwPos.get(k, 0.0) for k in perweek] + [0.0] * (n_tw - len(perweek))) if n_tw else None,
                           byKind={kk: (len(v), St.mean(v)) for kk, v in freshKind.items()}))

# ---------------- charts ----------------
COL = {'human': '#2a78d6', 'P7H_LheldTie': '#eb6834', 'P8': '#1baf7a', 'P10b': '#6250d6', 'hindsight': '#7a7974'}
LAB = {'human': 'real managers', 'P7H_LheldTie': 'P7H (old live)', 'P8': 'P8 (index rule)', 'P10b': 'P10b (live engine)', 'hindsight': 'perfect hindsight'}
def charts(res, tag):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    plt.rcParams.update({'font.size': 10, 'axes.edgecolor': '#b5b4ae', 'axes.labelcolor': '#52514e', 'xtick.color': '#52514e', 'ytick.color': '#52514e'})
    order = [a for a in ('human', 'P7H_LheldTie', 'P8', 'P10b', 'hindsight') if a in res]
    xs = [5 * j for j in range(21)]
    specs = (('fillVal', 'h_scored_curve', 'When were the counted scores scored? (end of the counted game)', order),
             ('fill', 'h_fill_curve', 'When are the slots committed? (lock, or end of a final game kept)', [a for a in order if a != 'human']))
    for key, fname, title, ags in specs:
        fig, ax = plt.subplots(figsize=(7.5, 4.4), dpi=150)
        for a in ags:
            k = key if a not in ('human', 'hindsight') else 'fillVal'
            lab = LAB[a] + (' (scored time)' if a == 'hindsight' and key == 'fill' else '')
            ax.plot(xs, [100 * res[a][k][j] for j in range(21)], color=COL[a], lw=2, ls='--' if a == 'hindsight' else '-', label=lab)
        ax.set_xlabel("% of the team's game-time elapsed (first tip-off to last game end)"); ax.set_ylabel('% of final points')
        ax.set_title(f'{title}, {tag}', loc='left', fontsize=10, color='#0b0b0b'); ax.grid(color='#e7e6e2', lw=0.6); ax.set_ylim(0, 102); ax.set_xlim(0, 100)
        for sp in ('top', 'right'): ax.spines[sp].set_visible(False)
        ax.legend(frameon=False, fontsize=8, loc='upper left'); fig.tight_layout(); fig.savefig(f'{OUT}/{fname}_{tag}.png'); plt.close(fig)

if __name__ == '__main__':
    summ = {}; md1 = ['# Part 1 tables (generated by research/h_analyze.py)', '']
    for season, tag in ((25, '2025-26'), (24, '2024-25')):
        A = agents_of(season)
        if not A: continue
        r = part1(season); md1.append(part1_md(r, f'{tag}: all traced team-weeks per agent'))
        if 'P10b' in A:
            keys = set(A['P10b']); r2 = part1(season, keys); md1.append(part1_md(r2, f'{tag}: the P10b subset (same team-weeks for every agent)')); charts(r2, tag)
        summ[tag] = {a: {k: v for k, v in x.items() if k not in ('all9_el', 'all9_dow', 'all9_gday', 'all9_tipped')} for a, x in r.items()}
    open(f'{OUT}/part1.md', 'w').write('\n'.join(md1))
    md2 = ['# Part 2 tables (generated by research/h_analyze.py)', '']
    for title, pp in (('2025-26 real outcomes', [('r25', 'P7H_LheldTie'), ('r25', 'P8'), ('r25b', 'P10b')]), ('2024-25 real outcomes (league A)', [('r24', 'P7H_LheldTie'), ('r24', 'P8'), ('r24b', 'P10b')])):
        d = real_decomp(pp)
        if d: md2.append(decomp_md(d, title)); summ['dec ' + title] = {k: {c: v for c, v in x.items()} for k, x in d.items()}
    for title, pre, pp in (('2025-26 real outcomes, the P10b team-weeks only', 'r25b', [('r25', 'P7H_LheldTie'), ('r25', 'P8'), ('r25b', 'P10b')]),
                           ('2024-25 real outcomes (league A), the P10b team-weeks only', 'r24b', [('r24', 'P7H_LheldTie'), ('r24', 'P8'), ('r24b', 'P10b')])):
        keys = set(load(pre))
        if keys:
            d = real_decomp(pp, keys); md2.append(decomp_md(d, title)); summ['dec ' + title] = d
    m = {}
    m.update(model_decomp('m10', 'P10b'))
    m.update(model_decomp('m8', 'P8')); m.update(model_decomp('m7', 'P7H_LheldTie'))
    if m: md2.append(decomp_md(m, 'model scenarios (gap-study team-weeks; averaged per team-week first)')); summ['dec model'] = m
    # Lagrangian prices: shadow value of each slot for the whole week (sum_b mu_sb = d bound / d capacity of slot s), and
    # by game day of the week (Mon = 0) - where capacity binds
    for pre, tag in (('r25', '2025-26'), ('r24', '2024-25 league A')):
        rows = load(pre)
        if not rows: continue
        bySlot = defaultdict(list); byDow = defaultdict(float); byDayIdx = defaultdict(list)
        for k, d in rows.items():
            for s, v in enumerate(d['priceBySlot']): bySlot[SLOTN[s] + ('2' if s == 8 else '')].append(v)
            days = sorted(d['priceByDay'])
            for i, day in enumerate(days):
                v = sum(d['priceByDay'][day]); byDow[datetime.strptime(day, '%Y-%m-%d').strftime('%a')] += v / len(rows); byDayIdx[i].append(v)
        md2.append(f'### Lagrangian slot prices, {tag} ({len(rows)} team-weeks)\n')
        md2.append('Shadow value of one more slot of each type for the whole week (sum of its prices, pts): ' + ', '.join(f'{s} {St.mean(v):.1f}' for s, v in bySlot.items()) + '.\n')
        md2.append('Price mass by ET calendar day (pts, all slots): ' + ', '.join(f'{d} {byDow[d]:.1f}' for d in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') if d in byDow) + '.\n')
        md2.append('Price mass by day index within the bucket span (0 = first calendar day with a bucket): ' + ', '.join(f'{i}: {St.mean(v):.1f}' for i, v in sorted(byDayIdx.items())) + '.\n')
        summ['prices ' + tag] = {'bySlot': {s: St.mean(v) for s, v in bySlot.items()}, 'byDow': dict(byDow)}
    for pre in ('r25b', 'r24b'):
        rs = race_stats(pre)
        if rs['n_tw']: md2.append(f'### race statistics {pre}\n\n```\n{json.dumps(rs, indent=1)}\n```\n'); summ['race ' + pre] = rs
    open(f'{OUT}/part2.md', 'w').write('\n'.join(md2))
    json.dump(summ, open(f'{OUT}/summary.json', 'w'), indent=1, default=str)
    print('ok')
