# Sleeper Lock-In Optimizer

A production-quality React + TypeScript web app that recommends optimal daily starts and lock decisions for **Sleeper fantasy basketball Lock-In mode**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Overview

Lock-In mode requires each starting roster slot to have exactly one locked game by week's end. This optimizer uses advanced matching algorithms and dynamic programming to maximize your total weekly points while respecting all Lock-In constraints.

### Key Features

- **🎯 Smart Start Recommendations**: Bipartite matching algorithm with scarcity penalties
- **🔒 Intelligent Lock Decisions**: Real-time recommendations comparing locking now vs. waiting
- **📊 What-If Analysis**: Exact DP solver for optimal solutions with editable projections
- **🔄 Sleeper API Integration**: Auto-import rosters and player data
- **📁 CSV/JSON Import**: Manual data entry for custom projections
- **⚙️ Risk Modes**: Conservative, Neutral, or Aggressive lock strategies
- **💾 Auto-Save**: All data persisted locally in your browser

## Lock-In Rules

1. **Weekly Roster Lock**: Each starting slot must have exactly one locked game by week's end
2. **Per-Player Lock**: A player can only be locked to one slot for the entire week
3. **Tip-Off Locking**: Players must be in starting lineup at tip-off to be eligible for lock
4. **Sequential Locking**: You can only lock the most recent finished game for a player
5. **Position Eligibility**: Player must be eligible for the slot you're locking them to

## Installation

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Usage

### 1. Import Data

Choose one of three methods:

- **Sleeper API**: Enter your username → select league → auto-import roster
- **File Upload**: Upload CSV or JSON with player/game data
- **Demo Data**: Try the app with sample data (14 players, 30 games)

### 2. View Timeline

See all games chronologically grouped by day with:
- Tip-off times
- Start recommendations
- Player projections and actuals

### 3. Make Lock Decisions

When games finish:
- View recommended lock decision (LOCK or PASS)
- See delta vs. keeping options open
- One-click lock to optimal slot

### 4. What-If Scenarios

- Edit projections and actuals
- Adjust risk tolerance (λ variance multiplier)
- Compare policy results vs. exact DP solution

## CSV Format

```csv
player,positions,tipoffUtc,opponent,projection,variance,actual,status
Luka Doncic,PG/SG,2024-10-14T19:00:00.000Z,LAL,42.5,8.2,,UPCOMING
Stephen Curry,PG/SG,2024-10-14T19:30:00.000Z,BOS,38.3,7.5,45.2,FINAL
```

## JSON Format

See `/public/mocks/week.sample.json` for full schema.

## Algorithms

### Start Recommendations
- **Hungarian Algorithm**: Maximum-weight bipartite matching
- **Scarcity Penalty**: Favors saving scarce positions (e.g., C) for later
- **Variance-Aware EV**: `EV = projection + λ × variance`

### Lock Decisions
- **Look-Ahead**: Computes best remaining expected value if we don't lock now
- **Delta Calculation**: Lock if `total_with_lock >= total_without_lock + ε`
- **Risk Modes**: 
  - Conservative (ε = -2): Lock earlier for safety
  - Neutral (ε = 0): Balanced approach
  - Aggressive (ε = +2): Wait for upside

### Exact DP (What-If)
- **State**: `(locked_slots_mask, locked_players, event_index)`
- **Memoization**: With dominance pruning
- **Timeout**: Falls back to greedy if >200ms

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State**: Zustand with localStorage persistence
- **Charts**: Recharts (optional)
- **Date Utils**: date-fns
- **Validation**: Zod

## Project Structure

```
src/
├── app/              # Next.js pages
│   ├── page.tsx      # Landing page
│   ├── setup/        # Data import wizard
│   └── optimizer/    # Main dashboard
├── components/       # React components
│   ├── timeline/     # Week timeline view
│   ├── decisions/    # Lock decision panel
│   ├── whatif/       # What-if simulator
│   └── lineup/       # Lineup grid
├── lib/              # Core logic
│   ├── matching.ts   # Hungarian algorithm
│   ├── optimizer.ts  # Start/lock policies
│   ├── optimizerDP.ts # Exact DP solver
│   ├── eligibility.ts
│   ├── parser.ts
│   └── sleeper/      # Sleeper API client
└── types/            # TypeScript definitions
```

## Development

### Run Tests
```bash
npm test
```

### Build for Production
```bash
npm run build
npm start
```

### Lint
```bash
npm run lint
```

## API Integration

The app uses the [Sleeper API](https://docs.sleeper.app/) to fetch:
- User leagues and rosters
- Player database (cached 24h)
- NBA state (current week/season)

**Note**: Game projections are mocked. In production, integrate with a projections provider (e.g., FantasyPros, Basketball Monster).

## Performance

- **Target**: <50ms recompute on typical changes
- **DP Timeout**: 200ms with fallback to greedy
- **Caching**: Player data cached in localStorage
- **Persistence**: Full state saved automatically

## License

MIT License - see LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or PR.

## Acknowledgments

- Built for Sleeper fantasy basketball Lock-In mode
- Algorithm design inspired by classical assignment problems
- UI components from [shadcn/ui](https://ui.shadcn.com/)

---

**Disclaimer**: This is an independent tool and is not affiliated with or endorsed by Sleeper.
