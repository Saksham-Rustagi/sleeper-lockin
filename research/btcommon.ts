// Shared season-replay helpers (walk-forward model fit, team-week construction) for backtests & lock-rule learning.
import fs from "fs";
import * as E from "./engine";
export const S = JSON.parse(fs.readFileSync(process.env.SEASON || (fs.existsSync("research/data/season.json") ? "research/data/season.json" : "/root/sleeper/research/season.json"), "utf8"));
// ---------- all games sorted, for walk-forward features ----------
type G = { pid: string; tip: number; actual: number; played: boolean; proj_sleeper: number | null; week: number };
export const all: G[] = [];
for (const [w, gs] of Object.entries<any[]>(S.games)) for (const g of gs) all.push({ ...g, week: Number(w) });
all.sort((a, b) => a.tip - b.tip);
export const byPid = new Map<string, G[]>();
for (const g of all) { if (!byPid.has(g.pid)) byPid.set(g.pid, []); byPid.get(g.pid)!.push(g); }

// Walk-forward per-game context: player's recent form (mean of last <=10 played games before this tip) and his
// past (actual, proj) pairs, used by the FORM / VOL model variants.
const formAt = new Map<string, { form: number | null; hist: { proj: number; actual: number }[] }>();
for (const [pid, gs] of byPid) {
  const last: number[] = []; const hist: { proj: number; actual: number }[] = [];
  for (const g of gs) {
    formAt.set(pid + "|" + g.tip, { form: last.length >= 3 ? last.reduce((a, b) => a + b, 0) / last.length : null, hist: hist.slice() });
    if (g.played) { last.push(g.actual); if (last.length > 10) last.shift(); hist.push({ proj: projPre(g), actual: g.actual }); }
  }
}
export function projPre(g: G): number {
  if (g.proj_sleeper != null) return g.proj_sleeper;
  const hist = byPid.get(g.pid)!; let lastProj: number | null = null; const acts: number[] = [];
  for (const h of hist) { if (h.tip >= g.tip) break; if (h.proj_sleeper != null) lastProj = h.proj_sleeper; if (h.played) acts.push(h.actual); }
  if (lastProj != null) return lastProj;
  if (acts.length) return acts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, acts.length);
  return 12;
}

export interface Model { a: number; b: number; c: number; d: number; f: number; dnp: E.DnpModel; resid?: E.ResidualShape }
const FORM = !!process.env.FORM, VOL = !!process.env.VOL;
export function muOf(m: Model, pid: string, tip: number, pr: number) {
  const fa = FORM ? formAt.get(pid + "|" + tip)?.form : null;
  return m.a + m.b * pr + (fa != null ? m.f * (fa - pr) : 0);
}
export function sdOf(m: Model, pid: string, tip: number, mu: number) {
  const base = m.c + m.d * mu;
  if (!VOL) return Math.sqrt(Math.max(9, base));
  const h = formAt.get(pid + "|" + tip)?.hist || []; const k = 15; // shrink the player's own residual variance toward the league curve
  let ss = 0; for (const x of h) { const r = x.actual - (m.a + m.b * x.proj); ss += r * r; }
  const v = (ss + k * base) / (h.length + k);
  return Math.sqrt(Math.max(9, v));
}
export function fitModel(week: number): Model {
  const train = all.filter((g) => g.week < week);
  if (train.length < 300) return { a: -1.5, b: 0.95, c: 40, d: 2.5, f: 0, dnp: { p1: 0.93, p0: 0.4 } };
  const xy = train.filter((g) => g.played).map((g) => [projPre(g), g.actual]);
  const n = xy.length; const mx = xy.reduce((s, v) => s + v[0], 0) / n; const my = xy.reduce((s, v) => s + v[1], 0) / n;
  let sxy = 0, sxx = 0; for (const [x, y] of xy) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  // form coefficient: regress the residual on (recent form - projection), walk-forward
  let f = 0;
  if (FORM) { let sxf = 0, sff = 0; for (const g of train) { if (!g.played) continue; const fa = formAt.get(g.pid + "|" + g.tip)?.form; if (fa == null) continue; const pr = projPre(g); const z = fa - pr; sxf += z * (g.actual - a - b * pr); sff += z * z; } f = sff ? sxf / sff : 0; }
  // variance model: r^2 = c + d*mu
  const rr = xy.map(([x, y]) => { const mu = a + b * x; return [mu, (y - mu) ** 2]; });
  const m2 = rr.reduce((s, v) => s + v[0], 0) / n, r2 = rr.reduce((s, v) => s + v[1], 0) / n;
  let s2 = 0, q2 = 0; for (const [mu, e] of rr) { s2 += (mu - m2) * (e - r2); q2 += (mu - m2) ** 2; }
  const d = Math.max(0, s2 / q2), c = Math.max(10, r2 - d * m2);
  // DNP chain
  let pp = 0, pn = 0, mp = 0, mn = 0;
  for (const [, gs] of byPid) { let prev: boolean | null = null; for (const g of gs) { if (g.week >= week) break; if (prev !== null) { if (prev) { pn++; if (g.played) pp++; } else { mn++; if (g.played) mp++; } } prev = g.played; } }
  const z = xy.map(([x, y]) => { const mu = a + b * x; return (y - mu) / Math.sqrt(Math.max(9, c + d * mu)); });
  return { a, b, c, d, f, dnp: { p1: pn ? pp / pn : 0.93, p0: mn ? mp / mn : 0.4 }, resid: process.env.RESID ? E.makeResidualShape(z) : undefined };
}

export function teamWeek(week: number, rid: string, model: Model): { tw: E.TeamWeek; real: { actual: Float64Array; played: Uint8Array } } {
  const team = S.weeks.find((x: any) => x.week === week).teams[rid];
  const pids: string[] = team.players;
  const pidx = new Map(pids.map((p, i) => [p, i]));
  const wg = (S.games[String(week)] as any[]).filter((g) => pidx.has(g.pid)).sort((a, b) => a.tip - b.tip);
  const games: E.Game[] = wg.map((g) => {
    const pr = projPre({ ...g, week });
    const mu = muOf(model, g.pid, g.tip, pr); const sd = sdOf(model, g.pid, g.tip, mu);
    return { p: pidx.get(g.pid)!, tip: g.tip, end: g.tip + 2.5 * 3600e3, mu, sd, projRaw: pr, actual: g.actual, played: g.played };
  });
  const byPlayer: number[][] = pids.map(() => []);
  games.forEach((g, i) => byPlayer[g.p].push(i));
  const lastPlayed0 = pids.map((p) => { const h = (byPid.get(p) || []).filter((g) => g.week < week); return h.length ? (h[h.length - 1].played ? 1 : 0) : 1; });
  const slotNames: string[] = S.slots;
  const tw: E.TeamWeek = {
    slots: slotNames.map((s) => E.SLOT_MASK[s]), slotNames, pmask: pids.map((p) => E.posMask(S.players[p]?.pos || ["UTIL"])),
    names: pids.map((p) => S.players[p]?.name || p), games, byPlayer, lastPlayed0, dnp: model.dnp, resid: model.resid,
  };
  return { tw, real: { actual: Float64Array.from(games.map((g) => g.actual)), played: Uint8Array.from(games.map((g) => (g.played ? 1 : 0))) } };
}

