"""Task O data: Sleeper per-game stats (with seconds played `sp`) and per-game projections (projected `sp`) for the
2025-26 regular season and the 2025 / 2026 preseasons -> research/data/o/ (not committed). 2024-25 is already in
research/data/raw2024 (stats_w*.json, proj_w*.json).
usage: python3 -I research/o_fetch.py"""
import json, os, subprocess, time

OUT = "research/data/o"
os.makedirs(OUT, exist_ok=True)


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 2:
        return
    for i in range(4):
        try:
            # curl: this Mac's python has no CA bundle
            raw = subprocess.run(["curl", "-sf", "-m", "60", "-A", "sleeper-lockin/2.0", url], capture_output=True, check=True).stdout
            data = json.loads(raw)
            # keep only what the analysis needs (rows are ~1 kB each with the embedded player object)
            slim = [{k: x.get(k) for k in ("player_id", "date", "team", "opponent", "game_id", "week", "stats")} for x in data]
            json.dump(slim, open(path, "w"))
            print(url, len(slim), flush=True)
            return
        except Exception as e:  # noqa: BLE001
            print("retry", url, e, flush=True); time.sleep(2 * (i + 1))
    raise SystemExit(f"failed {url}")


for w in range(1, 26):
    get(f"https://api.sleeper.app/stats/nba/2025/{w}?season_type=regular", f"{OUT}/stats2025_w{w}.json")
    get(f"https://api.sleeper.app/projections/nba/2025/{w}?season_type=regular", f"{OUT}/proj2025_w{w}.json")
for season in ("2025", "2026"):
    for w in range(1, 5):
        get(f"https://api.sleeper.app/stats/nba/{season}/{w}?season_type=pre", f"{OUT}/pre{season}_w{w}.json")
        get(f"https://api.sleeper.app/projections/nba/{season}/{w}?season_type=pre", f"{OUT}/preproj{season}_w{w}.json")
print("done")
