// Task S live check: sticky "Do now" lineup + notifier materiality / hysteresis on the live advice (read-only copy).
//   npx tsx research/s_live.ts <advice cache json> [advice.jsonl] [old donow.ts]
// 1. old vs new card on the live advice
// 2. stability: 10 runs, each with the engine's slot labels re-drawn at random among valid placements (what Monte-Carlo
//    ordering does to the plan) -> the new card's target and changes must be identical every time
// 3. replay of today's notifier runs: the logged plans (advice.jsonl nextTip + decisions) with the Sleeper lineup now
import fs from "fs";
import { doNow, slotLabels } from "../lib/live/donow";
import { messages } from "../scripts/notify";
import type { LineupState } from "../lib/live/lineupnotify";

const [file, jsonl, oldPath] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(file, "utf8")).v;
const old = oldPath ? require(oldPath).doNow as typeof doNow : null;
const S: string[] = a.me.slots.map((s: any) => s.slot); const L = slotLabels(S);
const POS: Record<string, string[]> = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: ["PG", "SG", "SF", "PF", "C"] };
const pos = new Map<string, string[]>(a.me.players.map((p: any) => [p.pid, p.pos.split("/")]));
const fits = (pid: string, i: number) => (pos.get(pid) ?? []).some((x) => POS[S[i]].includes(x));

console.log(`live advice as of ${new Date(a.asOf).toISOString()}; Sleeper: ${a.me.slots.map((s: any, i: number) => `${L[i]} ${s.player ?? "-"}${s.state === "held" ? ` (held ${s.points})` : ""}`).join(", ")}`);
console.log(`engine at ${a.plan[0].when}: starts ${a.plan[0].starts.map((x: any) => `${x.slot} ${x.player}`).join(", ")}; holds ${a.plan[0].holds.map((x: any) => `${x.slot} ${x.player}`).join(", ")}`);
if (old) console.log(`\nOLD card changes: ${JSON.stringify(old(a).changes)}`);
const d0 = doNow(a);
console.log(`NEW card changes: ${JSON.stringify(d0.changes)}  upToDate: ${d0.upToDate}`);

// random valid relabel of each tip-off's starters + holds among the slots not taken by locks / games in progress
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
function relabel(adv: any) {
  const b = JSON.parse(JSON.stringify(adv));
  for (const pl of b.plan) {
    const taken = new Set<number>([...(pl.locks ?? []), ...(pl.playing ?? [])].map((x: any) => L.indexOf(x.slot)));
    a.me.slots.forEach((s: any, i: number) => { if (s.locked || s.state === "locked") taken.add(i); });
    const items = [...pl.starts, ...pl.holds];
    const free = L.map((_, i) => i).filter((i) => !taken.has(i));
    for (let tries = 0; tries < 50; tries++) {
      const order = free.slice().sort(() => rnd() - 0.5); const used = new Set<number>(); const pick: number[] = [];
      const ok = items.every((x: any) => { const s = order.find((i) => !used.has(i) && fits(x.pid, i)); if (s === undefined) return false; used.add(s); pick.push(s); return true; });
      if (ok) { items.forEach((x: any, j: number) => (x.slot = L[pick[j]])); break; }
    }
  }
  return b;
}
const sig = (d: ReturnType<typeof doNow>) => JSON.stringify({ t: d.target.map((t) => `${t.slot}:${t.pid}:${t.kind}`), c: d.changes });
const runs: { labels: string; newSig: string; oldSig: string }[] = [];
for (let r = 0; r < 10; r++) {
  const b = relabel(a);
  runs.push({ labels: b.plan[0].starts.concat(b.plan[0].holds).map((x: any) => `${x.player.split(" ").pop()} ${x.slot}`).join(", "), newSig: sig(doNow(b)), oldSig: old ? JSON.stringify(old(b).changes) : "" });
}
console.log(`\nstability, 10 runs with random engine slot labels:`);
runs.forEach((r, i) => console.log(`  run ${i + 1}: engine ${r.labels}\n    old changes: ${r.oldSig}\n    new changes: ${JSON.parse(r.newSig).c.length ? JSON.stringify(JSON.parse(r.newSig).c) : "none"}`));
console.log(`  distinct new results: ${new Set(runs.map((r) => r.newSig)).size}; distinct old results: ${new Set(runs.map((r) => r.oldSig)).size}`);

// notifier replay over today's logged plans (state carried across runs), then the live advice
if (jsonl) {
  const rows = fs.readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.nextTip && r.nextTip.tip === a.plan[0].tip);
  const st: LineupState = {}; const sentKeys = new Set<string>();
  console.log(`\nnotifier replay (${rows.length} logged runs + the live advice; Sleeper lineup as now):`);
  for (const r of [...rows.map((r) => ({ ts: r.ts, adv: { ...a, asOf: r.ts, decisions: r.decisions, plan: [r.nextTip, ...a.plan.slice(1)], doNow: undefined } })), { ts: a.asOf, adv: { ...a, doNow: undefined } }]) {
    const notes: string[] = [];
    const ms = messages(r.adv, r.ts, st, notes).filter((m) => /^(lineup|cutoffs)\|/.test(m.key) && !sentKeys.has(m.key));
    ms.forEach((m) => sentKeys.add(m.key));
    console.log(`  ${new Date(r.ts).toISOString().slice(11, 16)}Z engine ${r.adv.plan[0].starts.map((x: any) => `${x.player.split(" ").pop()} ${x.slot}`).join(", ")}: ${ms.length ? ms.map((m) => `SEND "${m.title}" | ${m.body}`).join(" / ") : "no reminder"} [${notes.join("; ")}]`);
  }
}
