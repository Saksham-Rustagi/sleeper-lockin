// Task "held vs locked" live check (read-only; own cache + config dir, never the live app's): my and the opponent's
// slot states as buildWeek infers them, the outlook (win probability), the next game day's plan and the engine's
// hold / lock / bench call for every held score.
//   node research/dist/held_live.cjs <leagueId> <rosterId> [out.json]
// (own dirs: research/scratch/held/cache, research/scratch/held/cfg)
import fs from "fs";
import { advise } from "../lib/live/advise";
import { buildWeek } from "../lib/live/week";
import { sleeper } from "../lib/live/sources";

const [leagueId, rid, outFile] = process.argv.slice(2);
process.env.LOCKIN_CACHE_DIR ??= "research/scratch/held/cache";
process.env.LOCKIN_CONFIG_DIR ??= "research/scratch/held/cfg";
const f1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : (Math.round(x * 10) / 10).toString());
const et = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
(async () => {
  const t0 = Date.now();
  const ctx = await buildWeek({ leagueId, rosterId: Number(rid) });
  const mus = await sleeper.matchups(leagueId, ctx.week);
  for (const T of [ctx.me, ctx.opp]) if (T) {
    const mu = mus.find((m) => m.roster_id === T.rosterId);
    console.log(`\n== roster ${T.rosterId} ${T.teamName} (Sleeper points ${f1(mu?.points)}) week ${ctx.week}, asOf ${et(ctx.asOf)}`);
    ctx.slotNames.forEach((sn, s) => {
      const pid = T.lineup[s]; const i = pid ? T.pids.indexOf(pid) : -1;
      const gs = i >= 0 ? T.games.filter((g) => g.pid === pid) : [];
      const st = T.st; const lp = st.lockedBy[s];
      const state = lp >= 0 ? `LOCKED ${f1(st.lockedPts[s])} (${T.lockSource[s]})` : i < 0 ? "empty" : st.inGame[i] >= 0 ? "playing" : !Number.isNaN(st.pendingX[i]) ? `HELD ${f1(st.pendingX[i])}` : "idle";
      console.log(`  ${sn.padEnd(5)} ${(i >= 0 ? T.names[i] : "-").padEnd(24)} slotPts ${f1(mu?.starters_points?.[s]).padStart(5)}  ${state.padEnd(26)} ${T.injury[i] ?? ""}  games: ${gs.map((g) => `${g.date.slice(5)} ${g.opp} ${g.status}${g.actual !== null ? " " + f1(g.actual) : ""}`).join(", ")}`);
    });
  }
  const a = await advise({ leagueId, rosterId: Number(rid), force: true });
  const o = a.outlook;
  console.log(`\noutlook: me ${f1(o.myMean)} (${f1(o.myP10)}-${f1(o.myP90)}), opp ${f1(o.oppMean)}, win ${o.winProb === null ? "-" : (100 * o.winProb).toFixed(1) + "%"}`);
  console.log(`\ndecisions (held scores):`);
  for (const d of a.decisions) console.log(`  ${d.player} ${f1(d.score)} -> ${d.recommended}${d.recommendedSlot ? " " + d.recommendedSlot : ""} (${d.deadlineText}); options ${d.options.map((x) => `${x.action}${x.slot ? ":" + x.slot : ""} ${f1(x.expPoints)}`).join(", ")}\n     ${d.reason}`);
  console.log(`\nplan:`);
  for (const p of a.plan) {
    console.log(`  ${p.when}${p.tentative ? " (tentative)" : ""}: starts ${p.starts.map((s) => `${s.slot} ${s.player} proj ${f1(s.proj)}${(s as any).playProb !== undefined ? ` p=${(s as any).playProb}` : ""}${(s as any).label ? ` [${(s as any).label}]` : ""}`).join("; ") || "-"}`);
    if (p.benched.length) console.log(`     bench: ${p.benched.map((b) => `${b.player} ${f1(b.proj)}${(b as any).label ? ` [${(b as any).label}]` : ""}`).join(", ")}`);
    if (p.holds.length) console.log(`     holds: ${p.holds.map((h) => `${h.player} ${f1(h.score)} in ${h.slot}${h.move ? " (move)" : ""}`).join(", ")}`);
    if (p.forfeits.length) console.log(`     lets go: ${p.forfeits.map((h) => `${h.player} ${f1(h.score)}`).join(", ")}`);
  }
  console.log(`\nactions:\n  ${a.actions.join("\n  ")}\nnotes:\n  ${a.notes.join("\n  ")}\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(a, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
