// Opportunity detection (task O, research/REPORT.md "Opportunity alerts"): find players whose role grows before
// Sleeper's projections do. Pure functions over a minutes history (box scores: lib/live/boxscores.ts live, Sleeper
// weekly stats in research), shared by the live scan (lib/live/oppscan.ts), the notifier and the validation
// (research/o_val.ts), so the backtest runs exactly this code.
//   replacementCandidates: a rotation player is out -> rank his teammates by the minutes they are expected to absorb
//                          (with/without history this season + last season, shrunk toward a position/depth prior)
//   surge:                 a player's last-3-game minutes are well above what his Sleeper projection implies
//   overrideEstimate:      shrunk recent per-minute production x expected minutes (the minutes-based projection)

export interface PGame { key: string; date: string; tip: number; team: string; pre: boolean; min: number; fp: number; played: boolean }
export interface TeamGame { key: string; date: string; tip: number; pre: boolean }
// byPid: every game a player was on a team's box score / stat sheet (DNPs included: min 0, played false), sorted by tip
export interface Hist { byPid: Map<string, PGame[]>; teamGames: Map<string, TeamGame[]>; rows: number }

export function histFrom(rows: (PGame & { pid: string })[]): Hist {
  const byPid = new Map<string, PGame[]>(); const tg = new Map<string, Map<string, TeamGame>>();
  for (const r of rows) {
    if (!byPid.has(r.pid)) byPid.set(r.pid, []);
    byPid.get(r.pid)!.push({ key: r.key, date: r.date, tip: r.tip, team: r.team, pre: r.pre, min: r.min, fp: r.fp, played: r.played });
    if (!tg.has(r.team)) tg.set(r.team, new Map());
    if (!tg.get(r.team)!.has(r.key)) tg.get(r.team)!.set(r.key, { key: r.key, date: r.date, tip: r.tip, pre: r.pre });
  }
  for (const gs of byPid.values()) gs.sort((a, b) => a.tip - b.tip);
  const teamGames = new Map([...tg.entries()].map(([t, m]) => [t, [...m.values()].sort((a, b) => a.tip - b.tip)]));
  return { byPid, teamGames, rows: rows.length };
}

// Parameters. Fixed before the 2025-26 validation (REPORT "Opportunity alerts", pre-registration); the shrinkage
// constants were chosen on 2024-25 only.
export const OPP = {
  rotationMpg: 20,       // a "rotation player" averages >= 20 min over his last 5 played games
  baseN: 5,              // a teammate's baseline = his mean minutes (DNP = 0) over the last 5 team games the absent player played
  woMax: 20,             // with/without history: at most the last 20 games on each side
  prevWeight: 0.5,       // a last-season game counts half (with/without and fp/min)
  // expected minutes gain = bPrior x prior + bTrend x (last 3 - baseline) + bWo x n/(n + kWo) x with/without delta
  // (+ depthMin if next on Sleeper's depth chart); least squares on 2024-25 absences (research/o_tune2.py)
  bPrior: 0.87, bTrend: 0.5, bWo: 0.2, kWo: 8, depthMin: 1.5,
  // prior = share x the absent player's mpg; share by the teammate's baseline minutes (rows: 0-3, 3-8, 8-14, 14-20,
  // 20-26, 26-32, 32+) and position overlap (columns: 1, 0.6, 0.3, 0.1); mean realized shares in 2024-25
  priorBase: [0, 3, 8, 14, 20, 26, 32],
  priorShare: [[0.121, 0.087, 0.097, 0.062], [0.228, 0.2, 0.169, 0.133], [0.182, 0.059, 0.13, 0.088], [0.051, 0.049, -0.009, -0.021],
    [0.02, -0.071, -0.038, -0.082], [-0.076, -0.082, -0.098, -0.123], [-0.123, -0.122, -0.182, -0.165]],
  rateK: 120,            // pseudo-minutes of the league rate in a player's fp/min (30-240 tie on 2024-25; lowest MAE)
  rateN: 15,             // this season's last 15 played games for fp/min (+ last season at prevWeight, at most 600 min)
  maxMin: 38,            // nobody is expected above 38 min
  // surge watch: expected minutes over the next games = sA x last-3 mpg + sB x last-10 mpg + sC x Sleeper's projected
  // minutes + sD x (Sleeper has a projection) + s0 (DNP = 0; least squares over every 2024-25 free-agent evaluation,
  // research/o_tune3.py: recent minutes regress a lot)
  sA: 0.479, sB: 0.254, sC: 0.075, sD: 0.499, s0: 1.768,
  surgeMin: 6,           // last-3 mean minutes >= Sleeper's projected minutes + 6, all 3 games played
  surgeFp: 15,           // and the minutes-based estimate >= 15 fp/g (league scoring)
  surgeEdge: 5,          // and >= Sleeper's projected fp + 5
  // alerts (replacement candidates)
  alertGainMin: 4,       // expected +4 min or more
  alertFp: 15,           // and an estimate >= 15 fp/g (free agents); rostered players of mine: estimate >= projection + 5
  topK: 3,
};
export type OppParams = typeof OPP;

