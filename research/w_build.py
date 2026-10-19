"""Task W (waiver backtest) datasets: every NBA player's games (rostered AND free agents) for weeks 1-23, in the
season.json game format, plus who is rostered in which league each week, ages and dynasty ADP.
usage: python3 -I research/w_build.py      (inputs: research/data/season*.json, season_all.json, raw2024/, w/*.json)
Outputs research/data/w/all2025.json, all2024.json (not committed).

Why not season_all.json directly: it only has games with a Sleeper stats or projection row, so a free agent's DNP games
without a row are missing - the game list itself would leak sit-outs. Here every player gets one game per scheduled
game of his team (team per date = his own row that day, else his nearest earlier row, else his first row), exactly
like build_dataset.py / build_season2024.py do for rostered players; no row (or gp = 0) = played false.
2025-26: team schedules and tip-offs are recovered from the union of all players' rows in season_all.json (every NBA
game has rows); games of players in season.json are taken from season.json unchanged (checked: the reconstruction
matches them). 2024-25: the same construction from research/data/raw2024 (build_season2024.py's code path).
Ages: Sleeper birth_date (exact age at any date). Dynasty ADP: Sleeper season projections' adp_dynasty for that
season as fetched now (no history: current values)."""
import json, glob, os, bisect, collections, datetime as dt

W = "research/data/w"
P = json.load(open(f"{W}/players_nba.json"))
birth = {pid: p.get("birth_date") for pid, p in P.items() if p.get("birth_date")}


def adp_of(y):
    S = json.load(open(f"{W}/sproj_{y}.json"))
    return {pid: v["adp_dynasty"] for pid, v in S.items() if v.get("adp_dynasty")}


def team_lookup(rows_by_pid):
    exact = {pid: dict(r) for pid, r in rows_by_pid.items()}
    dates = {pid: [d for d, _ in r] for pid, r in rows_by_pid.items()}

    def team_on(pid, date):
        r = rows_by_pid.get(pid)
        if not r: return None
        if date in exact[pid]: return exact[pid][date]
        i = bisect.bisect_left(dates[pid], date)
        return r[i - 1][1] if i else r[0][1]
    return team_on


# ------------------------------------------------------------------ 2025-26
def build2025():
    A = json.load(open("research/data/season_all.json")); S = json.load(open("research/data/season.json"))
    rows = {}  # (pid, date) -> row
    sched = {}  # (date, team) -> (gid, tip, opp, week)
    rows_by_pid = collections.defaultdict(list)
    for w, gs in A["games"].items():
        for g in gs:
            if not g["pid"].isdigit(): continue
            rows[(g["pid"], g["date"])] = g
            rows_by_pid[g["pid"]].append((g["date"], g["team"]))
            k = (g["date"], g["team"])
            if k not in sched: sched[k] = (g["gid"], g["tip"], g["opp"], int(w))
    for pid in rows_by_pid: rows_by_pid[pid] = sorted(set(rows_by_pid[pid]))
    team_on = team_lookup(rows_by_pid)
    by_team = collections.defaultdict(list)
    for (date, team), v in sched.items(): by_team[team].append((date, v))
    for t in by_team: by_team[t].sort()
    in_s = {g["pid"] for gs in S["games"].values() for g in gs}
    games = {str(w): [] for w in range(1, 24)}
    mism = [0, 0]
    allp = set(rows_by_pid) | in_s
    recon = {}
    for pid in rows_by_pid:
        out = []
        for team, sg in by_team.items():
            for date, (gid, tip, opp, w) in sg:
                if team_on(pid, date) != team: continue
                r = rows.get((pid, date))
                out.append({"pid": pid, "gid": gid, "date": date, "tip": tip, "team": team, "opp": opp, "w": w,
                            "actual": r["actual"] if r and r["played"] else 0.0, "played": bool(r and r["played"]),
                            "proj_sleeper": r["proj_sleeper"] if r else None})
        recon[pid] = out
    # season.json players: in the weeks season.json has them (= the weeks they were rostered) take those games
    # unchanged, the reconstruction in the other weeks; compare the two where both exist
    sj = collections.defaultdict(list)
    for w, gs in S["games"].items():
        for g in gs: sj[g["pid"]].append({**g, "w": int(w)})
    for pid, gs in sj.items():
        a = {(g["date"]): (round(g["actual"], 1), g["played"], g["proj_sleeper"]) for g in gs}
        b = {(g["date"]): (round(g["actual"], 1), g["played"], g["proj_sleeper"]) for g in recon.get(pid, [])}
        mism[0] += len(a); mism[1] += sum(1 for k in a if b.get(k) != a[k])
        weeks = {g["w"] for g in gs}
        recon[pid] = sorted(gs + [g for g in recon.get(pid, []) if g["w"] not in weeks], key=lambda g: g["tip"])
    for pid, gs in recon.items():
        for g in gs:
            w = g.pop("w"); g.pop("proj_mod", None); games[str(w)].append(g)
    pos = {pid: (A["pos"].get(pid) or (P.get(pid) or {}).get("fantasy_positions") or ["UTIL"]) for pid in recon}
    for pid, v in S["players"].items(): pos[pid] = v["pos"]
    names = {pid: (S["players"].get(pid) or {}).get("name") or (P.get(pid) or {}).get("full_name") or pid for pid in recon}
    rostered = {str(W_["week"]): {"0": sorted({p for t in W_["teams"].values() for p in t["players"]})} for W_ in S["weeks"]}
    league_of = {rid: "0" for rid in S["weeks"][0]["teams"]}
    out = {"season": "2025-26", "games": games, "pos": pos, "names": names, "rostered": rostered, "leagueOf": league_of,
           "birth": {p: birth[p] for p in recon if p in birth}, "adp": {p: a for p, a in adp_of(2025).items() if p in recon},
           "weekStart": {str(W_["week"]): W_["dates"][0] for W_ in S["weeks"]}}
    json.dump(out, open(f"{W}/all2025.json", "w"))
    print(f"2025-26: players {len(recon)}, games {sum(len(v) for v in games.values())}, season.json games {mism[0]}, "
          f"reconstruction differs on {mism[1]}; with birth date {len(out['birth'])}, with dynasty ADP {len(out['adp'])}")


