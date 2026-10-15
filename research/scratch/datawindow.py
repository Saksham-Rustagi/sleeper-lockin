# Which logged league inputs changed in a time window? (read-only, ~/.sleeper-lockin/data/season-2026/*.jsonl)
# usage: python3 research/scratch/datawindow.py <fromISOutc> <toISOutc>
import json, os, sys, datetime as dt
D = os.path.expanduser("~/.sleeper-lockin/data/season-2026")
lo = dt.datetime.fromisoformat(sys.argv[1]).replace(tzinfo=dt.timezone.utc).timestamp() * 1000
hi = dt.datetime.fromisoformat(sys.argv[2]).replace(tzinfo=dt.timezone.utc).timestamp() * 1000
for f in ["rosters", "injuries", "projections", "transactions", "games"]:
    n = tot = 0; ex = []; first = last = None
    with open(os.path.join(D, f + ".jsonl")) as fh:
        for line in fh:
            tot += 1
            try: r = json.loads(line)
            except Exception: continue
            ts = r.get("ts", 0); first = first or ts; last = ts
            if lo <= ts <= hi:
                n += 1
                if len(ex) < 5: ex.append(r)
    span = f"log {dt.datetime.utcfromtimestamp(first/1000):%m-%d %H:%M}..{dt.datetime.utcfromtimestamp(last/1000):%m-%d %H:%M} UTC" if first else "empty"
    print(f"{f}: {n} rows in window (of {tot}; {span})")
    for r in ex:
        ts = r.pop("ts"); print("   ", f"{dt.datetime.utcfromtimestamp(ts/1000):%m-%d %H:%M}", str(r)[:220])
