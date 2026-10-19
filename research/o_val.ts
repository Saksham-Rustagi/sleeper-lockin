// Task O validation (research/REPORT.md "Opportunity alerts"): runs lib/live/opportunity.ts on past seasons, walk-forward.
//   absences <2025|2024> <out.json>   every multi-game absence of a rotation player: the detector's ranking of his
//                                     teammates at the absence's first missed game (data before it only) + what happened
//   surges <2025> <out.json>          every free agent of our league flagged by the minutes-surge watch (first flag in 7
//                                     days) + his next 5 team games
// env P = JSON overrides of OPP (tuning), PREV=0 disables last season's with/without data, NOPRE=1 drops preseason
import fs from "fs";
import { OPP, onTeamGames, replacementCandidates, surge, baseKeys, playedMpg, buildOverrides, type OppParams, type Hist } from "../lib/live/opportunity";
import { loadSeason, type SeasonData } from "./o_common";

const [mode, year, outFile] = process.argv.slice(2);
const P: OppParams = { ...OPP, ...(process.env.P ? JSON.parse(process.env.P) : {}) };
const D = loadSeason(year as "2025" | "2024", !process.env.NOPRE);
const PREV: Hist | null = year === "2025" && process.env.PREV !== "0" ? loadSeason("2024", false).hist : null;
const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const inSeason = (d: string) => { const w = D.weekOfDate(d); return w !== null && w >= 1 && w <= 23; };

