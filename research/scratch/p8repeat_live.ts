// P8 repeatability on the live path of research/tradeeval.ts: buildWeek + weekValues (simPolicy) with engine p8.
// usage: node research/dist/p8repeat_live.cjs [weeks] [N] [engine]
import crypto from "crypto";
import { buildWeek } from "../../lib/live/week";
import { weekValues } from "../../lib/live/waivers";
import { sleeper } from "../../lib/live/sources";
process.env.LOCKIN_ENGINE = process.argv[4] || "p8";
const LID = "1344387394811490304", ME = 8, ASOF = Date.parse("2026-10-19T12:00:00Z");
const WEEKS = (process.argv[2] || "2,5").split(",").map(Number), N = Number(process.argv[3] || 30);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
(async () => {
  const [rosters, players] = await Promise.all([sleeper.rosters(LID), sleeper.players(6 * 3600e3)]);
  const P = players as Record<string, any>;
  const ridOf = (pid: string) => rosters.find((r) => (r.players || []).includes(pid))?.roster_id;
  const find = (n: string) => { const h = Object.keys(P).filter((p) => norm(P[p]?.full_name || "") === norm(n)); return h.find((p) => ridOf(p)) || h[0]; };
  const diabate = find("Moussa Diabate");
  const variants: [string, any][] = [["base", {}], ["dropD", { drop: [diabate] }]];
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sig = (T: any) => crypto.createHash("md5").update(JSON.stringify([T.pids, T.tw.games, T.tw.pNext, T.tw.lastPlayed0, T.evIdx])).digest("hex").slice(0, 8);
  async function sim(edit: any) { const out: number[] = []; const sigs: string[] = [];
    for (const w of WEEKS) { const c = await buildWeek({ leagueId: LID, rosterId: ME, week: w, asOf: ASOF, rosterEdit: edit, skipOpp: true }); sigs.push(sig(c.me)); out.push(...Array.from(weekValues(c.me, N, w * 7919, ASOF))); }
    return { out, sigs }; }
  const order = (process.argv[5] || "base,dropD,base,dropD").split(",");
  const seen = new Map<string, number[]>();
  for (const name of order) {
    const r = await sim(variants.find((v) => v[0] === name)![1]);
    const prev = seen.get(name); const nd = prev ? r.out.filter((x, i) => x !== prev[i]).length : -1;
    console.log(`${name}: mean ${mean(r.out).toFixed(3)} sigs ${r.sigs.join(",")} ${prev ? `differs from first run in ${nd}/${r.out.length}` : ""}`);
    if (!prev) seen.set(name, r.out);
  }
})();
