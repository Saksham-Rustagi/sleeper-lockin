// Score model fitted on the full 2025-26 season of league "late night fun" (11.4k player-games).
//   actual | plays  ~  Normal(mu, sd),  mu = A + B * sleeperProjection,  sd^2 = C + D * mu
//   P(plays next game | played last) = P1,  P(plays | missed last) = P0
// Re-fit with research/build_dataset.py + the fitModel() in research/backtest.ts.
export const MODEL = { A: -0.761, B: 0.904, C: 31.0, D: 3.7, P1: 0.914, P0: 0.238 };

export function gameDist(projection: number) {
  const mu = MODEL.A + MODEL.B * projection;
  return { mu, sd: Math.sqrt(Math.max(9, MODEL.C + MODEL.D * Math.max(0, mu))) };
}

// Probability of playing his next game given the Sleeper injury designation.
// null => use the played-last-game chain. Values are judgement calls (documented in README).
export function injuryPlayProb(status: string | null | undefined): number | null {
  switch ((status || "").toLowerCase()) {
    case "out": case "inactive": case "ir": case "sus": case "suspended": return 0.03;
    case "doubtful": return 0.25;
    case "questionable": case "gtd": return 0.6;
    case "dtd": return 0.8;
    case "probable": return 0.92;
    default: return null;
  }
}

export function fantasyPoints(stats: Record<string, unknown> | null | undefined, scoring: Record<string, number>): number {
  if (!stats) return 0;
  let t = 0;
  for (const [k, v] of Object.entries(stats)) if (typeof v === "number" && scoring[k]) t += scoring[k] * v;
  return Math.round(t * 100) / 100;
}