// multi-game absences: >= 2 consecutive missed regular-season team games, played the game before, >= 20 mpg over his last
// 5 played games, >= 5 played games before
function absences(S: SeasonData) {
  const h = S.hist; const out: { pid: string; team: string; start: number; date: string; games: { key: string; tip: number; date: string }[]; len: number }[] = [];
  for (const [pid, gs] of h.byPid) {
    for (const team of new Set(gs.filter((g) => !g.pre).map((g) => g.team))) {
      const tg = onTeamGames(h, pid, team, Infinity).filter((g) => !g.pre);
      for (let i = 1; i < tg.length; i++) {
        if (tg[i].played || !tg[i - 1].played) continue;
        let j = i; while (j < tg.length && !tg[j].played) j++;
        const len = j - i; if (len < 2) continue;
        const T = tg[i].tip;
        if (tg.slice(0, i).filter((g) => g.played).length < 5 || playedMpg(h, pid, T) < P.rotationMpg) continue;
        const games = tg.slice(i, j).map((g) => ({ key: g.key, tip: g.tip, date: (h.teamGames.get(team) || []).find((x) => x.key === g.key)!.date }));
        if (!inSeason(games[0].date)) continue;
        out.push({ pid, team, start: T, date: games[0].date, games, len });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Sleeper's view at T without look-ahead (see surges below): the projection of his last played game before T
function sleeperView(pid: string, T: number) {
  const lp = (D.hist.byPid.get(pid) || []).filter((g) => g.tip < T && g.played && !g.pre).slice(-1)[0];
  return { min: lp ? D.projMin.get(`${pid}|${lp.date}`) ?? null : null, fp: lp ? D.projFp.get(`${pid}|${lp.date}`) ?? null : null };
}

if (mode === "alerts") {
  // the alerts our league would have had at each week start (decision time of the task-W waiver backtest = 1 h before
  // the week's first tip), and the minutes-based overrides of every flagged player (rostered or not) for that week.
  // An absence counts as known at T when the player's absence run covers his team's first game after T (proxy for an Out
  // tag: the data has no injury history).
  const h = D.hist; const A = D.A; const abs = absences(D); const weeks: any[] = [];
  for (let w = 1; w <= 22; w++) {
    const wg: any[] = A.games[String(w)]; const T = Math.min(...wg.map((g) => g.tip)) - 3600e3;
    const rostered = new Set<string>(A.rostered[String(w)]["0"]);
    const open: any[] = [];
    for (const a of abs) {
      const firstAfter = (h.teamGames.get(a.team) || []).find((g) => g.tip >= T && !g.pre); if (!firstAfter) continue;
      if (a.start > firstAfter.tip || !a.games.some((g) => g.key === firstAfter.key)) continue;
      const res = replacementCandidates(h, a.pid, T, { positions: D.positions }, PREV, P); if (!res || res.team !== a.team) continue;
      open.push({ ...res, since: a.start, candidates: res.candidates.slice(0, 8) });
    }
    const surges: any[] = [];
    const teamsPlaying = new Set(wg.map((g: any) => g.team));
    for (const [pid, gs] of h.byPid) {
      const pr = gs.filter((g) => g.tip < T); if (!pr.length || !teamsPlaying.has(pr[pr.length - 1].team)) continue;
      const s = surge(h, pid, T, sleeperView(pid, T), PREV, P); if (s?.flagged) surges.push(s);
    }
    // pre-registered: every flagged player; ONLYRAISE=1 (exploratory, the live default): only above Sleeper's view at T
    const ov = buildOverrides(open, surges, D.names, P, process.env.ONLYRAISE ? (pid) => sleeperView(pid, T).fp : undefined);
    const alerts: any[] = [];
    for (const a of open) for (const c of a.candidates.slice(0, P.topK)) if (c.gain >= P.alertGainMin && c.est >= P.alertFp && !rostered.has(c.pid)) alerts.push({ pid: c.pid, est: c.est, source: "replacement", absent: a.pid, gain: c.gain, expMin: c.expMin });
    for (const s of surges) if (!rostered.has(s.pid) && !alerts.some((x) => x.pid === s.pid)) alerts.push({ pid: s.pid, est: s.est, source: "surge", expMin: s.expMin });
    alerts.sort((x, y) => y.est - x.est);
    weeks.push({ week: w, T, nAbsences: open.length, alerts, overrides: Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, Math.round(v.perGame * 100) / 100])), nSurges: surges.length });
    console.error(`w${w}: ${open.length} open absences, ${surges.length} surges, ${alerts.length} FA alerts${alerts[0] ? ` (top ${D.names[alerts[0].pid]} ${alerts[0].est})` : ""}, ${Object.keys(ov).length} overrides`);
  }
  fs.writeFileSync(outFile, JSON.stringify({ year, P, weeks }));
} else if (mode === "absences") {
  const h = D.hist; const abs = absences(D); const rows: any[] = []; const t0 = Date.now();
  for (const a of abs) {
    const T = a.start - 60e3;
    const res = replacementCandidates(h, a.pid, T, { positions: D.positions }, PREV, P); if (!res || res.team !== a.team) continue;
    const bk = baseKeys(h, a.pid, a.team, T, P);
    const win = a.games.slice(0, 5), lead = a.games.slice(0, 10);
    const cands = res.candidates.map((c, rank) => {
      const byKey = new Map((h.byPid.get(c.pid) || []).filter((g) => g.team === a.team).map((g) => [g.key, g]));
      const wg = win.map((g) => byKey.get(g.key)).filter(Boolean) as any[];
      const baseFp = mean(bk.map((k) => byKey.get(k)?.fp ?? 0));
      const projBase = mean(bk.map((k) => { const g = byKey.get(k); return g ? D.projFp.get(`${c.pid}|${g.date}`) : undefined; }).filter((x) => x !== undefined) as number[]);
      const projMinBase = mean(bk.map((k) => { const g = byKey.get(k); return g ? D.projMin.get(`${c.pid}|${g.date}`) : undefined; }).filter((x) => x !== undefined) as number[]);
      const seq = lead.map((g) => { const x = byKey.get(g.key); return x ? [g.date, D.projFp.get(`${c.pid}|${g.date}`) ?? null, D.projMin.has(`${c.pid}|${g.date}`) ? r2(D.projMin.get(`${c.pid}|${g.date}`)!) : null, x.played ? 1 : 0, r2(x.min), r2(x.fp)] : null; });
      return { pid: c.pid, rank, gain: c.gain, prior: c.prior, base: c.base, last3: c.last3, expMin: c.expMin, est: c.est, estGain: c.estGain, rate: c.rate, overlap: c.overlap, wo: c.wo,
        nWin: wg.length, realMin: wg.length ? r2(mean(wg.map((g) => g.min))) : null, realFp: wg.length ? r2(mean(wg.map((g) => g.fp))) : null, baseFp: r2(baseFp),
        projBase: Number.isNaN(projBase) ? null : r2(projBase), projMinBase: Number.isNaN(projMinBase) ? null : r2(projMinBase), seq };
    });
    rows.push({ pid: a.pid, name: D.names[a.pid], team: a.team, date: a.date, week: D.weekOfDate(a.date), len: a.len, mpg: res.mpg, missedBefore: res.missedBefore, cands });
  }
  fs.writeFileSync(outFile, JSON.stringify({ year, P, n: rows.length, ms: Date.now() - t0, rows }));
  console.error(`${rows.length} absences in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else if (mode === "surges" || mode === "surgefeat") {
  // surgefeat: every evaluation's features and next-5 outcome (fits the surge's expected-minutes model; tuning season)
  const feats: number[][] = [];
  const h = D.hist; const A = D.A; const rows: any[] = []; const last = new Map<string, number>(); const t0 = Date.now();
  const dates = [...new Set([...h.teamGames.values()].flat().filter((g) => !g.pre).map((g) => g.date))].filter(inSeason).sort();
  let evals = 0;
  for (const d of dates) {
    const w = D.weekOfDate(d)!; const rostered = new Set<string>(A.rostered[String(w)]["0"]);
    const today = [...h.teamGames.entries()].flatMap(([team, gs]) => gs.filter((g) => g.date === d).map((g) => ({ team, ...g })));
    const T = Math.min(...today.map((g) => g.tip)) - 3600e3;
    const teams = new Set(today.map((g) => g.team));
    for (const [pid, gs] of h.byPid) {
      if (rostered.has(pid)) continue;
      const prior = gs.filter((g) => g.tip < T); if (!prior.length || !teams.has(prior[prior.length - 1].team)) continue;
      // Sleeper's view at T without look-ahead: the stored projections lose the rows of games a player then sat out, so a
      // missing row for tonight's game leaks the outcome. Use the projection of his last PLAYED game before T instead
      // (no row for a game he played = Sleeper showed 0).
      const { min: pm, fp: pf } = sleeperView(pid, T);
      const s = surge(h, pid, T, { min: pm, fp: pf }, PREV, P); evals++;
      if (mode === "surgefeat" && s && s.last10 > 0) {
        const byKey = new Map(gs.filter((g) => g.team === s.team).map((g) => [g.key, g]));
        const nx = (h.teamGames.get(s.team!) || []).filter((g) => g.tip >= T && !g.pre).slice(0, 5).map((g) => byKey.get(g.key)).filter(Boolean) as any[];
        if (nx.length >= 3) feats.push([s.last3, s.last10, pm ?? 0, pm === null ? 0 : 1, pf ?? 0, s.rate, s.played3, r2(mean(nx.map((g) => g.min))), r2(mean(nx.map((g) => g.fp)))]);
        continue;
      }
      if (!s?.flagged) continue;
      if ((last.get(pid) ?? -Infinity) > T - 7 * 86400e3) continue; last.set(pid, T);
      const team = s.team!; const byKey = new Map(gs.filter((g) => g.team === team).map((g) => [g.key, g]));
      const next = (h.teamGames.get(team) || []).filter((g) => g.tip >= T && !g.pre).slice(0, 10);
      const seq = next.map((g) => { const x = byKey.get(g.key); return x ? [g.date, D.projFp.get(`${pid}|${g.date}`) ?? null, D.projMin.has(`${pid}|${g.date}`) ? r2(D.projMin.get(`${pid}|${g.date}`)!) : null, x.played ? 1 : 0, r2(x.min), r2(x.fp)] : null; });
      rows.push({ name: D.names[pid], date: d, week: w, ...s, seq });
    }
  }
  if (mode === "surgefeat") { fs.writeFileSync(outFile, JSON.stringify({ year, cols: ["last3", "last10", "projMin", "hasProj", "projFp", "rate", "played3", "nextMin", "nextFp"], feats })); process.exit(0); }
  fs.writeFileSync(outFile, JSON.stringify({ year, P, evals, n: rows.length, ms: Date.now() - t0, rows }));
  console.error(`${rows.length} surge flags (${evals} evaluations) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
