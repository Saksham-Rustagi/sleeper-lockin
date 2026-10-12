// Backtest: in-week streaming of free agents into dead roster spots (2025-26 season, all teams, walk-forward).
// usage: npx tsx research/stream_backtest.ts [churnable=3] [pool=25] [policy=P2|P3]
import fs from "fs";
import * as E from "./engine";

const ALL = JSON.parse(fs.readFileSync(process.env.SEASON_ALL || "/root/sleeper/research/season_all.json", "utf8"));
const S = JSON.parse(fs.readFileSync(process.env.SEASON || "/root/sleeper/research/season.json", "utf8"));
const CHURN = Number(process.argv[2] || 3), POOL = Number(process.argv[3] || 25), POLNAME = process.argv[4] || "P2";
const WEEKS = (process.env.WEEKS || "1-23").split("-").map(Number);
const P2: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true };

type G = { pid: string; tip: number; actual: number; played: boolean; proj_sleeper: number | null; week: number; date: string };
const all: G[] = [];
for (const [w, gs] of Object.entries<any[]>(ALL.games)) for (const g of gs) if (/^\d+$/.test(g.pid)) all.push({ ...g, week: Number(w) }); // real players only (drop TEAM_xxx rows)
all.sort((a, b) => a.tip - b.tip);
const byPid = new Map<string, G[]>(); for (const g of all) { if (!byPid.has(g.pid)) byPid.set(g.pid, []); byPid.get(g.pid)!.push(g); }
function projPre(g: G): number {
  if (g.proj_sleeper != null) return g.proj_sleeper;
  let last: number | null = null; const acts: number[] = [];
  for (const h of byPid.get(g.pid)!) { if (h.tip >= g.tip) break; if (h.proj_sleeper != null) last = h.proj_sleeper; if (h.played) acts.push(h.actual); }
  return last ?? (acts.length ? acts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, acts.length) : 10);
}
function fit(week: number) {
  const tr = all.filter((g) => g.week < week && g.played && g.proj_sleeper != null);
  if (tr.length < 300) return { a: -1.5, b: 0.95, c: 40, d: 2.5, p1: 0.93, p0: 0.4 };
  const xy = tr.map((g) => [g.proj_sleeper!, g.actual]); const n = xy.length;
  const mx = xy.reduce((s, v) => s + v[0], 0) / n, my = xy.reduce((s, v) => s + v[1], 0) / n;
  let sxy = 0, sxx = 0; for (const [x, y] of xy) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  const rr = xy.map(([x, y]) => [a + b * x, (y - a - b * x) ** 2]); const m2 = rr.reduce((s, v) => s + v[0], 0) / n, r2 = rr.reduce((s, v) => s + v[1], 0) / n;
  let s2 = 0, q2 = 0; for (const [mu, e] of rr) { s2 += (mu - m2) * (e - r2); q2 += (mu - m2) ** 2; }
  const d = Math.max(0, s2 / q2), c = Math.max(10, r2 - d * m2);
  let pp = 0, pn = 0, mp = 0, mn = 0;
  for (const [, gs] of byPid) { let prev: boolean | null = null; for (const g of gs) { if (g.week >= week) break; if (prev !== null) { if (prev) { pn++; if (g.played) pp++; } else { mn++; if (g.played) mp++; } } prev = g.played; } }
  return { a, b, c, d, p1: pn ? pp / pn : 0.93, p0: mn ? mp / mn : 0.4 };
}

