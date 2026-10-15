// Deploy check (task G): the live code (branch lockin-live, extracted to ./live_src by extract_live.mjs) vs engine-v2,
// in ONE process on the SAME live contexts (no second fetch): with the default engine every number must be identical,
// and with p10b every mass simulation must be identical too.
// usage: LOCKIN_NO_WORKERS=1 node research/dist/p7h_equiv.cjs <out.json>
import fs from "fs";
import * as E from "../../../lib/engine/core";
import { buildWeek, POLICY, type LiveTeam } from "../../../lib/live/week";
import * as NewAdv from "../../../lib/live/advise";
import * as NewSim from "../../../lib/live/teamsim";
import * as NewCache from "../../../lib/live/cache";
import { resetEngineCache } from "../../../lib/live/engine";
import * as OldAdv from "./live_src/lib/live/advise";
import * as OldSim from "./live_src/lib/live/teamsim";
import * as OldCache from "./live_src/lib/live/cache";
import { sleeper } from "../../../lib/live/sources";

const LEAGUE = "1344387394811490304", ROSTER = 8;
function advance(T: LiveTeam, from: number, t: number, seed: number) { // as research/livecost_g.ts
  const sc = E.sampleScenario(T.tw, T.st, from, E.rng(seed), T.real);
  const res = E.simulate(T.tw, POLICY, T.events, sc.actual, sc.played, E.cloneState(T.st), T.evIdx, undefined, t);
  T.st = res.st; T.evIdx = res.evIdx;
  T.games.forEach((g) => {
    if (g.end <= t) { g.status = "post"; g.played = !!sc.played[g.gi]; g.actual = g.played ? sc.actual[g.gi] : 0; T.real.actual[g.gi] = g.actual; T.real.played[g.gi] = g.played ? 1 : 0; T.tw.games[g.gi].actual = g.actual; T.tw.games[g.gi].played = g.played; }
    else if (g.tip <= t) g.status = "in";
  });
  T.tw.nextGameIdx = T.pids.map((_, i) => T.tw.byPlayer[i].find((gi) => T.games[gi].status === "pre") ?? -1);
  T.lineup = T.tw.slots.map((_, s) => {
    const p = T.st.lockedBy[s] >= 0 ? T.st.lockedBy[s] : T.st.pinned[s] >= 0 ? T.st.pinned[s] : T.pids.findIndex((_, q) => T.st.lastSlot[q] === s && !Number.isNaN(T.st.pendingX[q]) && !T.st.isLocked[q]);
    return p >= 0 ? T.pids[p] : null;
  });
}
const strip = (a: any) => JSON.stringify({ ...a, generatedAt: 0 });
const withEngine = async <R>(e: string | undefined, f: () => R | Promise<R>) => { if (e) process.env.LOCKIN_ENGINE = e; else delete process.env.LOCKIN_ENGINE; resetEngineCache(); try { return await f(); } finally { delete process.env.LOCKIN_ENGINE; resetEngineCache(); } };

(async () => {
  const out: any = { checks: [] as any[] };
  const ok = (name: string, pass: boolean, detail?: unknown) => { out.checks.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`); };
  const sched = await sleeper.schedule((await sleeper.league(LEAGUE)).season);
  const tue = Date.parse([...new Set(sched.filter((g) => g.week === 1).map((g) => g.date))].sort()[0] + "T16:00:00Z");
  // contexts: Tuesday noon of week 1, and Wednesday 10 min before the first tip-off with Tuesday's game held
  const cTue = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf: tue });
  const tick = Date.parse("2026-10-21T22:50:00Z");
  const cTick = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf: tue });
  for (const [T, s] of [[cTick.me, 101], [cTick.opp, 202]] as const) if (T) advance(T, tue, tick, s);
  cTick.asOf = tick;
  for (const [name, c] of [["tue", cTue], ["tick", cTick]] as const) {
    const vOld = OldSim.weekValues(c.me, 3000, 7919, c.asOf);
    for (const e of [undefined, "p10b"]) {
      const vNew = await withEngine(e, () => NewSim.weekValues(c.me, 3000, 7919, c.asOf));
      const diff = vOld.reduce((n, x, k) => n + (x !== vNew[k] ? 1 : 0), 0);
      ok(`${name}: projections (3000 weeks), live code vs engine-v2 ${e ?? "p7h"}`, diff === 0, { differing: diff, mean: vOld.reduce((a, b) => a + b, 0) / vOld.length });
    }
    const ms = OldSim.weekValues(c.me, 500, 1, c.asOf), os = c.opp ? OldSim.weekValues(c.opp, 500, 2, c.asOf) : null;
    const aOld = await OldAdv.computeAdvice(c, 250, ms, os);
    const aNew = await withEngine(undefined, () => NewAdv.computeAdvice(c, 250, ms, os));
    ok(`${name}: full advice (decisions, plan, cut-offs, actions), live code vs engine-v2 p7h`, strip(aOld) === strip(aNew), { decisions: aOld.decisions.length, tips: aOld.plan.length });
    const a10 = await withEngine("p10b", () => NewAdv.computeAdvice(c, 250, ms, os));
    const opts = (a: any) => JSON.stringify(a.decisions.map((d: any) => d.options));
    ok(`${name}: p10b decision options' expected points = live code's (POLICY quick simulations)`, opts(aOld) === opts(a10));
    out[name] = { old: { decisions: aOld.decisions.map((d) => [d.player, d.recommended, d.recommendedSlot]), plan: aOld.plan.map((p) => [p.when, p.starts.map((s) => s.player + "@" + s.slot), p.holds.map((h) => h.player), p.forfeits.map((f) => f.player)]) },
      p10b: { decisions: a10.decisions.map((d) => [d.player, d.recommended, d.recommendedSlot, d.reason]), plan: a10.plan.map((p) => [p.when, p.starts.map((s) => s.player + "@" + s.slot), p.holds.map((h) => h.player), p.forfeits.map((f) => f.player)]) } };
  }
  const x = { v: 3, K: 20000, week: 1, team: NewSim.teamFingerprint(cTick.me) };
  ok("cache fingerprints: live code = engine-v2 p7h (sim and decision scopes)", OldCache.fingerprint(x) === NewCache.fingerprint(x, "sim") && OldCache.fingerprint(x) === NewCache.fingerprint(x));
  ok("cache fingerprints: p10b's mass simulations = live code's entries", await withEngine("p10b", () => NewCache.fingerprint(x, "sim")) === OldCache.fingerprint(x));
  ok("cache fingerprints: p10b's advise / replay have their own entries", await withEngine("p10b", () => NewCache.fingerprint(x)) !== OldCache.fingerprint(x));
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  process.exit(out.checks.every((c: any) => c.pass) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
