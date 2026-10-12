#!/usr/bin/env python3
"""Accuracy report for logged Sleeper data (stdlib only).

usage: python3 research/accuracy_report.py [season_dir] [--sqlite]
  season_dir defaults to the newest ~/.sleeper-lockin/data/season-*
Writes <season_dir>/report-<date>.md (and league.sqlite with --sqlite) and prints the report.

Answers: Are Sleeper's pre-game projections accurate (bias, MAE, correlation, calibration)? Does our corrected
model (actual ~ A + B*proj) beat the raw number? Do injury designations predict sit-outs as assumed? Do
late projection updates help? Are some teams/positions systematically off? Is the app's win probability
calibrated?"""
import json, os, sys, glob, math, statistics as st, sqlite3, datetime, collections

MODEL_DEFAULT = {"A": -0.761, "B": 0.904}
ASSUMED_PLAY = {"out": 0.03, "doubtful": 0.25, "questionable": 0.6, "gtd": 0.6, "dtd": 0.8, "probable": 0.92}

def load(d, name):
    p = os.path.join(d, name + ".jsonl")
    if not os.path.exists(p):
        return []
    with open(p) as f:
        return [json.loads(l) for l in f if l.strip()]

def corr(x, y):
    if len(x) < 3:
        return float("nan")
    mx, my = st.mean(x), st.mean(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y)); sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else float("nan")

def metrics(pred, act):
    e = [p - a for p, a in zip(pred, act)]
    return {"n": len(e), "bias": st.mean(e), "mae": st.mean(abs(x) for x in e), "rmse": math.sqrt(st.mean(x * x for x in e)), "corr": corr(pred, act)}

