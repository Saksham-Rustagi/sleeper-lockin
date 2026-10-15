# Summarize research/humanfit.ts output: python3 research/summ_human.py research/out/humanfit_all.json
import json, sys
d = json.load(open(sys.argv[1]))
print('params', d.get('par'), 'loss', d.get('loss'))
for k in ['fitSet', 'other', 'all', 'h1', 'h2']:
    r = d.get(k)
    if not r: continue
    print(r['label'], 'n', r['n'], 'corr(sim mean, real) %.3f' % r['corr'], 'PIT quintiles', r['pitHist'], 'PIT mean %.3f' % r['pitMean'])
    for m in r['moments']: print('   %-28s data %8.3f sim %8.3f' % (m['nm'], m['data'], m['sim']))
    print('   quantiles (q, data, sim)', [(q['q'], round(q['data']), round(q['sim'])) for q in r['quantiles']])
