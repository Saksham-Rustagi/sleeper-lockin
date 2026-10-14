"""Build research/data/season2024.json: the 2024-25 NBA regular season (weeks 1-23) with 3 synthetic 10-team leagues,
in the same format as research/data/season.json, so btcommon/backtest load it via SEASON=research/data/season2024.json.
Input: research/data/raw2024/ (research/fetch_season2024.py). usage: python3 -I research/build_season2024.py

Games: for every player on any synthetic roster, one game per scheduled game of his team (team per date from his own
stat/projection rows, else his nearest row in time), so DNP games with no Sleeper row are included as played=false
(exactly like build_dataset.py for 2025-26). proj_sleeper = Sleeper's per-game projection when one exists, else null;
btcommon never uses projection presence (it leaks sit-outs), only the value, with its own pre-game fallback.

Leagues (rids 1-10 = league A, 11-20 = B, 21-30 = C), each a 10-team snake draft of 19 rounds:
- preseason value = fantasy points per game under our scoring over the two previous regular seasons (2023-24 games
  weighted 2, 2022-23 games 1), shrunk toward 15 FP/G with 8 pseudo-games; players with no prior NBA stats (rookies)
  have no value and are never drafted. Pool = players with at least one 2024-25 Sleeper row (on an NBA roster).
- each league has its own random draft order and each team its own ranking: value * exp(N(0, 0.10)) (ADP spread).
- positional balance: every roster must be able to cover PG,PG,SG,SG,SF,SF,PF,PF,C,C (bipartite matching on
  eligibility); a team picks the best player by its ranking unless the picks left are needed to complete that cover,
  then the best player that extends it. At most 4 C-only players.
- in season: rosters are fixed, except that a player who is clearly lost for the season is replaced at the start of
  week w (w >= 3) when (a) his team played in weeks w-2 and w-1 and he played none of those games, and (b) he plays
  no further 2024-25 regular-season game (hindsight, standing in for the season-ending news a manager would act on).
  The replacement is that league's best free agent sharing a fantasy position with him: highest mean fantasy points
  over his last <= 10 played games before week w, among players who played >= 3 games in weeks w-2..w-1.
- matchups: round robin (circle method) within each league, cycling every 9 weeks. No human scores (null)."""
import json, glob, os, math, random, bisect, collections, datetime as dt, statistics as st

D = "research/data/raw2024"; OUT = "research/data/season2024.json"
L = json.load(open(f"{D}/league.json")); SC = L["scoring_settings"]; SLOTS = L["slots"]
WEEKS = list(range(1, 24)); NTEAM, NROUND, NLEAGUE = 10, 19, 3
sched = [g for g in json.load(open(f"{D}/sched_2024.json")) if g["week"] in WEEKS]


def fp(s):
    return sum(SC.get(k, 0) * v for k, v in s.items() if isinstance(v, (int, float)) and k in SC)


def played_of(s):
    return bool(s.get("gp")) or (s.get("sp") or 0) > 0


# ---------- ESPN tip-offs ----------
FIX = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX"}
tips = {}
for f in glob.glob(f"{D}/espn_*.json"):
    d = os.path.basename(f)[5:13]; d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
    for e in json.load(open(f)).get("events", []):
        t = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00")).timestamp() * 1000
        for c in e["competitions"][0]["competitors"]:
            ab = c["team"]["abbreviation"]; tips[(d, FIX.get(ab, ab))] = t

# ---------- raw rows ----------
STATS, PROJ, info = {}, {}, {}  # (pid, date) -> row ; pid -> player object
rows_by_pid = collections.defaultdict(list)  # pid -> [(date, team)]
for w in WEEKS:
    for kind, store in (("stats", STATS), ("proj", PROJ)):
        for r in json.load(open(f"{D}/{kind}_w{w}.json")):
            pid = r["player_id"]; store[(pid, r["date"])] = r
            if r.get("player"): info.setdefault(pid, r["player"])
            if r.get("team"): rows_by_pid[pid].append((r["date"], r["team"]))
for pid in rows_by_pid: rows_by_pid[pid].sort()
last_played = {}  # pid -> last date he played in the whole 2024-25 regular season (weeks 1-25)
for w in range(1, 26):
    for r in (json.load(open(f"{D}/stats_w{w}.json")) if w > 23 else [x for (p, d), x in STATS.items() if x["week"] == w]):
        if played_of(r.get("stats") or {}) and r["date"] > last_played.get(r["player_id"], ""): last_played[r["player_id"]] = r["date"]
team_games = collections.defaultdict(list)  # team -> [game]
for g in sched:
    for side in ("home", "away"): team_games[g[side]["team"]].append(g)
games_by_week = collections.defaultdict(list)
for g in sched: games_by_week[g["week"]].append(g)
week_start = {w: min(g["date"] for g in gs) for w, gs in games_by_week.items()}


EXACT = {pid: dict(r) for pid, r in rows_by_pid.items()}
DATES = {pid: [d for d, _ in r] for pid, r in rows_by_pid.items()}


