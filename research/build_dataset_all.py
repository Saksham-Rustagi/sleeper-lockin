"""All players' games for the 2025-26 season (rostered AND free agents) for the streaming backtest.
Output: /root/sleeper/research/season_all.json = {games: {week: [{pid, gid, date, tip, team, opp, actual, played, proj_sleeper}]},
                                                  pos: {pid: [positions]}, rostered: {week: [pids on any team that week]}}"""
import json, glob, os, datetime as dt
D = "/root/sleeper/research/data"
L = json.load(open(f"{D}/league.json")); SC = L["scoring_settings"]
P = json.load(open(f"{D}/players.json"))
sched = json.load(open(f"{D}/sched_2025.json"))
def fp(s): return sum(SC.get(k, 0) * v for k, v in s.items() if isinstance(v, (int, float)) and k in SC)
FIX = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX"}
tips = {}
for f in glob.glob(f"{D}/espn_*.json"):
    d = os.path.basename(f)[5:13]; d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
    for e in json.load(open(f)).get("events", []):
        t = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00")).timestamp() * 1000
        for c in e["competitions"][0]["competitors"]:
            tips[(d, FIX.get(c["team"]["abbreviation"], c["team"]["abbreviation"]))] = t
out = {"games": {}, "pos": {}, "rostered": {}}
for w in range(1, 24):
    M = json.load(open(f"{D}/matchups_w{w}.json"))
    out["rostered"][w] = sorted({p for m in M for p in (m["players"] or [])})
    stats = json.load(open(f"{D}/stats_w{w}.json")); proj = json.load(open(f"{D}/proj_w{w}.json"))
    S = {(r["player_id"], r["date"]): r for r in stats}; PR = {(r["player_id"], r["date"]): r for r in proj}
    keys = set(S) | set(PR)
    games = []
    for (pid, date) in keys:
        row = S.get((pid, date)) or PR.get((pid, date))
        team = row.get("team"); opp = row.get("opponent")
        if not team: continue
        s = (S.get((pid, date)) or {}).get("stats") or {}
        played = bool(s.get("gp")) or s.get("sp", 0) > 0
        pr = PR.get((pid, date))
        games.append({"pid": pid, "gid": row.get("game_id"), "date": date, "tip": tips.get((date, team), dt.datetime.fromisoformat(date + "T23:30:00+00:00").timestamp() * 1000),
                      "team": team, "opp": opp, "actual": round(fp(s), 2) if played else 0.0, "played": played,
                      "proj_sleeper": round(fp(pr["stats"]), 2) if pr and pr.get("stats") else None})
        out["pos"][pid] = (P.get(pid) or {}).get("fantasy_positions") or ["UTIL"]
    out["games"][w] = games
json.dump(out, open("/root/sleeper/research/season_all.json", "w"))
print("weeks", len(out["games"]), "player-games", sum(len(g) for g in out["games"].values()), "players", len(out["pos"]))