const G = new Set(["PG", "SG", "G"]), F = new Set(["SF", "PF", "F"]);
const group = (p: string) => (G.has(p) ? 0 : F.has(p) ? 1 : p === "C" ? 2 : -1);
// position overlap of a teammate with the absent player: shared fantasy position 1, same group (G / F) 0.6,
// adjacent groups (G-F, F-C) 0.3, guard vs center 0.1
export function posOverlap(a: string[], b: string[]): number {
  if (!a?.length || !b?.length) return 0.3;
  if (a.some((x) => b.includes(x))) return 1;
  let best = 0.1;
  for (const x of a) for (const y of b) {
    const gx = group(x), gy = group(y); if (gx < 0 || gy < 0) continue;
    best = Math.max(best, gx === gy ? 0.6 : Math.abs(gx - gy) === 1 ? 0.3 : 0.1);
  }
  return best;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

// games before T (regular season preferred: preseason only when fewer than `need` regular games exist)
function before(gs: PGame[] | undefined, T: number, need = 3): PGame[] {
  const h = (gs || []).filter((g) => g.tip < T);
  const reg = h.filter((g) => !g.pre);
  return reg.length >= need ? reg : h;
}
export function teamAt(h: Hist, pid: string, T: number): string | null {
  const gs = (h.byPid.get(pid) || []).filter((g) => g.tip < T); return gs.length ? gs[gs.length - 1].team : null;
}
// minutes per game over his last n played games (rotation status)
export function playedMpg(h: Hist, pid: string, T: number, n = 5): number {
  const p = before(h.byPid.get(pid), T).filter((g) => g.played).slice(-n); return mean(p.map((g) => g.min));
}
// league fp per minute before T (prior of every player's rate); memoized per history
const rateMemo = new WeakMap<Hist, { T: number; v: number }[]>();
export function leagueRate(h: Hist, T: number): number {
  const m = rateMemo.get(h) || []; const day = Math.floor(T / 86400e3);
  const hit = m.find((x) => Math.floor(x.T / 86400e3) === day); if (hit) return hit.v;
  let fp = 0, mi = 0;
  for (const gs of h.byPid.values()) for (const g of gs) if (g.tip < T && g.played && g.min > 0) { fp += g.fp; mi += g.min; }
  const v = mi > 500 ? fp / mi : 0.95; m.push({ T, v }); rateMemo.set(h, m.slice(-8)); return v;
}
// shrunk fantasy points per minute: last rateN played games this season + last season (weight prevWeight, <= 600 min),
// shrunk toward the league rate with rateK pseudo-minutes
export function perMinRate(h: Hist, pid: string, T: number, prev?: Hist | null, p: OppParams = OPP): { rate: number; min: number; games: number } {
  const cur = before(h.byPid.get(pid), T).filter((g) => g.played && g.min > 0).slice(-p.rateN);
  let fp = cur.reduce((a, g) => a + g.fp, 0), mi = cur.reduce((a, g) => a + g.min, 0);
  if (prev) {
    const pg = (prev.byPid.get(pid) || []).filter((g) => g.played && g.min > 0 && !g.pre);
    const pm = pg.reduce((a, g) => a + g.min, 0), pf = pg.reduce((a, g) => a + g.fp, 0);
    if (pm > 0) { const s = Math.min(1, 600 / pm) * p.prevWeight; fp += s * pf; mi += s * pm; }
  }
  const L = leagueRate(h, T);
  return { rate: (fp + p.rateK * L) / (mi + p.rateK), min: mi, games: cur.length };
}

export interface Candidate {
  pid: string; base: number; last3: number; gain: number; expMin: number; rate: number; est: number; estGain: number;
  wo: { n: number; nPrev: number; delta: number | null }; prior: number; overlap: number; depthBoost: number; why: string;
}
export interface Absence { pid: string; team: string; mpg: number; missedBefore: number; candidates: Candidate[] }
export interface Meta { positions: Record<string, string[] | null | undefined>; depth?: Record<string, { pos: string | null; order: number | null } | undefined>; names?: Record<string, string> }

// the team games of `team` before T and, per game, whether `pid` played / was missing while on the team
export function onTeamGames(h: Hist, pid: string, team: string, T: number) {
  const all = h.byPid.get(pid) || [];
  const mine = all.filter((g) => g.team === team && g.tip < T);
  if (!mine.length) return [] as { key: string; tip: number; pre: boolean; played: boolean }[];
  const first = mine[0].tip, last = mine[mine.length - 1].tip;
  const moved = all.find((g) => g.tip > last && g.team !== team)?.tip ?? Infinity;
  const byKey = new Map(mine.map((g) => [g.key, g]));
  // on the team = every team game from his first game for the team until he shows up elsewhere (no row = missed)
  return (h.teamGames.get(team) || []).filter((g) => g.tip < T && g.tip >= first && g.tip < moved)
    .map((g) => ({ key: g.key, tip: g.tip, pre: g.pre, played: !!byKey.get(g.key)?.played }));
}

// with/without minutes of teammate `pid` around `absent` in one history (regular season only)
function withWithout(h: Hist, absent: string, pid: string, team: string, T: number, p: OppParams) {
  const a = onTeamGames(h, absent, team, T).filter((g) => !g.pre);
  const mine = new Map((h.byPid.get(pid) || []).filter((g) => g.team === team && g.tip < T).map((g) => [g.key, g]));
  const w: number[] = [], wo: number[] = [];
  for (const g of a) { const m = mine.get(g.key); if (!m) continue; (g.played ? w : wo).push(m.min); }
  return { w: w.slice(-p.woMax), wo: wo.slice(-p.woMax) };
}

// Rank the teammates of `absent` (out from T on) by the minutes they are expected to absorb.
// the games a teammate's baseline is measured on: the last baseN team games the absent player played (else the team's
// last baseN games)
export function baseKeys(h: Hist, absent: string, team: string, T: number, p: OppParams = OPP): string[] {
  const aGames = onTeamGames(h, absent, team, T);
  const reg = aGames.filter((g) => !g.pre); const ag = reg.length >= 3 ? reg : aGames;
  const withKeys = ag.filter((g) => g.played).slice(-p.baseN).map((g) => g.key);
  return withKeys.length >= 2 ? withKeys : (h.teamGames.get(team) || []).filter((g) => g.tip < T).slice(-p.baseN).map((g) => g.key);
}

export function replacementCandidates(h: Hist, absent: string, T: number, meta: Meta, prev?: Hist | null, p: OppParams = OPP): Absence | null {
  const team = teamAt(h, absent, T); if (!team) return null;
  const aGames = onTeamGames(h, absent, team, T);
  const reg = aGames.filter((g) => !g.pre); const ag = reg.length >= 3 ? reg : aGames;
  let missedBefore = 0; for (let i = ag.length - 1; i >= 0 && !ag[i].played; i--) missedBefore++;
  const mpg = playedMpg(h, absent, T);
  const baseKs = baseKeys(h, absent, team, T, p);
  const tgs = (h.teamGames.get(team) || []).filter((g) => g.tip < T);
  const recentTeam = tgs.slice(-3).map((g) => g.key);
  // teammates: their latest row before T is with this team, within the team's last 3 games
  const mates: string[] = [];
  for (const [pid, gs] of h.byPid) {
    if (pid === absent) continue;
    const b = gs.filter((g) => g.tip < T); if (!b.length) continue;
    const l = b[b.length - 1]; if (l.team === team && recentTeam.includes(l.key)) mates.push(pid);
  }
  const posA = meta.positions[absent] || [];
  const dA = meta.depth?.[absent];
  const rows = mates.map((pid) => {
    const gs = (h.byPid.get(pid) || []).filter((g) => g.team === team && g.tip < T);
    const byKey = new Map(gs.map((g) => [g.key, g]));
    const baseG = baseKs.map((k) => byKey.get(k)).filter(Boolean) as PGame[];
    const base = baseG.length ? mean(baseG.map((g) => g.min)) : 0;
    const last3 = mean(tgs.slice(-3).map((g) => byKey.get(g.key)?.min ?? 0));
    const cur = withWithout(h, absent, pid, team, T, p);
    const pv = prev ? withWithout(prev, absent, pid, team, Infinity, p) : { w: [], wo: [] };
    const nCur = cur.wo.length && cur.w.length ? cur.wo.length : 0, nPrev = pv.wo.length && pv.w.length ? pv.wo.length : 0;
    const nEff = nCur + p.prevWeight * nPrev;
    const delta = nEff > 0 ? (nCur * (mean(cur.wo) - mean(cur.w)) + p.prevWeight * nPrev * (mean(pv.wo) - mean(pv.w))) / nEff : null;
    const overlap = posOverlap(meta.positions[pid] || [], posA);
    const d = meta.depth?.[pid];
    // Sleeper's depth chart (current only: no history, so not validated): next behind him at his depth position
    const depthBoost = dA?.pos && d?.pos === dA.pos && d.order != null && dA.order != null && d.order === dA.order + 1 ? 1 : 0;
    return { pid, base, last3, nCur, nPrev, nEff, delta, overlap, depthBoost };
  });
  const col = (ov: number) => (ov >= 1 ? 0 : ov >= 0.6 ? 1 : ov >= 0.3 ? 2 : 3);
  const row = (b: number) => { let i = 0; while (i + 1 < p.priorBase.length && b >= p.priorBase[i + 1]) i++; return i; };
  const cands: Candidate[] = rows.map((r) => {
    const prior = p.priorShare[row(r.base)][col(r.overlap)] * mpg;
    const woTerm = r.delta === null ? 0 : (r.nEff / (r.nEff + p.kWo)) * r.delta;
    const gain = p.bPrior * prior + p.bTrend * (r.last3 - r.base) + p.bWo * woTerm + p.depthMin * r.depthBoost;
    const expMin = Math.min(p.maxMin, Math.max(0, r.base + gain));
    const rt = perMinRate(h, r.pid, T, prev, p);
    const why = [
      r.delta !== null ? `${r.delta >= 0 ? "+" : ""}${r1(r.delta)} min in ${r.nCur + r.nPrev} games he missed${r.nPrev ? ` (${r.nPrev} last season)` : ""}` : "no games without him yet",
      r.overlap >= 1 ? "same position" : r.overlap >= 0.6 ? "similar position" : null,
      r.depthBoost > 0 ? "next on Sleeper's depth chart" : null,
      `${r1(r.base)} min with him, ${r1(r.last3)} last 3`,
    ].filter(Boolean).join("; ");
    return { pid: r.pid, base: r1(r.base), last3: r1(r.last3), gain: r1(gain), expMin: r1(expMin), rate: Math.round(rt.rate * 1000) / 1000, est: r1(rt.rate * expMin), estGain: r1(rt.rate * (expMin - r.base)),
      wo: { n: r.nCur, nPrev: r.nPrev, delta: r.delta === null ? null : r1(r.delta) }, prior: r1(prior), overlap: r.overlap, depthBoost: r.depthBoost, why };
  }).sort((a, b) => b.gain - a.gain || b.est - a.est);
  return { pid: absent, team, mpg: r1(mpg), missedBefore, candidates: cands };
}

export interface Surge { pid: string; team: string | null; last3: number; last10: number; played3: number; projMin: number; projFp: number; expMin: number; rate: number; est: number; flagged: boolean; why: string; nGames: number; preseason: boolean }
// Minutes surge: last-3 team games' minutes vs Sleeper's projected minutes / fp for his next game (null = no projection =
// Sleeper shows 0). Expected minutes: the fitted regression in OPP (sA..s0).
export function surge(h: Hist, pid: string, T: number, sleeperNext: { min: number | null; fp: number | null }, prev?: Hist | null, p: OppParams = OPP): Surge | null {
  const team = teamAt(h, pid, T); if (!team) return null;
  const gs = h.byPid.get(pid) || [];
  const tAll = (h.teamGames.get(team) || []).filter((g) => g.tip < T); const tReg = tAll.filter((g) => !g.pre);
  const tg = tReg.length >= 3 ? tReg : tAll;
  const mineByKey = new Map(gs.map((g) => [g.key, g]));
  const last = (n: number) => tg.slice(-n).map((g) => mineByKey.get(g.key));
  const l3 = last(3), l10 = last(10);
  if (l3.length < 3) return null;
  const last3 = mean(l3.map((g) => g?.min ?? 0)), last10 = mean(l10.map((g) => g?.min ?? 0));
  const played3 = l3.filter((g) => g?.played).length;
  const projMin = sleeperNext.min ?? 0, projFp = sleeperNext.fp ?? 0;
  const expMin = Math.min(p.maxMin, Math.max(0, p.sA * last3 + p.sB * last10 + p.sC * projMin + (sleeperNext.min !== null ? p.sD : 0) + p.s0));
  const rt = perMinRate(h, pid, T, prev, p);
  const est = rt.rate * expMin;
  const flagged = played3 === 3 && last3 >= projMin + p.surgeMin && est >= p.surgeFp && est >= projFp + p.surgeEdge;
  const pre = l3.some((g) => g?.pre);
  const why = `${r1(last3)} mpg last 3${pre ? " (incl. preseason)" : ""} vs Sleeper ${r1(projMin)} min / ${r1(projFp)} fp; ${r1(rt.rate * 36)} fp/36 (shrunk) -> ~${r1(est)} fp/g`;
  return { pid, team, last3: r1(last3), last10: r1(last10), played3, projMin: r1(projMin), projFp: r1(projFp), expMin: r1(expMin), rate: Math.round(rt.rate * 1000) / 1000, est: r1(est), flagged, why, nGames: rt.games, preseason: pre };
}

// ---------- overrides (minutes-based projection for flagged players only) ----------
export interface Override { pid: string; perGame: number; expMin: number; rate: number; n: number; source: "replacement" | "surge"; label: string; because?: string }
export function overrideLabel(n: number, expMin: number, rate: number, because?: string) {
  return `projection override: based on last ${n} games (${r1(expMin)} min x ${r1(rate * 36)} fp/36${because ? `, ${because}` : ""})`;
}
// Which players get an override: top-3 replacement candidates of an absence with an expected gain >= alertGainMin
// minutes, and every flagged surge. A replacement override wins over a surge one (more specific).
export function buildOverrides(absences: Absence[], surges: Surge[], names: Record<string, string> = {}, p: OppParams = OPP): Record<string, Override> {
  const out: Record<string, Override> = {};
  for (const s of surges) if (s.flagged) out[s.pid] = { pid: s.pid, perGame: s.est, expMin: s.expMin, rate: s.rate, n: 3, source: "surge", label: overrideLabel(3, s.expMin, s.rate, "minutes surge") };
  for (const a of absences) for (const c of a.candidates.slice(0, p.topK)) {
    if (c.gain < p.alertGainMin) continue;
    const prevO = out[c.pid];
    if (prevO?.source === "replacement" && prevO.perGame >= c.est) continue;
    const because = `${names[a.pid] || a.pid} out`;
    out[c.pid] = { pid: c.pid, perGame: c.est, expMin: c.expMin, rate: c.rate, n: OPP.baseN, source: "replacement", label: overrideLabel(OPP.baseN, c.expMin, c.rate, because), because };
  }
  return out;
}

// ---------- alerts ----------
export interface OppAlert { key: string; title: string; body: string; pid: string; kind: "fa" | "mine" | "surge" }
export interface AlertCtx { names: Record<string, string>; teams: Record<string, string | null>; freeAgents: Set<string>; mine: Set<string>; nextTip: (pid: string) => number | null; sleeperProj: (pid: string) => number | null; fmtTime: (ms: number) => string }
// "Opportunity: <player> (<team>) - <starter> out, 24 mpg last 3, ~X fp/g est, free agent in your league - add before <next tip>"
export function opportunityAlerts(absences: (Absence & { since?: number })[], surges: Surge[], c: AlertCtx, p: OppParams = OPP): OppAlert[] {
  const out: OppAlert[] = []; const seen = new Set<string>();
  const nm = (pid: string) => c.names[pid] || pid;
  for (const a of absences) {
    for (const [i, cd] of a.candidates.slice(0, p.topK).entries()) {
      if (cd.gain < p.alertGainMin) continue;
      const fa = c.freeAgents.has(cd.pid), mine = c.mine.has(cd.pid); if (!fa && !mine) continue;
      const proj = c.sleeperProj(cd.pid);
      if (fa && cd.est < p.alertFp) continue;
      if (mine && !(cd.est >= (proj ?? 0) + p.surgeEdge)) continue;
      const tip = c.nextTip(cd.pid);
      const head = `${nm(cd.pid)} (${c.teams[cd.pid] ?? a.team}) - ${nm(a.pid)} out, ${cd.last3} mpg last 3, ~${cd.est} fp/g est`;
      const title = fa ? `🚀 Opportunity: ${head}, free agent in your league${tip ? ` - add before ${c.fmtTime(tip)}` : ""}`
        : `📈 Role up: ${head} (yours) - start him${tip ? ` (next tip ${c.fmtTime(tip)})` : ""}`;
      const body = `Why: #${i + 1} to absorb ${nm(a.pid)}'s ${a.mpg} mpg: expected ${cd.expMin} min (+${cd.gain}); ${cd.why}. Sleeper projects ${proj === null ? "nothing (0)" : `${proj} fp`}.`;
      out.push({ key: `opp|${cd.pid}|${a.pid}|${a.since ?? ""}`, title, body, pid: cd.pid, kind: fa ? "fa" : "mine" }); seen.add(cd.pid);
    }
  }
  for (const s of surges) {
    if (!s.flagged || seen.has(s.pid)) continue;
    const fa = c.freeAgents.has(s.pid), mine = c.mine.has(s.pid); if (!fa && !mine) continue;
    const tip = c.nextTip(s.pid);
    const title = fa ? `🚀 Opportunity: ${nm(s.pid)} (${s.team}) - minutes surge, ${s.last3} mpg last 3, ~${s.est} fp/g est, free agent in your league${tip ? ` - add before ${c.fmtTime(tip)}` : ""}`
      : `📈 Role up: ${nm(s.pid)} (${s.team}, yours) - ${s.last3} mpg last 3, ~${s.est} fp/g est - start him`;
    out.push({ key: `surge|${s.pid}|${Math.floor(s.last3 / 4)}`, title, body: `Why: ${s.why}.`, pid: s.pid, kind: fa ? "surge" : "mine" });
  }
  return out;
}
// dedupe against the notifier's sent-log (key -> time sent)
export function newAlerts(alerts: OppAlert[], sent: Record<string, number>): OppAlert[] {
  const s = new Set<string>(); return alerts.filter((a) => !sent[a.key] && !s.has(a.key) && (s.add(a.key), true));
}
