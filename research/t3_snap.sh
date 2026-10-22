#!/bin/bash
# Task T3: live in-game snapshots for calibrating the in-game final-score estimate (lib/live/ingame.ts).
# Every INTERVAL s until every game of DATE is final (or MAXH hours): ESPN scoreboard (period / clock / state) and
# Sleeper's week stats (live per-player stats incl. seconds played). Usage: research/t3_snap.sh 2026-10-21 1 <outdir>
DATE=$1; WEEK=$2; OUT=$3; INTERVAL=${INTERVAL:-480}; MAXH=${MAXH:-7}
SEASON=${DATE:0:4}; D=${DATE//-/}
mkdir -p "$OUT"
end=$(( $(date +%s) + MAXH * 3600 ))
while [ "$(date +%s)" -lt "$end" ]; do
  ts=$(date +%s)
  curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=$D" -o "$OUT/sb_$ts.json"
  curl -s "https://api.sleeper.app/stats/nba/$SEASON/$WEEK?season_type=regular" -o "$OUT/st_$ts.json"
  if python3 -c "import json,sys; j=json.load(open('$OUT/sb_$ts.json')); sys.exit(0 if j.get('events') and all(e['status']['type']['state']=='post' for e in j['events']) else 1)" 2>/dev/null; then
    echo "all final at $ts"; exit 0
  fi
  sleep "$INTERVAL"
done
