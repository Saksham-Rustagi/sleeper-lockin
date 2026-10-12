// Trade evaluator: both teams simulated with each package (weeks 2-9), paired random numbers per player-game.
import * as E from "../lib/engine/core";
import { buildWeek, POLICY, type LiveTeam } from "../lib/live/week";
import fs from "fs";

const LID = "1344387394811490304", ME = 8, THEM = Number(process.argv[2] || 10), N = Number(process.env.N || 100);
const WEEKS = [2, 3, 4, 5, 6, 7, 8, 9];
const P = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "players.json", "utf8"));
const pr = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "proj_2026.json", "utf8"));
const id = (n: string) => Object.keys(P).find((k) => P[k].full_name === n)!;
const dv = (pid: string) => { const a = pr[pid]?.adp_dynasty; return a ? 100 * Math.exp(-a / 45) : 0; };
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

function weekTotal(T: LiveTeam, k: number, salt: number) {
  const actual = T.real.actual.slice(); const played = T.real.played.slice();
  T.pids.forEach((pid, i) => {
    const r = E.rng(hashStr(pid) ^ Math.imul(k + 1, 2654435761) ^ salt); let last = T.tw.lastPlayed0[i];
    for (const gi of T.tw.byPlayer[i]) { const g = T.tw.games[gi]; const u1 = r(), u2 = r(), u3 = r();
      const pk = last ? T.tw.dnp.p1 : T.tw.dnp.p0; const pl = u1 < pk ? 1 : 0;
      const z = Math.sqrt(-2 * Math.log(Math.max(u2, 1e-12))) * Math.cos(2 * Math.PI * u3);
      played[gi] = pl; actual[gi] = pl ? Math.max(-5, g.mu + g.sd * z) : 0; last = pl; }
  });
  return E.simulate(T.tw, POLICY, T.events, actual, played, E.initState(T.tw), 0).total;
}
async function teamValue(rosterId: number, edit?: { add?: string[]; drop?: string[] }) {
  const v: number[] = [];
  for (const w of WEEKS) {
    const ctx = await buildWeek({ leagueId: LID, rosterId, week: w, asOf: Date.parse("2026-10-19T12:00:00Z"), rosterEdit: edit, skipOpp: true });
    for (let k = 0; k < N; k++) v.push(weekTotal(ctx.me, k, w * 7919));
  }
  return v;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function paired(a: number[], b: number[]) { const d = a.map((x, i) => x - b[i]); const m = mean(d); const sd = Math.sqrt(mean(d.map((x) => (x - m) ** 2))); return { m, se: sd / Math.sqrt(d.length) }; }

(async () => {
  const WIL = id("Caleb Wilson");
  const packages: string[][] = (process.env.PKGS ? JSON.parse(process.env.PKGS) : [
    ["Collin Murray-Boyles"], ["Collin Murray-Boyles", "Moussa Diabaté"], ["Collin Murray-Boyles", "Kevin Porter"], ["Collin Murray-Boyles", "Collin Gillespie"],
    ["Isaiah Hartenstein", "Moussa Diabaté"], ["Isaiah Hartenstein", "Cason Wallace"], ["Isaiah Hartenstein", "Jalen Green"], ["Isaiah Hartenstein", "Collin Murray-Boyles"],
    ["Keegan Murray", "Moussa Diabaté"], ["Keegan Murray", "Cason Wallace"], ["Darius Acuff", "Moussa Diabaté"], ["Anthony Black", "Cason Wallace", "Moussa Diabaté"],
  ]);
  const meBase = await teamValue(ME); const themBase = await teamValue(THEM);
  console.log(`base: me ${mean(meBase).toFixed(1)} pts/wk, them ${mean(themBase).toFixed(1)} pts/wk   (Wilson dynasty value ${dv(WIL).toFixed(1)})`);
  const rows: any[] = [];
  for (const pk of packages) {
    const ids = pk.map(id);
    const meV = await teamValue(ME, { add: [WIL], drop: ids }); const thV = await teamValue(THEM, { add: ids, drop: [WIL] });
    const a = paired(meV, meBase), b = paired(thV, themBase);
    const dyn = ids.reduce((s, p) => s + dv(p), 0);
    rows.push({ pk: pk.join(" + "), me: a.m, meSe: a.se, them: b.m, themSe: b.se, dynOut: dyn, dynNet: dv(WIL) - dyn });
  }
  rows.sort((x, y) => y.me - x.me);
  console.log("package (you send for Wilson)                       | you pts/wk | them pts/wk | dynasty you send | dynasty net for you");
  for (const r of rows) console.log(`${r.pk.padEnd(52)} | ${(r.me >= 0 ? "+" : "") + r.me.toFixed(1)} ±${(2 * r.meSe).toFixed(1)} | ${(r.them >= 0 ? "+" : "") + r.them.toFixed(1)} ±${(2 * r.themSe).toFixed(1)} | ${r.dynOut.toFixed(1).padStart(5)} | ${(r.dynNet >= 0 ? "+" : "") + r.dynNet.toFixed(1)}`);
  fs.writeFileSync("/tmp/trade_rows.json", JSON.stringify(rows));
})();