def fmt(m):
    return f"n={m['n']}, bias {m['bias']:+.2f}, MAE {m['mae']:.2f}, RMSE {m['rmse']:.2f}, corr {m['corr']:.3f}"

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = args[0] if args else sorted(glob.glob(os.path.expanduser("~/.sleeper-lockin/data/season-*")))[-1]
    meta = json.load(open(os.path.join(d, "_meta.json"))) if os.path.exists(os.path.join(d, "_meta.json")) else {}
    M = meta.get("model", MODEL_DEFAULT)
    proj, stats, inj, mus, adv = (load(d, n) for n in ["projections", "stats", "injuries", "matchups", "advice"])
    L = []
    w = L.append
    w(f"# Projection accuracy report — {os.path.basename(d)}  ({datetime.date.today()})\n")
    w(f"Rows: {len(proj)} projection snapshots, {len(stats)} stat rows, {len(inj)} injury changes, {len(mus)} matchup snapshots, {len(adv)} advice snapshots.\n")

    # final stats per game (latest row wins = includes corrections)
    final = {}
    for r in stats:
        final[(r["pid"], r["game_id"])] = r
    # projection snapshots per game, recorded before tip
    snaps = collections.defaultdict(list)
    for r in proj:
        if r.get("tip") and r["ts"] >= r["tip"]:
            continue
        snaps[(r["pid"], r["game_id"])].append(r)
    games = []
    for k, ss in snaps.items():
        if k not in final:
            continue
        ss.sort(key=lambda r: r["ts"])
        f = final[k]
        games.append({"pid": k[0], "game": k[1], "first": ss[0]["fp"], "last": ss[-1]["fp"], "inj": (ss[-1].get("injury") or "").lower(),
                      "played": f["played"], "actual": f["fp"], "team": f.get("team"), "roster": f.get("roster_id"), "pos": None, "date": f.get("date"), "n_snaps": len(ss)})
    w(f"Games with a pre-tip projection AND a final result: **{len(games)}**\n")
    if not games:
        w("_No finished games with logged projections yet — come back after games have been played._\n")
        return finish(d, L)

    played = [g for g in games if g["played"]]
    w("## 1. Accuracy when the player plays\n")
    raw = metrics([g["last"] for g in played], [g["actual"] for g in played])
    cal = metrics([M["A"] + M["B"] * g["last"] for g in played], [g["actual"] for g in played])
    w(f"- Sleeper projection (last before tip): {fmt(raw)}")
    w(f"- App model (A + B·proj, A={M['A']}, B={M['B']}): {fmt(cal)}")
    w(f"- Mean projection {st.mean(g['last'] for g in played):.1f} vs mean actual {st.mean(g['actual'] for g in played):.1f}\n")
    # refit
    x = [g["last"] for g in played]; y = [g["actual"] for g in played]
    if len(x) > 30:
        mx, my = st.mean(x), st.mean(y); b = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sum((a - mx) ** 2 for a in x); a0 = my - b * mx
        w(f"- Refit on this data: actual ≈ {a0:.2f} + {b:.3f}·proj (app currently uses {M['A']} + {M['B']}·proj)\n")

    w("## 2. Calibration (played games, 5-pt projection bins)\n")
    w("| projection | n | mean proj | mean actual | sd actual |\n|---|---|---|---|---|")
    bins = collections.defaultdict(list)
    for g in played:
        bins[int(g["last"] // 5 * 5)].append(g)
    for b in sorted(bins):
        v = bins[b]
        if len(v) >= 5:
            w(f"| {b}-{b+5} | {len(v)} | {st.mean(g['last'] for g in v):.1f} | {st.mean(g['actual'] for g in v):.1f} | {st.pstdev([g['actual'] for g in v]):.1f} |")
    w("")

    w("## 3. Sit-outs vs injury designation at last projection\n")
    w("| designation | games | played | play rate | app assumes |\n|---|---|---|---|---|")
    by = collections.defaultdict(list)
    for g in games:
        by[g["inj"] or "none"].append(g)
    for k in sorted(by, key=lambda k: -len(by[k])):
        v = by[k]; rate = sum(g["played"] for g in v) / len(v)
        assumed = "%d%%" % round(ASSUMED_PLAY[k] * 100) if k in ASSUMED_PLAY else "chain (~91%)"
        w(f"| {k} | {len(v)} | {sum(g['played'] for g in v)} | {rate:.0%} | {assumed} |")
    w("")

    moved = [g for g in played if g["n_snaps"] > 1 and abs(g["first"] - g["last"]) > 0.01]
    if len(moved) >= 10:
        w("## 4. Do late projection updates help?\n")
        w(f"- {len(moved)} played games had their projection change before tip.")
        w(f"- First snapshot: {fmt(metrics([g['first'] for g in moved], [g['actual'] for g in moved]))}")
        w(f"- Last snapshot:  {fmt(metrics([g['last'] for g in moved], [g['actual'] for g in moved]))}\n")

    w("## 5. Bias by fantasy team (players on each roster)\n")
    w("| roster | games | bias (proj − actual) | MAE |\n|---|---|---|---|")
    br = collections.defaultdict(list)
    for g in played:
        br[g["roster"]].append(g)
    for k in sorted(br, key=lambda k: (k is None, k)):
        v = br[k]
        if len(v) >= 10:
            m = metrics([g["last"] for g in v], [g["actual"] for g in v])
            w(f"| {k if k is not None else 'free agents'} | {m['n']} | {m['bias']:+.2f} | {m['mae']:.2f} |")
    w("")

    w("## 6. Biggest misses\n")
    names = {r["pid"]: r.get("name") for r in inj}
    for title, key in [("Over-projected", lambda g: g["actual"] - g["last"]), ("Under-projected", lambda g: g["last"] - g["actual"])]:
        w(f"**{title}:** " + "; ".join(f"{names.get(g['pid'], g['pid'])} {g['date']} proj {g['last']:.1f} → {g['actual']:.1f}" for g in sorted(played, key=key)[:8]))
    w("")

    # app win-probability calibration (needs final matchup points)
    if adv:
        last = {}
        for r in mus:
            last[(r["week"], r["roster_id"])] = r
        cfg_roster = None
        cfgp = os.path.expanduser("~/.sleeper-lockin/config.json")
        if os.path.exists(cfgp):
            cfg_roster = json.load(open(cfgp)).get("rosterId")
        rows = []
        for a in adv:
            me = last.get((a["week"], cfg_roster))
            if not me or me.get("matchup_id") is None or a.get("winProb") is None:
                continue
            opp = next((v for (wk, rid), v in last.items() if wk == a["week"] and rid != cfg_roster and v.get("matchup_id") == me["matchup_id"]), None)
            if not opp:
                continue
            won = 1.0 if me["points"] > opp["points"] else 0.5 if me["points"] == opp["points"] else 0.0
            rows.append((a["winProb"], won))
        if rows:
            brier = st.mean((p - o) ** 2 for p, o in rows)
            w(f"## 7. App win probability\n\n- {len(rows)} logged forecasts, Brier score {brier:.3f} (0.25 = coin flip; lower is better).\n")
    return finish(d, L, "--sqlite" in sys.argv)

def finish(d, L, want_sqlite=False):
    txt = "\n".join(L)
    out = os.path.join(d, f"report-{datetime.date.today()}.md")
    open(out, "w").write(txt)
    print(txt)
    print(f"\n(saved {out})")
    if want_sqlite:
        db = os.path.join(d, "league.sqlite")
        if os.path.exists(db):
            os.remove(db)
        con = sqlite3.connect(db)
        for name in ["projections", "stats", "injuries", "matchups", "rosters", "games", "transactions", "advice"]:
            rows = load(d, name)
            if not rows:
                continue
            cols = sorted({k for r in rows for k in r})
            coldefs = ", ".join('"%s"' % c for c in cols)
            con.execute("create table %s (%s)" % (name, coldefs))
            con.executemany(f"insert into {name} values ({', '.join('?' * len(cols))})",
                            [[json.dumps(r[c]) if isinstance(r.get(c), (dict, list)) else r.get(c) for c in cols] for r in rows])
        con.commit(); con.close()
        print(f"(sqlite: {db})")

if __name__ == "__main__":
    main()