def team_on(pid, date):
    r = rows_by_pid.get(pid)
    if not r: return None
    if date in EXACT[pid]: return EXACT[pid][date]
    i = bisect.bisect_left(DATES[pid], date)
    return r[i - 1][1] if i else r[0][1]


miss_tip = [0]


def player_games(pid):
    """All weeks-1..23 games of the player's team(s), with outcome and projection."""
    out = []
    for g in sched:
        team = team_on(pid, g["date"])
        if team not in (g["home"]["team"], g["away"]["team"]): continue
        opp = g["away"]["team"] if g["home"]["team"] == team else g["home"]["team"]
        srow = STATS.get((pid, g["date"])); prow = PROJ.get((pid, g["date"]))
        s = (srow or {}).get("stats") or {}; pl = played_of(s)
        tip = tips.get((g["date"], team))
        if tip is None:
            miss_tip[0] += 1; tip = dt.datetime.fromisoformat(g["date"] + "T23:30:00+00:00").timestamp() * 1000
        out.append({"pid": pid, "gid": g["game_id"], "date": g["date"], "tip": tip, "team": team, "opp": opp, "week": g["week"],
                    "actual": round(fp(s), 2) if pl else 0.0, "played": pl,
                    "proj_sleeper": round(fp(prow["stats"]), 2) if prow and prow.get("stats") else None,
                    "proj_mod": prow.get("last_modified") if prow else None})
    return out


PG_CACHE = {}


def pgames(pid):
    if pid not in PG_CACHE: PG_CACHE[pid] = player_games(pid)
    return PG_CACHE[pid]


def pos_of(pid):
    p = info.get(pid) or {}
    return p.get("fantasy_positions") or ([p["position"]] if p.get("position") else ["UTIL"])


def name_of(pid):
    p = info.get(pid) or {}
    return " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x) or pid


# ---------- preseason value (prior seasons only) ----------
prior = collections.defaultdict(lambda: [0.0, 0.0])  # pid -> [weighted FP, weighted games]
for y, wt in ((2023, 2.0), (2022, 1.0)):
    for r in json.load(open(f"{D}/season_stats_{y}.json")):
        s = r.get("stats") or {}; gp = s.get("gp") or 0
        if not gp or not r.get("player_id", "").isdigit(): continue
        prior[r["player_id"]][0] += wt * fp(s); prior[r["player_id"]][1] += wt * gp
pool = {}
for pid, (fpw, gw) in prior.items():
    if pid not in rows_by_pid or gw <= 0: continue
    pool[pid] = (fpw + 8 * 15.0) / (gw + 8)
NEEDS = ["PG", "PG", "SG", "SG", "SF", "SF", "PF", "PF", "C", "C"]


def cover(pids):
    """Size of a maximum matching of players to NEEDS (eligibility = fantasy positions)."""
    match = [-1] * len(NEEDS)

    def aug(i, seen):
        for j, need in enumerate(NEEDS):
            if need in pos_of(pids[i]) and j not in seen:
                seen.add(j)
                if match[j] < 0 or aug(match[j], seen):
                    match[j] = i; return True
        return False
    return sum(aug(i, set()) for i in range(len(pids)))


def draft(seed):
    rnd = random.Random(seed)
    order = list(range(NTEAM)); rnd.shuffle(order)
    rank = [{p: v * math.exp(rnd.gauss(0, 0.10)) for p, v in pool.items()} for _ in range(NTEAM)]
    avail = set(pool); teams = [[] for _ in range(NTEAM)]; log = []
    for rd in range(NROUND):
        for t in (order if rd % 2 == 0 else order[::-1]):
            cand = sorted(avail, key=lambda p: -rank[t][p])
            left = NROUND - len(teams[t]); cov = cover(teams[t]); need = len(NEEDS) - cov
            for p in cand:
                if pos_of(p) == ["C"] and sum(pos_of(q) == ["C"] for q in teams[t]) >= 4: continue
                if need >= left and cover(teams[t] + [p]) == cov: continue
                break
            teams[t].append(p); avail.discard(p); log.append((rd + 1, t, p))
    return teams, log


# ---------- leagues ----------
leagues = []
for li in range(NLEAGUE):
    teams, log = draft(2024 * 100 + li)
    leagues.append(teams)
    assert all(cover(t) == len(NEEDS) for t in teams), "positional cover failed"

def played_in(pid, weeks):
    return [g for g in pgames(pid) if g["week"] in weeks]


def form(pid, week):
    xs = [g["actual"] for g in pgames(pid) if g["week"] < week and g["played"]][-10:]
    return sum(xs) / len(xs) if xs else 0.0


