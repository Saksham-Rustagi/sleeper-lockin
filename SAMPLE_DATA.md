# Sample Data Guide

This guide explains how to create custom CSV or JSON files to import into the Sleeper Lock-In Optimizer.

## CSV Format

### Structure

```csv
player,positions,tipoffUtc,opponent,projection,variance,actual,status
```

### Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| player | string | Yes | Player full name | `Luka Doncic` |
| positions | string | Yes | Slash-separated eligible positions | `PG/SG` or `SF/PF` or `C` |
| tipoffUtc | ISO datetime | Yes | Game tip-off in UTC | `2024-10-14T19:00:00.000Z` |
| opponent | string | Yes | Opponent team abbreviation | `LAL`, `BOS`, `GSW` |
| projection | number | Yes | Projected fantasy points | `42.5` |
| variance | number | No | Projection variance (std dev) | `8.2` |
| actual | number | No | Actual fantasy points (if finished) | `45.3` |
| status | enum | No | Game status: `UPCOMING`, `IN_PROGRESS`, or `FINAL` | `UPCOMING` |

### Example CSV

```csv
player,positions,tipoffUtc,opponent,projection,variance,actual,status
Luka Doncic,PG/SG,2024-10-14T19:00:00.000Z,LAL,42.5,8.2,,UPCOMING
Stephen Curry,PG/SG,2024-10-14T19:30:00.000Z,BOS,38.3,7.5,,UPCOMING
LeBron James,SF/PF,2024-10-14T20:00:00.000Z,GSW,40.1,6.8,,UPCOMING
Nikola Jokic,C,2024-10-14T20:00:00.000Z,PHX,48.2,9.1,52.5,FINAL
Damian Lillard,PG,2024-10-14T22:00:00.000Z,MIA,35.6,7.2,,UPCOMING
Luka Doncic,PG/SG,2024-10-15T19:00:00.000Z,DEN,44.8,8.5,,UPCOMING
```

### Tips

1. **Multiple Games**: Same player can appear multiple times (different games)
2. **Positions**: Use NBA standard positions: PG, SG, SF, PF, C
3. **Dates**: Always use ISO 8601 format with UTC timezone (trailing `Z`)
4. **Actuals**: Only set for finished games (status = FINAL)
5. **Roster**: First 9 unique players become starters, rest are bench

## JSON Format

### Full Schema

```json
{
  "league": {
    "weekStartUtc": "2024-10-14T00:00:00.000Z",
    "weekEndUtc": "2024-10-21T00:00:00.000Z",
    "startingSlots": ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"],
    "slotEligibility": {
      "PG": ["PG"],
      "SG": ["SG"],
      "G": ["PG", "SG"],
      "SF": ["SF"],
      "PF": ["PF"],
      "F": ["SF", "PF"],
      "C": ["C"],
      "UTIL": ["PG", "SG", "SF", "PF", "C"]
    }
  },
  "players": [
    {
      "id": "p1",
      "name": "Luka Doncic",
      "eligible": ["PG", "SG"]
    }
  ],
  "games": [
    {
      "gameId": "g1",
      "playerId": "p1",
      "tipoffUtc": "2024-10-14T19:00:00.000Z",
      "opponent": "LAL",
      "projection": 42.5,
      "variance": 8.2,
      "actual": 45.3,
      "status": "FINAL"
    }
  ],
  "roster": {
    "starters": ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
    "bench": ["p10", "p11"]
  }
}
```

### Field Descriptions

#### League Settings

- `weekStartUtc`: Week start date (usually Monday 00:00 UTC)
- `weekEndUtc`: Week end date (usually next Monday 00:00 UTC)
- `startingSlots`: Array of 9 starting positions
- `slotEligibility`: Map of which player positions can fill each slot

#### Players

- `id`: Unique player identifier (string)
- `name`: Display name
- `eligible`: Array of positions player is eligible for

#### Games

