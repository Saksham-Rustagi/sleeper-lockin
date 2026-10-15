# Summarise a V8 .cpuprofile (node --cpu-prof): top functions by self time and by inclusive time.
# usage: python3 research/profsum.py <file.cpuprofile> [top=25]
import json, sys
from collections import defaultdict

prof = json.load(open(sys.argv[1]))
top = int(sys.argv[2]) if len(sys.argv) > 2 else 25
nodes = {n["id"]: n for n in prof["nodes"]}
parent = {}
for n in prof["nodes"]:
    for c in n.get("children", []):
        parent[c] = n["id"]
# sample counts per node (time deltas weighted)
self_t = defaultdict(float)
deltas = prof.get("timeDeltas", [])
for i, s in enumerate(prof["samples"]):
    self_t[s] += deltas[i] if i < len(deltas) else 0
total = sum(self_t.values())

def name(n):
    cf = n["callFrame"]
    f = cf["functionName"] or "(anon)"
    u = cf["url"].split("/")[-1]
    return f"{f} {u}:{cf['lineNumber'] + 1}"

by_self = defaultdict(float); by_incl = defaultdict(float)
for nid, t in self_t.items():
    by_self[name(nodes[nid])] += t
    seen = set(); x = nid
    while x is not None:
        nm = name(nodes[x])
        if nm not in seen:
            by_incl[nm] += t; seen.add(nm)
        x = parent.get(x)
print(f"total {total / 1e6:.2f} s")
# optional: hot lines (V8 positionTicks) of the functions named in argv[3] (comma-separated)
if len(sys.argv) > 3:
    want = set(sys.argv[3].split(","))
    for fn in want:
        lines = defaultdict(int); tot = 0
        for n in prof["nodes"]:
            if n["callFrame"]["functionName"] != fn: continue
            for pt in n.get("positionTicks", []):
                lines[pt["line"]] += pt["ticks"]; tot += pt["ticks"]
        print(f"--- lines of {fn} ({tot} ticks) ---")
        for ln, t in sorted(lines.items(), key=lambda kv: -kv[1])[:12]:
            print(f"{100 * t / max(1, tot):6.2f}%  line {ln}")
    sys.exit(0)
print("--- self ---")
for k, v in sorted(by_self.items(), key=lambda kv: -kv[1])[:top]:
    print(f"{100 * v / total:6.2f}%  {k}")
print("--- inclusive ---")
for k, v in sorted(by_incl.items(), key=lambda kv: -kv[1])[:top]:
    print(f"{100 * v / total:6.2f}%  {k}")
