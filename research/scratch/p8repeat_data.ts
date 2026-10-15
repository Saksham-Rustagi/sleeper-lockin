// Do the inputs of research/tradeeval.ts change during a long run? Rebuild the same team-weeks every ~65 s (past the
// in-memory TTLs of lib/live/sources.ts) and report what differs from round 0 (and the effect on a P8 week value).
// usage: node research/dist/p8repeat_data.cjs [rounds] [weeks] [N]
import { buildWeek } from "../../lib/live/week";
import { weekValues } from "../../lib/live/waivers";
process.env.LOCKIN_ENGINE = "p8";
const LID = "1344387394811490304", ME = 8, ASOF = Date.parse("2026-10-19T12:00:00Z");
const R = Number(process.argv[2] || 6), WEEKS = (process.argv[3] || "2,5,8,11,14,18,20").split(",").map(Number), N = Number(process.argv[4] || 10);
const mean = (a: Float64Array) => a.reduce((x, y) => x + y, 0) / a.length;
(async () => {
  const first = new Map<number, any>();
  for (let r = 0; r < R; r++) {
    const t0 = Date.now(); const line: string[] = [];
    for (const w of WEEKS) {
      const c = await buildWeek({ leagueId: LID, rosterId: ME, week: w, asOf: ASOF, skipOpp: true }); const T = c.me;
      const snap = { pids: T.pids.join(","), evIdx: T.evIdx, games: T.games.map((g) => ({ k: `${g.pid}|${g.date}`, tip: g.tip, proj: g.proj, team: g.team })), pNext: JSON.stringify(T.tw.pNext), lp0: T.tw.lastPlayed0.join(""), v: mean(weekValues(T, N, w * 7919, ASOF)) };
      const f = first.get(w); if (!f) { first.set(w, snap); line.push(`w${w}: evIdx ${snap.evIdx} v ${snap.v.toFixed(2)}`); continue; }
      const d: string[] = [];
      if (f.pids !== snap.pids) d.push("roster");
      if (f.pNext !== snap.pNext) d.push("injury pNext");
      if (f.lp0 !== snap.lp0) d.push("lastPlayed0");
      const fg = new Map(f.games.map((g: any) => [g.k, g]));
      let tips = 0, proj = 0, gone = 0; for (const g of snap.games) { const o: any = fg.get(g.k); if (!o) { gone++; continue; } if (o.tip !== g.tip) tips++; if (o.proj !== g.proj) proj++; }
      if (tips) d.push(`${tips} tip times`); if (proj) d.push(`${proj} projections`); if (gone || f.games.length !== snap.games.length) d.push(`game list ${f.games.length}->${snap.games.length}`);
      line.push(`w${w}: ${d.length ? d.join(", ") : "same"} v ${snap.v.toFixed(2)}${snap.v !== f.v ? " (CHANGED)" : ""}`);
    }
    console.log(`round ${r} (${new Date().toISOString()}): ${line.join(" | ")}`);
    const wait = 65e3 - (Date.now() - t0); if (r < R - 1 && wait > 0) await new Promise((res) => setTimeout(res, wait));
  }
})();