- `gameId`: Unique game identifier
- `playerId`: References player.id
- `tipoffUtc`: ISO datetime
- `opponent`: Team abbreviation
- `projection`: Projected points
- `variance`: (Optional) Standard deviation
- `actual`: (Optional) Actual points if finished
- `status`: `UPCOMING`, `IN_PROGRESS`, or `FINAL`

#### Roster

- `starters`: Array of player IDs for starting lineup
- `bench`: Array of player IDs for bench

## Position Eligibility Reference

### Standard NBA Positions

- **PG** (Point Guard): Pure point guards
- **SG** (Shooting Guard): Pure shooting guards
- **SF** (Small Forward): Pure small forwards
- **PF** (Power Forward): Pure power forwards
- **C** (Center): Pure centers

### Flex Positions

- **G** (Guard): Accepts PG or SG
- **F** (Forward): Accepts SF or PF
- **UTIL** (Utility): Accepts any position (PG, SG, SF, PF, C)

### Multi-Position Players

Players can be eligible for multiple base positions:
- `["PG", "SG"]` - Combo guard (e.g., Luka Doncic)
- `["SF", "PF"]` - Tweener forward (e.g., LeBron James)
- `["PF", "C"]` - Big (e.g., Anthony Davis)

## Example: Typical Week

A typical week should include:

1. **14 players** total (9 starters + 5 bench)
2. **3-4 games per player** across the week
3. **Overlapping tip-offs** to test matching logic
4. **Mix of finished/upcoming** games for testing lock decisions
5. **Variance values** to test risk modes

## Generating Test Data

### Python Script

```python
import json
from datetime import datetime, timedelta

players = [
    {"id": f"p{i}", "name": f"Player {i}", "eligible": ["PG", "SG"]}
    for i in range(1, 15)
]

games = []
start = datetime(2024, 10, 14, 19, 0)
for i, player in enumerate(players):
    for day in range(4):
        games.append({
            "gameId": f"g{len(games)}",
            "playerId": player["id"],
            "tipoffUtc": (start + timedelta(days=day, hours=i % 3)).isoformat() + "Z",
            "opponent": "OPP",
            "projection": 30 + (i * 2),
            "variance": 5 + (i % 5),
            "status": "UPCOMING"
        })

week_data = {
    "league": {
        "weekStartUtc": start.isoformat() + "Z",
        "weekEndUtc": (start + timedelta(days=7)).isoformat() + "Z",
        "startingSlots": ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"],
        "slotEligibility": {
            "PG": ["PG"], "SG": ["SG"], "G": ["PG", "SG"],
            "SF": ["SF"], "PF": ["PF"], "F": ["SF", "PF"],
            "C": ["C"], "UTIL": ["PG", "SG", "SF", "PF", "C"]
        }
    },
    "players": players,
    "games": games,
    "roster": {
        "starters": [p["id"] for p in players[:9]],
        "bench": [p["id"] for p in players[9:]]
    }
}

with open("custom_week.json", "w") as f:
    json.dump(week_data, f, indent=2)
```

## Troubleshooting

### Common Issues

1. **"Invalid row X: missing required fields"**
   - Ensure all required CSV columns are present
   - Check for empty cells in required fields

2. **"Invalid week data: ..."**
   - Validate JSON structure matches schema
   - Check datetime format (must be ISO 8601 with `Z`)

3. **"No eligible slots available"**
   - Verify player positions match slot eligibility
   - Check slotEligibility map is correct

4. **Performance issues**
   - Keep total games under 100 for best performance
   - DP solver times out >200ms, falls back to greedy

### Validation

The app uses Zod schemas to validate imported data. Errors will specify:
- Field path (e.g., `games[0].projection`)
- Expected type
- Actual value received

## Next Steps

1. Create your CSV/JSON file
2. Go to Setup page
3. Upload file or use Sleeper API
4. Start optimizing!

For more examples, see `/public/mocks/week.sample.json` in the repository.