# ------------------------------------------------------------------ 2024-25
def build2024():
    D = "research/data/raw2024"; S = json.load(open("research/data/season2024.json"))
    L = json.load(open(f"{D}/league.json")); SC = L["scoring_settings"]
    sched = [g for g in json.load(open(f"{D}/sched_2024.json")) if 1 <= g["week"] <= 23]
    fp = lambda s: sum(SC.get(k, 0) * v for k, v in s.items() if isinstance(v, (int, float)) and k in SC)
    played_of = lambda s: bool(s.get("gp")) or (s.get("sp") or 0) > 0
    FIX = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX"}
    tips = {}
    for f in glob.glob(f"{D}/espn_*.json"):
        d = os.path.basename(f)[5:13]; d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        for e in json.load(open(f)).get("events", []):
            t = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00")).timestamp() * 1000
            for c in e["competitions"][0]["competitors"]:
                ab = c["team"]["abbreviation"]; tips[(d, FIX.get(ab, ab))] = t
    STATS, PROJ, info = {}, {}, {}
    rows_by_pid = collections.defaultdict(list)
    for w in range(1, 24):
        for kind, store in (("stats", STATS), ("proj", PROJ)):
            for r in json.load(open(f"{D}/{kind}_w{w}.json")):
                pid = r["player_id"]; store[(pid, r["date"])] = r
                if r.get("player"): info.setdefault(pid, r["player"])
                if r.get("team"): rows_by_pid[pid].append((r["date"], r["team"]))
    for pid in rows_by_pid: rows_by_pid[pid].sort()
    team_on = team_lookup(rows_by_pid)
    games = {str(w): [] for w in range(1, 24)}
    sgames = {(g["pid"], g["date"]): g for gs in S["games"].values() for g in gs}
    cmp = [0, 0]
    pids = [p for p in rows_by_pid if p.isdigit()]
    for pid in pids:
        for g in sched:
            team = team_on(pid, g["date"])
            if team not in (g["home"]["team"], g["away"]["team"]): continue
            opp = g["away"]["team"] if g["home"]["team"] == team else g["home"]["team"]
            srow = STATS.get((pid, g["date"])); prow = PROJ.get((pid, g["date"]))
            s = (srow or {}).get("stats") or {}; pl = played_of(s)
            tip = tips.get((g["date"], team)) or dt.datetime.fromisoformat(g["date"] + "T23:30:00+00:00").timestamp() * 1000
            x = {"pid": pid, "gid": g["game_id"], "date": g["date"], "tip": tip, "team": team, "opp": opp,
                 "actual": round(fp(s), 2) if pl else 0.0, "played": pl,
                 "proj_sleeper": round(fp(prow["stats"]), 2) if prow and prow.get("stats") else None}
            o = sgames.get((pid, g["date"]))
            if o is not None:
                cmp[0] += 1; cmp[1] += (o["actual"], o["played"], o["proj_sleeper"], o["tip"]) != (x["actual"], x["played"], x["proj_sleeper"], x["tip"])
            games[str(g["week"])].append(x)
    pos = {pid: ((info.get(pid) or {}).get("fantasy_positions") or ([info[pid]["position"]] if (info.get(pid) or {}).get("position") else ["UTIL"])) for pid in pids}
    for pid, v in S["players"].items(): pos[pid] = v["pos"]
    names = {pid: " ".join(x for x in ((info.get(pid) or {}).get("first_name"), (info.get(pid) or {}).get("last_name")) if x) or pid for pid in pids}
    league_of = {rid: str((int(rid) - 1) // 10) for rid in S["weeks"][0]["teams"]}
    rostered = {}
    for W_ in S["weeks"]:
        r = collections.defaultdict(set)
        for rid, t in W_["teams"].items(): r[league_of[rid]].update(t["players"])
        rostered[str(W_["week"])] = {k: sorted(v) for k, v in r.items()}
    out = {"season": "2024-25", "games": games, "pos": pos, "names": names, "rostered": rostered, "leagueOf": league_of,
           "birth": {p: birth[p] for p in pids if p in birth}, "adp": {p: a for p, a in adp_of(2024).items() if p in pos},
           "weekStart": {str(W_["week"]): W_["dates"][0] for W_ in S["weeks"]}}
    json.dump(out, open(f"{W}/all2024.json", "w"))
    print(f"2024-25: players {len(pids)}, games {sum(len(v) for v in games.values())}, season2024.json games matched {cmp[0]} "
          f"(of {len(sgames)}), differing {cmp[1]}; with birth date {len(out['birth'])}, with dynasty ADP {len(out['adp'])}")


build2025()
build2024()