rosters = {}  # (week, rid) -> [pid]
moves = []
fa_cands = [p for p in rows_by_pid]
for li, teams in enumerate(leagues):
    cur = [list(t) for t in teams]
    for w in WEEKS:
        if w >= 3:
            onroster = {p for t in cur for p in t}
            for ti, t in enumerate(cur):
                for k, p in enumerate(list(t)):
                    prev = played_in(p, (w - 2, w - 1))
                    if {g["week"] for g in prev} != {w - 2, w - 1} or any(g["played"] for g in prev): continue
                    if last_played.get(p, "") >= week_start[w]: continue  # plays again this regular season (weeks w..25)
                    best, bv = None, -1.0
                    for q in fa_cands:
                        if q in onroster or not set(pos_of(q)) & set(pos_of(p)): continue
                        recent = [g for g in played_in(q, (w - 2, w - 1)) if g["played"]]
                        if len(recent) < 3: continue
                        v = form(q, w)
                        if v > bv: best, bv = q, v
                    if best is None: continue
                    t[k] = best; onroster.discard(p); onroster.add(best)
                    moves.append({"league": li, "rid": li * NTEAM + ti + 1, "week": w, "out": name_of(p), "in": name_of(best), "in_form": round(bv, 1)})
        for ti, t in enumerate(cur):
            rosters[(w, li * NTEAM + ti + 1)] = list(t)


def round_robin(n, w):
    """Week w pairs (1-based team indices) of a circle-method round robin over n teams."""
    r = (w - 1) % (n - 1); idx = list(range(n)); rest = idx[1:]; rest = rest[r:] + rest[:r]; idx = [0] + rest
    return [(idx[i] + 1, idx[n - 1 - i] + 1) for i in range(n // 2)]


# ---------- output ----------
out = {"scoring": SC, "slots": SLOTS, "weeks": [], "games": {}, "players": {},
       "meta": {"season": "2024-25", "synthetic": True, "leagues": NLEAGUE, "moves": moves,
                "draft_rule": "see research/build_season2024.py docstring"}}
all_pids = {p for r in rosters.values() for p in r}
for p in all_pids: out["players"][p] = {"name": name_of(p), "pos": pos_of(p)}
for w in WEEKS:
    out["games"][str(w)] = [{k: v for k, v in g.items() if k != "week"} for p in sorted(all_pids) for g in pgames(p) if g["week"] == w]
    teams = {str(rid): {"players": rosters[(w, rid)], "starters": [], "human_points": None, "human_slot_points": []}
             for (ww, rid) in rosters if ww == w}
    mu = [[li * NTEAM + a, li * NTEAM + b] for li in range(NLEAGUE) for a, b in round_robin(NTEAM, w)]
    out["weeks"].append({"week": w, "dates": sorted({g["date"] for g in games_by_week[w]}), "teams": teams, "matchups": mu})
json.dump(out, open(OUT, "w"))

# ---------- report ----------
print(f"weeks {len(out['weeks'])}, team-weeks {sum(len(W['teams']) for W in out['weeks'])}, players {len(all_pids)}, "
      f"missing ESPN tips {miss_tip[0]}, roster moves {len(moves)}")
for m in moves: print("  move", m)
for li, teams in enumerate(leagues):
    print(f"league {li}: first rounds", [name_of(t[0]) for t in teams])
# leakage / pre-game diagnostics over all player-games of rostered players
G = [g for p in all_pids for g in pgames(p)]
pl = [g for g in G if g["played"]]; dnp = [g for g in G if not g["played"]]
pres_pl = sum(g["proj_sleeper"] is not None for g in pl) / len(pl); pres_dnp = sum(g["proj_sleeper"] is not None for g in dnp) / max(1, len(dnp))
xy = [(g["proj_sleeper"], g["actual"]) for g in pl if g["proj_sleeper"] is not None]
xs, ys = zip(*xy); mx, my = st.mean(xs), st.mean(ys)
r = sum((x - mx) * (y - my) for x, y in xy) / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
after = sum(1 for g in pl if g["proj_mod"] and g["proj_mod"] > g["tip"]) / len(pl)
# does the projection know more than recent form? compare corr(form, actual) and corr(proj, actual) on the same games
fx = [(form(g["pid"], g["week"]), g["proj_sleeper"], g["actual"]) for g in pl if g["proj_sleeper"] is not None and form(g["pid"], g["week"]) > 0]


def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


print(f"player-games {len(G)}: played {len(pl)}, DNP {len(dnp)} ({len(dnp) / len(G):.1%})")
print(f"projection present: played {pres_pl:.1%}, DNP {pres_dnp:.1%}   corr(proj, actual) {r:.3f}  mean proj {mx:.1f} actual {my:.1f}  "
      f"last_modified after tip {after:.0%}")
print(f"same games (n={len(fx)}): corr(form-before-week, actual) {corr([a for a, _, _ in fx], [c for _, _, c in fx]):.3f}  "
      f"corr(proj, actual) {corr([b for _, b, _ in fx], [c for _, _, c in fx]):.3f}  corr(|proj-actual|) exact matches "
      f"{sum(1 for _, b, c in fx if abs(b - c) < 0.01)}")
