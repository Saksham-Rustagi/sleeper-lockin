// Walk-forward backtest on the real 2025-26 season of league 'late night fun'.
// usage: npx tsx research/backtest.ts <weekFrom> <weekTo> <policyNames,comma> <out.json> [K]
import fs from "fs";
import * as E from "./engine";

import { S, fitModel, teamWeek } from "./btcommon";
const [wFrom, wTo, polNames, outFile, Karg] = process.argv.slice(2);
const K = Number(Karg ?? 200);

const POLICIES: Record<string, E.Policy> = {
  APP: { name: "APP", matching: "appGreedy", value: "rawMax", defer: false, reserve: false, chain: true },
  P1: { name: "P1", matching: "exact", value: "stop", defer: false, reserve: false, chain: true },
  P2: { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true },
  P2_NOCHAIN: { name: "P2_NOCHAIN", matching: "exact", value: "stop", defer: true, reserve: true, chain: false },
  P2LA: { name: "P2LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P3LA: { name: "P3LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, rollout: { objective: "points", K, margin: 12 } },
  P2_NORES: { name: "P2_NORES", matching: "exact", value: "stop", defer: true, reserve: false, chain: true },
  P3: { name: "P3", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "points", K, margin: 12 } },
  P4S: { name: "P4S", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "softwin", K, margin: 12 } },
  P3W: { name: "P3W", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "points", K, margin: 25 } },
  P5:  { name: "P5", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P6:  { name: "P6", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, rollout: { objective: "points", K, margin: 12 } },
  P7:  { name: "P7", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, rollout: { objective: "points", K, margin: 12 } },
  P2LAH: { name: "P2LAH", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true },
  P7H: { name: "P7H", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true, holdYield: true, rollout: { objective: "points", K, margin: 12 } },
  P2S: { name: "P2S", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true },
  P4:  { name: "P4", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "win", K, margin: 12 } },
};

const results: any[] = [];
const pols = polNames.split(",");
const CUT: Record<string, number[]> = {}; // parity -> coefs trained on the OTHER parity
if (process.env.CUT_ODD) CUT.even = JSON.parse(fs.readFileSync(process.env.CUT_ODD, "utf8")).coef;   // trained on odd weeks -> used on even
if (process.env.CUT_EVEN) CUT.odd = JSON.parse(fs.readFileSync(process.env.CUT_EVEN, "utf8")).coef;
function polFor(pn: string, week: number): E.Policy {
  const base = POLICIES[pn]; if (!/^P[56]/.test(pn)) return base;
  return { ...base, cutoff: CUT[week % 2 ? "odd" : "even"] };
}
// dynamic variants: P2LAe<eps> / P3LAe<eps>: lock only if lockBest >= cont + eps (eps in points)
for (const pn of pols) { const m = pn.match(/^(P2LA|P3LA)e([\d.]+)$/); if (m && !POLICIES[pn]) POLICIES[pn] = { ...POLICIES[m[1]], name: pn, eps: Number(m[2]) }; }
// <P>_L = with the bugs fixed in engine-v2 phase 1 re-enabled; <P>_L<bug>[+<bug>] = only those (strand, negEnd, reseat, stop, heldTie)
for (const pn of pols) { const m = pn.match(/^(P2LA|P2LAH|P7H|P3LA)_L(.*)$/); if (m && !POLICIES[pn]) POLICIES[pn] = { ...POLICIES[m[1]], name: pn, legacyBugs: m[2] ? (m[2].split("+") as E.LegacyBug[]) : true }; }
for (const pn of pols) { const m = pn.match(/^P3LAm(\d+)$/); if (m && !POLICIES[pn]) POLICIES[pn] = { ...POLICIES.P3LA, name: pn, rollout: { objective: "points", K, margin: Number(m[1]) } }; }
for (let week = Number(wFrom); week <= Number(wTo); week++) {
  const W = S.weeks.find((x: any) => x.week === week); if (!W) continue;
  const model = fitModel(week);
  const rids = Object.keys(W.teams);
  const built = new Map(rids.map((r) => [r, teamWeek(week, r, model)]));
  const oppOf = new Map<string, string>();
  for (const [a, b] of W.matchups) { oppOf.set(String(a), String(b)); oppOf.set(String(b), String(a)); }
  for (const rid of rids) {
    const { tw, real } = built.get(rid)!;
    const row: any = { week, rid, opp: oppOf.get(rid) ?? null, human: W.teams[rid].human_points, hindsight: E.hindsight(tw), model: week === Number(wFrom) && rid === rids[0] ? model : undefined };
    for (const pn of pols) {
      const pol = polFor(pn, week); const t0 = Date.now();
      const evs = E.buildEvents(tw, pol.chain);
      let hooks: E.Hooks | undefined;
      if (pol.rollout) {
        const base: E.Policy = { ...(pol.lockAware ? POLICIES.P2LA : POLICIES.P2), eps: pol.eps, cutoff: pol.cutoff, holdYield: pol.holdYield, legacyBugs: pol.legacyBugs };
        const o = oppOf.get(rid);
        const opp = o ? (() => { const ob = built.get(o)!; return { tw: ob.tw, events: E.buildEvents(ob.tw, true), pol: base, realised: ob.real }; })() : undefined;
        hooks = E.rolloutHooks(tw, base, evs, pol.rollout.objective, pol.rollout.K, pol.rollout.margin, week * 1000 + Number(rid), real, opp);
      }
      if (pn === "P7" || pn === "P2S" || /^P7H/.test(pn)) hooks = E.startRolloutHooks(tw, { ...POLICIES.P2LA, cutoff: pol.cutoff, holdYield: pol.holdYield, legacyBugs: pol.legacyBugs }, evs, Number(process.env.KS || K), week * 1000 + Number(rid), real, hooks);
      const res = E.simulate(tw, pol, evs, real.actual, real.played, E.initState(tw), 0, hooks);
      row[pn] = Math.round(res.total * 10) / 10; row[pn + "_ms"] = Date.now() - t0; row[pn + "_locks"] = res.st.locks; row[pn + "_moves"] = res.st.lockMoves;
    }
    results.push(row);
    process.stderr.write(`w${week} r${rid} ${pols.map((p) => p + "=" + row[p]).join(" ")} human=${row.human} hs=${row.hindsight.toFixed(0)}\n`);
  }
}
fs.writeFileSync(outFile, JSON.stringify(results));
