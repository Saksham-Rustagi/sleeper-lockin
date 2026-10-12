import json,statistics as st,math,sys
R=[]
for f in sys.argv[1:]: R+=json.load(open(f))
pols=[k for k in R[0] if not k.endswith(('_ms','_locks','_moves')) and k not in ('week','rid','opp','model')]
print('team-weeks',len(R))
for p in pols:
    v=[r[p] for r in R]; print(f"{p:11s} mean {st.mean(v):6.1f}  median {st.median(v):6.1f}")
def paired(a,b):
    d=[r[a]-r[b] for r in R]; m=st.mean(d); se=st.pstdev(d)/math.sqrt(len(d)); return f"{a}-{b}: {m:+.1f} ± {1.96*se:.1f}"
base=[p for p in pols if p not in('human','hindsight')]
for a in base:
    for b in base:
        if a<b: print(paired(a,b))
