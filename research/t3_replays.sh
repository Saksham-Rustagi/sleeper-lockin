#!/bin/bash
# Task T3: replay recorded live moments (research/t3_record.ts) through the live check (research/t3_live.ts), option on and
# off; determinism check (two runs on one recording). Outputs research/scratch/t3/replay/<rec>_{on,off,on2}.{txt,json}.
#   bash research/t3_replays.sh [--twice] research/scratch/t3/rec/rec_A.json.gz [rec_B ...]
set -u
TWICE=""; if [ "${1:-}" = "--twice" ]; then TWICE=1; shift; fi
OUT=research/scratch/t3/replay; mkdir -p "$OUT"
for f in "$@"; do
  b=$(basename "$f" .json.gz)
  REPLAY="$f" node research/dist/t3_live.cjs - - "$OUT/${b}_on.json" > "$OUT/${b}_on.txt" 2>&1
  REPLAY="$f" LOCKIN_MIDGAME_FORFEIT=0 node research/dist/t3_live.cjs - - "$OUT/${b}_off.json" > "$OUT/${b}_off.txt" 2>&1
  if [ -n "$TWICE" ]; then REPLAY="$f" node research/dist/t3_live.cjs - - "$OUT/${b}_on2.json" > "$OUT/${b}_on2.txt" 2>&1; fi
  echo "$b done"
done
