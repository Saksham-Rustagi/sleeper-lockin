import json,glob,statistics as st,math,sys
pref=sys.argv[1]; pols=sys.argv[2].split(','); base=sys.argv[3]
R=[];[R.extend(json.load(open(f))) for f in sorted(glob.glob(f'{pref}_*.json'))]
S={(r['week'],r['rid']):r for r in R}
def win(p):
    w=n=0
    for k,r in S.items():
        o=(k[0],r['opp']) if r['opp'] else None
        if o in S: w+=1 if r[p]>S[o]['human'] else .5 if r[p]==S[o]['human'] else 0; n+=1
    return w/n
print(f"{len(R)} team-weeks; humans {st.mean(r['human'] for r in R):.1f}, hindsight {st.mean(r['hindsight'] for r in R):.1f}")
for p in pols:
    d=[r[p]-r[base] for r in R]
    print(f"{p:6s} {st.mean(r[p] for r in R):6.1f} pts/wk  vs {base} {st.mean(d):+.2f} ± {1.96*st.pstdev(d)/math.sqrt(len(d)):.2f}  win vs real opp {win(p):.3f}  locks/wk {st.mean(r[p+'_locks'] for r in R):.2f}  ms/wk {st.mean(r[p+'_ms'] for r in R):.0f}")
