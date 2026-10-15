"""Decision statistics per policy (research/decstats.ts outputs): where the points come from, per team-week means.
usage (from research/out): python3 ../summ_dec.py [prefix=dec]"""
import glob, json, math, statistics as st, sys

pre = sys.argv[1] if len(sys.argv) > 1 else "dec"
R = [json.load(open(f)) for f in glob.glob(f"{pre}_*_*.json")]
pols = list(R[0]["pols"]); keys = list(R[0]["pols"][pols[0]])
labels = {"starts": "games started", "startMu": "mean projection of a started game", "dnpStarts": "starts that were DNPs", "locks": "locks",
          "lockPts": "points from locks", "lockFinal": "locks of a final-game score", "lockEarly": "locks before his own deadline",
          "letGo": "held scores let go", "letGoPts": "points let go", "deadlineLetGo": "let go at his own tip-off", "tipSlotsFree": "open unpinned slots after each tip-off (sum)",
          "tipsSat": "tipping players sat", "satPts": "points scored by sat players", "total": "week total", "heldEnd": "held scores counted at week end",
          "heldEndPts": "points from week-end holds", "emptyEnd": "slots empty at week end"}
print(f"{len(R)} team-weeks (real outcomes), mean per week\n| decision | " + " | ".join(pols) + " |\n|---|" + "---|" * len(pols))
for k in keys:
    if k == "startMu": vals = [sum(r["pols"][p]["startMu"] for r in R) / max(1, sum(r["pols"][p]["starts"] for r in R)) for p in pols]
    else: vals = [st.mean(r["pols"][p][k] for r in R) for p in pols]
    print(f"| {labels.get(k, k)} | " + " | ".join(f"{v:.2f}" for v in vals) + " |")