const slotsNames: string[] = S.slots;
const results: any[] = []; const DIAG: any[] = [];
for (let week = WEEKS[0]; week <= (WEEKS[1] ?? WEEKS[0]); week++) {
  const W = S.weeks.find((x: any) => x.week === week); if (!W) continue;
  const m = fit(week);
  const weekGames = all.filter((g) => g.week === week);
  const rosteredAny = new Set<string>(ALL.rostered[week]);
  const meanProj = (pid: string) => { const gs = weekGames.filter((g) => g.pid === pid); return gs.length ? gs.reduce((s, g) => s + projPre(g), 0) / gs.length : 0; };
  const faPool = [...new Set(weekGames.map((g) => g.pid))].filter((p) => !rosteredAny.has(p)).map((p) => [p, meanProj(p)] as [string, number]).filter(([, v]) => v >= 10).sort((a, b) => b[1] - a[1]).slice(0, POOL).map(([p]) => p);
  for (const rid of Object.keys(W.teams)) {
    const roster: string[] = W.teams[rid].players;
    const pids = [...roster, ...faPool];
    const pidx = new Map(pids.map((p, i) => [p, i]));
    const gs = weekGames.filter((g) => pidx.has(g.pid)).sort((a, b) => a.tip - b.tip);
    const games: E.Game[] = gs.map((g) => { const pr = projPre(g); const mu = m.a + m.b * pr; return { p: pidx.get(g.pid)!, tip: g.tip, end: g.tip + 2.5 * 3600e3, mu, sd: Math.sqrt(Math.max(9, m.c + m.d * mu)), projRaw: pr, actual: g.actual, played: g.played }; });
    const byPlayer: number[][] = pids.map(() => []); games.forEach((g, i) => byPlayer[g.p].push(i));
    const lastPlayed0 = pids.map((p) => { const h = (byPid.get(p) || []).filter((g) => g.week < week); return h.length ? (h[h.length - 1].played ? 1 : 0) : 1; });
    const mk = (): E.TeamWeek => ({ slots: slotsNames.map((s) => E.SLOT_MASK[s]), slotNames: slotsNames, pmask: pids.map((p) => E.posMask(ALL.pos[p] || ["UTIL"])), names: pids, games, byPlayer, lastPlayed0, dnp: { p1: m.p1, p0: m.p0 },
      avail: Float64Array.from(pids.map((_, i) => (i < roster.length ? -Infinity : Infinity))), gone: new Float64Array(pids.length).fill(Infinity) });
    const actual = Float64Array.from(games.map((g) => g.actual)), played = Uint8Array.from(games.map((g) => (g.played ? 1 : 0)));
    const churn = roster.map((p) => [p, meanProj(p)] as [string, number]).sort((a, b) => a[1] - b[1]).slice(0, CHURN).map(([p]) => pidx.get(p)!);
    const days = [...new Set(gs.map((g) => g.date))].sort().map((d) => Math.min(...gs.filter((g) => g.date === d).map((g) => g.tip)) - 30 * 60e3);

    const runVariant = (variant: "none" | "A" | "B") => {
      const tw = mk(); const ev = E.buildEvents(tw, true); let st = E.initState(tw); let i = 0; let adds = 0; const log: string[] = [];
      for (const d of days) {
        const r = E.simulate(tw, P2, ev, actual, played, st, i, undefined, d); st = r.st; i = r.evIdx;
        if (variant === "none") continue;
        for (const p of churn) {
          if (!(tw.avail![p] <= d && d < tw.gone![p]) || !Number.isNaN(st.pendingX[p]) || st.inGame[p] >= 0) continue;
          const hasGames = tw.byPlayer[p].some((gi) => tw.games[gi].tip > d);
          const dead = (!st.isLocked[p] && !hasGames) || (variant === "B" && !!st.isLocked[p]);
          if (!dead) continue;
          // best free agent by marginal value for the open slots
          const usableNow = pids.map((_, q) => q).filter((q) => !st.isLocked[q] && (E.usable(tw, q, d) || !Number.isNaN(st.pendingX[q]) || st.inGame[q] >= 0) && q !== p);
          const w = new Float64Array(pids.length); for (const q of usableNow) w[q] = E.playerValue(tw, P2, st, q, d);
          const open = E.openMaskOf(st); const base = E.assignExact(tw.slots, open, usableNow, tw.pmask, w).total;
          let best = -1, gain = 0.3;
          for (let fa = roster.length; fa < pids.length; fa++) {
            if (tw.avail![fa] !== Infinity || !tw.byPlayer[fa].some((gi) => tw.games[gi].tip > d)) continue;
            w[fa] = E.futureValue(tw, P2, st, fa, d);
            const g2 = E.assignExact(tw.slots, open, [...usableNow, fa], tw.pmask, w).total - base;
            if (g2 > gain) { gain = g2; best = fa; }
          }
          DIAG.push({ d, dead: pids[p], gain: best >= 0 ? gain : 0, openSlots: E.openMaskOf(st).toString(2).split('').filter((c) => c === '1').length, usable: usableNow.length });
          if (best >= 0) { tw.avail![best] = d; tw.gone![p] = d; adds++; log.push(`${new Date(d).toISOString().slice(5, 16)} drop ${pids[p]}${st.isLocked[p] ? "(locked)" : ""} add ${pids[best]} (+${gain.toFixed(1)})`); }
        }
      }
      const fin = E.simulate(tw, P2, ev, actual, played, st, i);
      return { total: fin.total, adds, log };
    };
    const n = runVariant("none"), a = runVariant("A"), b = runVariant("B");
    const mid = days[Math.floor(days.length / 2)] ?? 0;
    const liveMid = roster.filter((pid) => gs.some((g) => g.pid === pid && g.tip > mid && g.played)).length;
    results.push({ week, rid, base: n.total, A: a.total, B: b.total, addsA: a.adds, addsB: b.adds, logB: b.log.slice(0, 4), liveMid });
  }
  process.stderr.write(`week ${week} done\n`);
}
const mean = (k: string) => results.reduce((s, r) => s + r[k], 0) / results.length;
const ci = (k: string) => { const d = results.map((r) => r[k] - r.base); const mu = d.reduce((s, v) => s + v, 0) / d.length; const sd = Math.sqrt(d.reduce((s, v) => s + (v - mu) ** 2, 0) / d.length); return `${mu >= 0 ? "+" : ""}${mu.toFixed(2)} ± ${(1.96 * sd / Math.sqrt(d.length)).toFixed(2)}`; };
console.log(`team-weeks ${results.length}, churnable ${CHURN}, FA pool ${POOL}`);
console.log(`no streaming:                 ${mean("base").toFixed(1)} pts/wk`);
console.log(`A: stream into finished spots ${mean("A").toFixed(1)}  (${ci("A")})  adds/wk ${mean("addsA").toFixed(2)}`);
console.log(`B: + drop locked churn guys   ${mean("B").toFixed(1)}  (${ci("B")})  adds/wk ${mean("addsB").toFixed(2)}`);
const thin = results.filter((r) => r.liveMid <= 10); if (thin.length) { const d = thin.map((r) => r.B - r.base); const mu = d.reduce((a, b) => a + b, 0) / d.length; const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / d.length); console.log(`thin rosters (<=10 players with games left mid-week, n=${thin.length}): B ${mu >= 0 ? '+' : ''}${mu.toFixed(2)} ± ${(1.96 * sd / Math.sqrt(d.length)).toFixed(2)}`); }
const ex = results.filter((r) => r.B - r.base > 5).slice(0, 3); for (const r of ex) console.log(`  e.g. w${r.week} r${r.rid}: +${(r.B - r.base).toFixed(1)}  ${r.logB.join("; ")}`);
console.log('dead-spot opportunities:', DIAG.length, ' gains>0.3:', DIAG.filter((x) => x.gain > 0.3).length, ' median open slots at the time:', DIAG.map((x) => x.openSlots).sort((a, b) => a - b)[Math.floor(DIAG.length / 2)], ' median usable players:', DIAG.map((x) => x.usable).sort((a, b) => a - b)[Math.floor(DIAG.length / 2)]);
fs.writeFileSync(process.env.OUT || "/root/sleeper-lockin/research/out/stream.json", JSON.stringify(results));
