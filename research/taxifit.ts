// Marginal Lock-In value of each draft candidate for MiningMath's actual roster.
import fs from "fs";
import * as E from "./engine";
const P = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "players.json", "utf8"));
const pr = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "proj_2026.json", "utf8"));
const sched = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "sched_2026.json", "utf8"));
const R = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "rosters26.json", "utf8"));
const C = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "draft_candidates.json", "utf8"));
const SC = JSON.parse(fs.readFileSync((process.env.ROOT || "/root/sleeper/") + "research/data/league.json", "utf8")).scoring_settings;
const fp = (s: any) => Object.entries(s).reduce((a, [k, v]) => a + (typeof v === "number" && SC[k] ? SC[k] * v : 0), 0);
const me = R.find((r: any) => r.owner_id === "1147938059208523776");
const active: string[] = me.players.filter((p: string) => !(me.reserve || []).includes(p));
const slotNames = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
const ESPN_TIP = (date: string) => Date.parse(date + "T23:30:00Z") + Math.floor(Math.random() * 3) * 1800e3; // 7:30-8:30pm ET spread
const model = { a: -1.5, b: 0.92, c: 43, d: 3, dnp: { p1: 0.93, p0: 0.4 } };

function teamWeek(pids: string[], week: number, rnd: () => number): E.TeamWeek {
  const games: E.Game[] = [];
  pids.forEach((pid, i) => {
    const pl = P[pid]; const s = pr[pid] || {}; const proj = s.gp ? fp(s) : 10;
    for (const g of sched) {
      if (g.week !== week || ![g.home.team, g.away.team].includes(pl.team)) continue;
      const mu = model.a + model.b * proj; const sd = Math.sqrt(model.c + model.d * Math.max(0, mu));
      // deterministic tip spread per team so all scenarios share a schedule
      const west = ["POR", "SAC", "GSW", "LAL", "LAC", "PHX", "UTA", "DEN"].includes(g.home.team);
      const tip = Date.parse(g.date + "T23:00:00Z") + (west ? 3 * 3600e3 : 0.5 * 3600e3);
      games.push({ p: i, tip, end: tip + 2.5 * 3600e3, mu, sd, projRaw: proj, actual: 0, played: true });
    }
  });
  games.sort((a, b) => a.tip - b.tip);
  const byPlayer: number[][] = pids.map(() => []); games.forEach((g, i) => byPlayer[g.p].push(i));
  return { slots: slotNames.map((s) => E.SLOT_MASK[s]), slotNames, pmask: pids.map((p) => E.posMask(P[p].fantasy_positions || [])),
    names: pids.map((p) => P[p].full_name), games, byPlayer,
    lastPlayed0: pids.map((p) => (P[p].injury_status === "Out" ? 0 : 1)), dnp: model.dnp };
}
const pol: E.Policy = { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true };
const WEEKS = [2, 3, 4, 5, 6, 7, 8, 9]; const N = 300;
function value(pids: string[]): number {
  let tot = 0;
  for (const w of WEEKS) {
    const tw = teamWeek(pids, w, Math.random); const ev = E.buildEvents(tw, true);
    // common random numbers: seed depends on week+scenario and player id, so shared players get identical draws
    for (let k = 0; k < N; k++) {
      const actual = new Float64Array(tw.games.length); const played = new Uint8Array(tw.games.length);
      pids.forEach((pid, i) => {
        const r = E.rng(w * 100003 + k * 7919 + Number(pid) * 31);
        let last = tw.lastPlayed0[i];
        for (const gi of tw.byPlayer[i]) { const g = tw.games[gi]; const pk = last ? model.dnp.p1 : model.dnp.p0; const pl = r() < pk ? 1 : 0;
          let u = 0; while (!u) u = r(); const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
          played[gi] = pl; actual[gi] = pl ? Math.max(-5, g.mu + g.sd * z) : 0; last = pl; }
      });
      tot += E.simulate(tw, pol, ev, actual, played).total;
    }
  }
  return tot / (WEEKS.length * N);
}

const name = (p: string) => P[p].full_name;
const find = (n: string) => Object.keys(P).find((k) => P[k].full_name === n)!;
const bottom = ["Stephon Castle", "Donovan Clingan", "Cooper Flagg", "Cedric Coward", "Collin Murray-Boyles", "Naji Marshall"].map(find);
const picks: Record<string, string | null> = { "no pick": null };
const res: any = {};
for (const [lab, pk] of Object.entries(picks)) {
  const roster = pk ? [...active, pk] : active;
  const full = value(roster);
  res[lab] = bottom.map((b) => ({ cut: name(b), loss: +(full - value(roster.filter((q) => q !== b))).toFixed(2) }));
}
const info = bottom.map((b) => ({ name: name(b), pos: (P[b].fantasy_positions || []).join("/"), age: P[b].age, adpD: pr[b]?.adp_dynasty, proj: +fp(pr[b] || {}).toFixed(1), mpg: +((pr[b]?.sp || 0) / 60).toFixed(1) }));
console.log(JSON.stringify({ res, info }, null, 1));
