// Task T3: calibration of the in-game final-score estimate (lib/live/ingame.ts) on live snapshots of one night's games
// (research/t3_snap.sh: ESPN scoreboard + Sleeper week stats every few minutes; finals from the last snapshot).
// Every player with a stats row (seconds played > 0) in a game in progress at a snapshot is one prediction of his final
// fantasy points (league scoring). Reported per game phase: bias, RMSE, z = (final - mu) / sd (sd of z ~ 1 if calibrated),
// share of finals inside the 80% interval, vs two baselines: the pre-game model (mu if he plays) and "points so far +
// pre-game rate x remaining minutes at the pre-game share" (no shrinkage of the rate), and over a grid of ING parameters.
//   node research/dist/t3_calib.cjs <snapDir> <proj.json> <scoring.json> <date> [out.json]
import fs from "fs";
import path from "path";
import { inGameEstimate, gameMinutes, ING } from "../lib/live/ingame";
import { gameDist, fantasyPoints } from "../lib/engine/model";

const [dir, projFile, scoringFile, date, outFile] = process.argv.slice(2);
const S: Record<string, number> = JSON.parse(fs.readFileSync(scoringFile, "utf8"));
const proj = new Map<string, any>((JSON.parse(fs.readFileSync(projFile, "utf8")) as any[]).filter((r) => r.date === date).map((r) => [r.player_id, r]));
const ESPN_FIX: Record<string, string> = { GS: "GSW", NY: "NYK", SA: "SAS", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const ts = fs.readdirSync(dir).filter((f) => /^sb_\d+\.json$/.test(f)).map((f) => Number(f.slice(3, -5))).sort((a, b) => a - b);
interface Snap { t: number; games: Map<string, { state: string; period: number; clock: number }>; stats: Map<string, any> }
const snaps: Snap[] = [];
for (const t of ts) {
  try {
    const sb = JSON.parse(fs.readFileSync(path.join(dir, `sb_${t}.json`), "utf8")); const st = JSON.parse(fs.readFileSync(path.join(dir, `st_${t}.json`), "utf8"));
    const games = new Map<string, { state: string; period: number; clock: number }>();
    for (const e of sb.events || []) for (const c of e.competitions[0].competitors) games.set(ESPN_FIX[c.team.abbreviation] ?? c.team.abbreviation, { state: e.status.type.state, period: e.status.period ?? 0, clock: e.status.clock ?? 0 });
    snaps.push({ t, games, stats: new Map((st as any[]).filter((r) => r.date === date).map((r) => [r.player_id, r])) });
  } catch { /* a partial snapshot */ }
}
// finals: the last snapshot in which the player's game is over
const final = new Map<string, number>();
for (const s of snaps) for (const [pid, r] of s.stats) if (s.games.get(r.team)?.state === "post") final.set(pid, fantasyPoints(r.stats, S));
interface Obs { pid: string; t: number; pts: number; sec: number; fouls: number; period: number; clock: number; preMu: number; preSd: number; projSec: number | null; final: number; elapsed: number }
const obs: Obs[] = [];
for (const s of snaps) for (const [pid, r] of s.stats) {
  const g = s.games.get(r.team); if (!g || g.state !== "in" || !g.period) continue;
  if (!((r.stats?.sp ?? 0) > 0) || !final.has(pid)) continue;
  const pr = proj.get(pid); if (!pr?.stats || !Object.keys(pr.stats).length) continue;
  const d = gameDist(fantasyPoints(pr.stats, S));
  obs.push({ pid, t: s.t, pts: fantasyPoints(r.stats, S), sec: r.stats.sp, fouls: r.stats.pf ?? 0, period: g.period, clock: g.clock, preMu: d.mu, preSd: d.sd, projSec: pr.stats.sp ?? null, final: final.get(pid)!, elapsed: gameMinutes(g.period, g.clock).elapsed });
}
const phase = (e: number) => (e < 12 ? "Q1" : e < 24 ? "Q2" : e < 36 ? "Q3" : "Q4+");
const Z80 = 1.2816;
function metrics(pred: (o: Obs) => { mu: number; sd: number }, sel: (o: Obs) => boolean = () => true) {
  const xs = obs.filter(sel); if (!xs.length) return null;
  let b = 0, se = 0, z1 = 0, z2 = 0, cov = 0;
  for (const o of xs) { const p = pred(o); const e = o.final - p.mu; b += e; se += e * e; const z = e / Math.max(p.sd, 0.5); z1 += z; z2 += z * z; if (Math.abs(e) <= Z80 * Math.max(p.sd, 0.5)) cov++; }
  const n = xs.length; return { n, bias: b / n, rmse: Math.sqrt(se / n), zsd: Math.sqrt(z2 / n - (z1 / n) ** 2), cov80: cov / n };
}
const fmt = (m: ReturnType<typeof metrics>) => (m ? `n ${String(m.n).padStart(4)}  bias ${m.bias.toFixed(2).padStart(6)}  rmse ${m.rmse.toFixed(2).padStart(6)}  sd(z) ${m.zsd.toFixed(2)}  80%-cover ${(m.cov80 * 100).toFixed(0)}%` : "-");
const est = (P: typeof ING) => (o: Obs) => inGameEstimate({ pts: o.pts, sec: o.sec, fouls: o.fouls, period: o.period, clock: o.clock, preMu: o.preMu, preSd: o.preSd, projSec: o.projSec }, P);
const preModel = (o: Obs) => ({ mu: o.preMu, sd: o.preSd });
// no shrinkage: points so far + pre-game rate x (pre-game share x remaining game minutes); sd as the estimate's
const naive = (o: Obs) => { const { elapsed, total } = gameMinutes(o.period, o.clock); const pm = o.projSec ? o.projSec / 60 : Math.min(40, Math.max(10, o.preMu / 0.9)); const rem = (pm / 48) * Math.max(0, total - elapsed); return { mu: o.pts + rem * (o.preMu / pm), sd: o.preSd * Math.sqrt(rem / pm) }; };
const out: any = { date, snapshots: snaps.length, players: new Set(obs.map((o) => o.pid)).size, obs: obs.length, phases: {}, grid: [] };
console.log(`${snaps.length} snapshots, ${out.players} player-games, ${obs.length} in-game observations`);
for (const [name, f] of [["pre-game model", preModel], ["no shrinkage", naive], ["ING (shipped)", est(ING)]] as const) {
  console.log(`\n${name}:`); out.phases[name] = {};
  for (const ph of ["Q1", "Q2", "Q3", "Q4+", "all"]) { const m = metrics(f, ph === "all" ? undefined : (o) => phase(o.elapsed) === ph); out.phases[name][ph] = m; console.log(`  ${ph.padEnd(4)} ${fmt(m)}`); }
}
for (const kShare of [6, 12, 24]) for (const kRate of [10, 20, 40]) for (const sdScale of [0.8, 1, 1.2]) {
  const m = metrics(est({ ...ING, kShare, kRate, sdScale })); if (m) out.grid.push({ kShare, kRate, sdScale, ...m });
}
out.grid.sort((a: any, b: any) => a.rmse - b.rmse);
console.log("\ngrid (best RMSE first):"); for (const g of out.grid.slice(0, 8)) console.log(`  kShare ${g.kShare} kRate ${g.kRate} sdScale ${g.sdScale}: ${fmt(g)}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
