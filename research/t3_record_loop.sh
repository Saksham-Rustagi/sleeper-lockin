#!/bin/bash
# Task T3: record the live state (research/t3_record.ts) every INTERVAL s for MAXH hours.
#   bash research/t3_record_loop.sh <leagueId> <rosterId> <outDir>
INTERVAL=${INTERVAL:-600}; MAXH=${MAXH:-5}
end=$(( $(date +%s) + MAXH * 3600 ))
while [ "$(date +%s)" -lt "$end" ]; do
  node research/dist/t3_record.cjs "$1" "$2" "$3" || echo "record failed at $(date)"
  sleep "$INTERVAL"
done
