# Task T3: compare replays of one recorded moment (research/t3_replays.sh): determinism (on vs on2) and the mid-game calls.
#   python3 research/t3_replay_cmp.py research/scratch/t3/replay/rec_<ms>
import json, sys, os
D = sys.argv[1]
strip = lambda x: {k: v for k, v in x.items() if k not in ("generatedAt", "checkedAt", "cached")}
a = json.load(open(D + "_on.json")); c = json.load(open(D + "_off.json"))
if os.path.exists(D + "_on2.json"):
    b = json.load(open(D + "_on2.json"))
    print("two runs identical:", json.dumps(strip(a), sort_keys=True) == json.dumps(strip(b), sort_keys=True))
print("first tip-off:", a["plan"][0]["when"] if a["plan"] else "-")
for m in a["plan"][0].get("midgame", []) if a["plan"] else []:
    print(f"  {m['recommended']:9} {m['player']:24} {m['pts']:5.1f} so far ~{m['final']:5.1f} gain {m['gain']:6.2f} ± {m['se']:.2f} (n {m['n']})  {m['text']}")
print("option off: midgame", (c["plan"][0].get("midgame") if c["plan"] else None), "| starts on", [s["player"] for s in a["plan"][0]["starts"]] if a["plan"] else [], "off", [s["player"] for s in c["plan"][0]["starts"]] if c["plan"] else [])
print("outlook on/off:", round(a["outlook"]["myMean"], 1), round(c["outlook"]["myMean"], 1))
