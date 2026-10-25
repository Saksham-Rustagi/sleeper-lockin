// Task T3: a player's FINAL score for a game in progress, from what he has so far (pure; used by lib/live/week.ts when
// "midgameForfeit" is on). Inputs: his fantasy points so far (league scoring of Sleeper's live per-game stats, = the
// matchup's players_points), seconds played and fouls (Sleeper), the game clock (ESPN period / clock), his pre-game
// model (mu, sd if he plays: lib/engine/model.ts) and Sleeper's projected seconds for the game.
//   elapsed E / total T game minutes (48, + 5 per overtime period), remaining G = T - E
//   minutes share   s = (s0 * kShare + m) / (kShare + E)        s0 = projected minutes / 48 (prior, kShare game-minutes)
//   points / minute r = (r0 * kRate + pts) / (kRate + m)         r0 = pre-game mu / projected minutes (prior, kRate minutes)
//   remaining minutes R = s * G (0 when he is out for the rest of the game), capped so that m + R <= T
//   final ~ Normal(pts + R * r, sd),  sd = pre-game sd * sqrt(R / projected minutes) * sdScale (min sdMin while R > 0)
// Out for the rest of the game (no remaining minutes): ejected (ESPN box score), fouled out (6 personal fouls), or ruled
// out after he played (Sleeper's tag Out / Inactive while he has stats and ESPN doesn't show him on the court, or ESPN's
// injury list reports him Out after the tip). The parameters (ING) were checked on live snapshots of 2026-10-21's games
// (research/t3_calib.py, REPORT "Mid-game forfeit").
export const ING = { kShare: 12, kRate: 20, sdScale: 1, sdMin: 0.5, fallbackRate: 0.9, rateFloor: 0.25 };

export interface InGameInput {
  pts: number; sec: number; fouls?: number;
  period: number; clock: number;           // ESPN: period (1-4, 5+ = OT) and seconds left in it
  preMu: number; preSd: number;            // pre-game model of his score if he plays
  projSec?: number | null;                 // Sleeper's projected seconds for this game
  out?: string | null;                     // why he is out for the rest of the game (outReason), null = not
}
export interface InGameEst {
  pts: number; min: number; elapsed: number; total: number; remMin: number; rate: number;
  mu: number; sd: number;                  // his final score for this game (rounded to 0.5: the cache key moves in steps)
  out: string | null; key: string;
}

export function gameMinutes(period: number, clock: number): { elapsed: number; total: number } {
  if (period <= 4) return { elapsed: Math.min(48, Math.max(0, (period - 1) * 12 + (720 - clock) / 60)), total: 48 };
  const total = 48 + (period - 4) * 5;
  return { elapsed: Math.min(total, 48 + (period - 5) * 5 + (300 - clock) / 60), total };
}

export function inGameEstimate(x: InGameInput, P = ING): InGameEst {
  const { elapsed, total } = gameMinutes(x.period, x.clock);
  const m = Math.max(0, x.sec) / 60; const G = Math.max(0, total - elapsed);
  const proj = x.projSec && x.projSec > 0 ? x.projSec / 60 : Math.min(40, Math.max(10, x.preMu / P.fallbackRate));
  const s0 = Math.min(1, proj / 48);
  const s = Math.min(1, Math.max(0, (s0 * P.kShare + m) / (P.kShare + elapsed)));
  const out = x.out ?? (x.fouls !== undefined && x.fouls >= 6 ? "fouled out" : null);
  const remMin = out ? 0 : Math.max(0, Math.min(s * G, total - m));
  const r0 = Math.max(0, x.preMu) / proj;
  const rate = Math.max(P.rateFloor * r0, (r0 * P.kRate + x.pts) / (P.kRate + m));
  const half = (v: number) => Math.round(v * 2) / 2;
  const mu = half(x.pts + remMin * rate);
  const sd = out || remMin <= 0 ? 0.05 : Math.max(P.sdMin, half(x.preSd * Math.sqrt(remMin / proj) * P.sdScale));
  return { pts: x.pts, min: Math.round(m * 10) / 10, elapsed: Math.round(elapsed * 10) / 10, total, remMin: Math.round(remMin * 10) / 10, rate: Math.round(rate * 100) / 100, mu, sd, out,
    key: `${mu}|${sd}|${out ? 1 : 0}` };
}

// Why a player who has played in a game in progress won't play again in it (null = he may):
//  - ejected (ESPN), fouled out (6 fouls);
//  - ruled out: Sleeper's tag is Out-like while he has stats (a tag set mid-game) and ESPN doesn't show him on the
//    court (on-court flag unknown: the tag alone), or ESPN's injury list reports him Out with a date after the tip.
export function outReason(a: { ejected?: boolean; fouls?: number; tagOut?: boolean; onCourt?: boolean | null; espnOutAfterTip?: boolean }): string | null {
  if (a.ejected) return "ejected";
  if ((a.fouls ?? 0) >= 6) return "fouled out";
  if (a.espnOutAfterTip) return "ruled out for the rest of the game (ESPN injury report)";
  if (a.tagOut && a.onCourt !== true) return "ruled out for the rest of the game (Sleeper: Out)";
  return null;
}

// ESPN game summary (in progress) -> per player: on the court now, ejected, fouls; injury-list entries reported Out after
// the tip. Names as ESPN displays them (matched to Sleeper ids by lib/live/boxscores.ts pidMatcher).
export interface EspnLive { players: { name: string; team: string; onCourt: boolean; ejected: boolean; fouls: number }[]; outAfterTip: { name: string; team: string }[] }
const ESPN_FIX: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
export function parseEspnLive(j: any, tip: number): EspnLive {
  const players: EspnLive["players"] = [];
  for (const t of j?.boxscore?.players || []) {
    const team = ESPN_FIX[t.team?.abbreviation] ?? t.team?.abbreviation; const st = t.statistics?.[0]; if (!team || !st) continue;
    const fi = (st.keys || []).indexOf("fouls");
    for (const a of st.athletes || []) players.push({ name: a.athlete?.displayName ?? "", team, onCourt: !!a.active, ejected: !!a.ejected, fouls: fi >= 0 ? Number(a.stats?.[fi] ?? 0) || 0 : 0 });
  }
  const outAfterTip: EspnLive["outAfterTip"] = [];
  for (const t of j?.injuries || []) {
    const team = ESPN_FIX[t.team?.abbreviation] ?? t.team?.abbreviation;
    for (const i of t.injuries || []) if (/^out$/i.test(i.status || "") && Date.parse(i.date) > tip) outAfterTip.push({ name: i.athlete?.displayName ?? "", team });
  }
  return { players, outAfterTip };
}
