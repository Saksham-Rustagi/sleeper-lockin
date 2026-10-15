
// Compare roster variants with a chosen engine making the decisions, on paired scenarios (same draws per player).
import * as E from "../lib/engine/core";
import { buildWeek, POLICY } from "../lib/live/week";
import { scenario } from "../lib/live/teamsim";
import { replayHooks, P8_POLICY } from "../lib/live/engine";
import { sleeper } from "../lib/live/sources";
import { fantasyPoints } from "../lib/engine/model";
const LID = "1344387394811490304", ME = 8, ASOF = Date.parse("2026-10-19T12:00:00Z");
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
(async () => {
  const [rosters, players] = await Promise.all([sleeper.rosters(LID), sleeper.players(6 * 3600e3)]);
  const P = players as Record<string, any>;
  const ridOf = (pid: string) => rosters.find((r) => (r.players || []).includes(pid))?.roster_id;
  const find = (n: string) => { const h = Object.keys(P).filter((p) => norm(P[p]?.full_name || "") === norm(n)); return h.find((p) => ridOf(p)) || h.find((p) => P[p]?.team) || h[0]; };
  const give = ["Keegan Murray", "Moussa Diabate"].map(find), get = [find("Caleb Wilson")];
  let FAS = (process.env.FAS || "Keldon Johnson,Deandre Ayton").split(",");
  if (FAS[0].startsWith("TOP:")) {
    const league = await sleeper.league(LID); const sproj = await sleeper.seasonProjections(league.season);
    const ppg = (q: string) => (sproj[q] ? fantasyPoints(sproj[q], league.scoring_settings) : 0);
    const rostered = new Set(rosters.flatMap((r) => r.players || []));
    const all = Object.keys(sproj).filter((q) => !rostered.has(q) && P[q]?.team && ppg(q) > 0).sort((a, b) => ppg(b) - ppg(a)).slice(0, Number(FAS[0].slice(4)));
    if (process.env.LIST) { for (const q of all) console.log(JSON.stringify({ list: P[q].full_name, pos: (P[q].fantasy_positions || []).join("/"), age: P[q].age, team: P[q].team, inj: P[q].injury_status || null, ppg: +ppg(q).toFixed(1) })); return; }
    const sk = Number(process.env.SKIP || 0), tk = Number(process.env.TAKE || all.length);
    FAS = all.slice(sk, sk + tk).map((q) => P[q].full_name);
  }
  const WEEKS = (process.env.WEEKS || "1,2").split(",").map(Number);
  const K0 = Number(process.env.K0 || 0), KN = Number(process.env.KN || 10), ENG = process.env.ENG || "p10";
  for (const w of WEEKS) for (const fn of FAS) {
    const c = await buildWeek({ leagueId: LID, rosterId: ME, week: w, asOf: ASOF, rosterEdit: { add: [...get, find(fn)], drop: give }, skipOpp: true });
    const T = c.me;
    for (let k = K0; k < K0 + KN; k++) {
      const sc = scenario(T, k, w * 7919, ASOF); const t0 = Date.now();
      let total: number;
      if (ENG === "p8") total = E.simulate(T.tw, P8_POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx).total;
      else if (ENG === "p7h") total = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, replayHooks(T.tw, T.events, 200, k + 1, sc, "p7h")).total;
      else total = E.simulate(T.tw, P8_POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, replayHooks(T.tw, T.events, 50, k + 1, sc, "p10")).total;
      console.log(JSON.stringify({ eng: ENG, w, fa: fn, k, total, ms: Date.now() - t0 }));
    }
  }
})();
