"""Collect the 2024-25 NBA regular season (weeks 1-23) for the second-season validation set.
Raw downloads are cached under research/data/raw2024/ (not committed): sched_2024.json, stats_w{N}.json, proj_w{N}.json,
season_stats_{2022,2023}.json (prior seasons, for the preseason draft value), espn_{YYYYMMDD}.json, league.json
(scoring settings + slots copied from our 2025-26 league via research/data/season.json).
Polite: sequential requests, 0.6 s apart, 4 retries with back-off; cached files are never re-fetched.
usage: python3 -I research/fetch_season2024.py"""
import json, os, subprocess, sys, time

D = "research/data/raw2024"; os.makedirs(D, exist_ok=True)
WEEKS = range(1, 24)


def fetch(name, url):
    p = f"{D}/{name}"
    if os.path.exists(p) and os.path.getsize(p) > 2:
        return False
    for i in range(4):
        r = subprocess.run(["curl", "-sf", "-m", "120", "-A", "Mozilla/5.0", "-o", p + ".tmp", url])
        if r.returncode == 0:
            try:
                json.load(open(p + ".tmp"))
                os.replace(p + ".tmp", p); time.sleep(0.6); return True
            except ValueError:
                pass
        time.sleep(3 * (i + 1))
    raise SystemExit(f"failed: {url}")


S = "https://api.sleeper.app"
fetch("sched_2024.json", f"{S}/schedule/nba/regular/2024")
for y in (2022, 2023):
    fetch(f"season_stats_{y}.json", f"{S}/stats/nba/{y}?season_type=regular")
for w in WEEKS:
    fetch(f"stats_w{w}.json", f"{S}/stats/nba/2024/{w}?season_type=regular")
    fetch(f"proj_w{w}.json", f"{S}/projections/nba/2024/{w}?season_type=regular")
    print("week", w, "ok", flush=True)
for w in (24, 25):  # rest of the regular season: only to know whether an injured player ever returned (replacement rule)
    fetch(f"stats_w{w}.json", f"{S}/stats/nba/2024/{w}?season_type=regular")
sched = json.load(open(f"{D}/sched_2024.json"))
dates = sorted({g["date"] for g in sched if g["week"] in WEEKS})
n = 0
for d in dates:
    n += fetch(f"espn_{d.replace('-', '')}.json",
               f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d.replace('-', '')}")
print("espn dates", len(dates), "fetched now", n)
# scoring + slots: same as our league (research/data/season.json)
cur = json.load(open("research/data/season.json"))
json.dump({"scoring_settings": cur["scoring"], "slots": cur["slots"]}, open(f"{D}/league.json", "w"))
print("done", len(os.listdir(D)), "files")
