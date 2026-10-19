"""Task O: minutes-surge flags -> outcomes over the next 5 team games (DNP = 0).
usage: python3 -I research/o_surge_summ.py surges.json [more.json ...]"""
import json, sys, statistics as st

for f in sys.argv[1:]:
    d = json.load(open(f)); rows = d["rows"]
    real, est, spn, spf, hit, beat, mins, pmin = [], [], [], [], [], [], [], []
    for r in rows:
        s = [x for x in r["seq"] if x][:5]
        if len(s) < 3: continue
        rf = st.mean(x[5] for x in s); pf = st.mean((x[1] if x[1] is not None else 0) for x in s)
        real.append(rf); est.append(r["est"]); spn.append(pf); spf.append(r["projFp"]); hit.append(rf >= 20); beat.append(rf >= pf + 5)
        mins.append(st.mean(x[4] for x in s)); pmin.append(r["expMin"])
    if not real: print(f, "no flags"); continue
    P = d["P"]
    print(f"{f}: P={json.dumps({k: P[k] for k in ('surgeMin', 'surgeFp', 'surgeEdge')})} flags {len(rows)} (scored {len(real)}): realized {st.mean(real):.1f} fp/g "
          f"(est {st.mean(est):.1f}, Sleeper at flag {st.mean(spf):.1f}, Sleeper next 5 {st.mean(spn):.1f}); hit >= 20: {st.mean(hit):.0%}; "
          f"beat Sleeper +5: {st.mean(beat):.0%}; minutes {st.mean(mins):.1f} (expected {st.mean(pmin):.1f})")
