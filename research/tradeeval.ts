// Evaluate one specific trade for both teams: Lock-In season simulation (paired random numbers) + dynasty value.
// Usage: GIVE="Keegan Murray,Moussa Diabate" GET="Caleb Wilson" TEAM=DuggyDaman npx tsx research/tradeeval.ts
import * as E from "../lib/engine/core";
import { fantasyPoints } from "../lib/engine/model";
import { buildWeek } from "../lib/live/week";
import { weekValues } from "../lib/live/waivers";
import { sleeper } from "../lib/live/sources";

const LID = "1344387394811490304", ME = 8;
const ASOF = Date.parse("2026-10-19T12:00:00Z");
const WEEKS = (process.env.WEEKS || "2,5,8,11,14,18,20").split(",").map(Number);
const N = Number(process.env.N || 150);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

(async () => {
  const league = await sleeper.league(LID); const S = league.scoring_settings;
  const [rosters, users, players, sproj] = await Promise.all([sleeper.rosters(LID), sleeper.users(LID), sleeper.players(6 * 3600e3), sleeper.seasonProjections(league.season)]);
  const P = players as Record<string, any>;
  const owner = (rid: number) => { const r = rosters.find((x) => x.roster_id === rid)!; const u = users.find((x: any) => x.user_id === r.owner_id) as any; return u?.display_name || `team ${rid}`; };
  const ridOf = (pid: string) => rosters.find((r) => (r.players || []).includes(pid))?.roster_id;
  const find = (n: string) => { const hits = Object.keys(P).filter((p) => norm(P[p]?.full_name || "") === norm(n) && P[p]?.sport !== "nfl"); const rostered = hits.filter((p) => ridOf(p)); const h = rostered[0] || hits[0]; if (!h) throw new Error("no player " + n); return h; };
  const give = (process.env.GIVE || "").split(",").map((s) => find(s.trim()));
  const get = (process.env.GET || "").split(",").map((s) => find(s.trim()));
  const them = ridOf(get[0])!;
  const ppg = (p: string) => (sproj[p] ? fantasyPoints(sproj[p], S) : 0);
  const adp = (p: string) => sproj[p]?.adp_dynasty ?? null;
  const dv = (p: string) => { const a = adp(p); return a ? 100 * Math.exp(-a / 45) : 0; };
  const info = (p: string) => { const r = rosters.find((x) => x.roster_id === ridOf(p)); const where = !r ? "FA" : (r.taxi || []).includes(p) ? "taxi" : (r.reserve || []).includes(p) ? "IR" : "active";
    return { name: P[p]?.full_name, team: P[p]?.team, pos: (P[p]?.fantasy_positions || []).join("/"), age: P[p]?.age, years_exp: P[p]?.years_exp, injury: P[p]?.injury_status || null, ppg: +ppg(p).toFixed(1), gp: sproj[p]?.gp ?? null, adp_dynasty: adp(p), dynValue: +dv(p).toFixed(1), owner: r ? owner(r.roster_id) : "FA", slot: where }; };
  console.log("TRADE: you", owner(ME), "give", give.map((p) => P[p].full_name), "| get", get.map((p) => P[p].full_name), "from", owner(them));
  for (const p of [...give, ...get]) console.log(JSON.stringify(info(p)));

  const cache = new Map<string, number[]>();
  async function sim(rid: number, edit: { add?: string[]; drop?: string[] }) {
    const key = `${rid}|${edit.add}|${edit.drop}`; if (cache.has(key)) return cache.get(key)!;
    const out: number[] = [];
    for (const w of WEEKS) { const c = await buildWeek({ leagueId: LID, rosterId: rid, week: w, asOf: ASOF, rosterEdit: edit, skipOpp: true }); out.push(...Array.from(weekValues(c.me, N, w * 7919, ASOF))); }
    cache.set(key, out); return out;
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const diff = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]); const m = mean(d); return `${m >= 0 ? "+" : ""}${m.toFixed(2)} ± ${(1.96 * Math.sqrt(mean(d.map((x) => (x - m) ** 2)) / d.length)).toFixed(2)}`; };
  const perWeek = async (rid: number, edit: any, base: number[]) => { const a = await sim(rid, edit); const L = N; return WEEKS.map((w, i) => `w${w}:${(mean(a.slice(i * L, (i + 1) * L)) - mean(base.slice(i * L, (i + 1) * L))).toFixed(1)}`).join(" "); };

  const meBase = await sim(ME, {});
  console.log(`\nYOUR base: ${mean(meBase).toFixed(1)} pts/wk over weeks ${WEEKS}`);
  for (const p of give) console.log(`  lose ${P[p].full_name} alone: ${diff(await sim(ME, { drop: [p] }), meBase)}`);
  const myEdit = { add: get, drop: give };
  console.log(`  TRADE (2-for-1, open roster spot left empty): ${diff(await sim(ME, myEdit), meBase)}   per week: ${await perWeek(ME, myEdit, meBase)}`);
  // the freed roster spot: best free agent by simulation among the top projected FAs
  const rostered = new Set(rosters.flatMap((r) => r.players || []));
  const fas = Object.keys(sproj).filter((p) => !rostered.has(p) && P[p]?.team && ppg(p) > 0).sort((a, b) => ppg(b) - ppg(a)).slice(0, Number(process.env.NFA || 8));
  if (process.env.FAS) { fas.length = 0; for (const n of process.env.FAS.split(",")) fas.push(find(n.trim())); }
  let best: { p: string; v: number } | null = null;
  for (const fa of fas) { const a = await sim(ME, { add: [...get, fa], drop: give }); const v = mean(a) - mean(meBase); console.log(`  trade + ${P[fa].full_name} (${(P[fa]?.fantasy_positions||[]).join("/")}, age ${P[fa]?.age}, ${ppg(fa).toFixed(1)} ppg, ${rosters.some((r) => (r.players||[]).includes(fa)) ? "ROSTERED" : "free agent"}): ${diff(a, meBase)}   per week: ${await perWeek(ME, { add: [...get, fa], drop: give }, meBase)}`); if (!best || v > best.v) best = { p: fa, v }; }
  if (best) console.log(`  TRADE + best FA in the open spot (${P[best.p].full_name}, ${ppg(best.p).toFixed(1)} ppg): ${diff(await sim(ME, { add: [...get, best.p], drop: give }), meBase)}   per week: ${await perWeek(ME, { add: [...get, best.p], drop: give }, meBase)}`);

  if (process.env.SKIPTHEM) return;
  const thBase = await sim(them, {});
  const r = rosters.find((x) => x.roster_id === them)!;
  const theirCut = (r.players || []).filter((p) => !get.includes(p) && !(r.taxi || []).includes(p) && !(r.reserve || []).includes(p)).sort((a, b) => ppg(a) + 0.3 * dv(a) - ppg(b) - 0.3 * dv(b))[0];
  const thEdit = { add: give, drop: [...get, theirCut] };
  console.log(`\n${owner(them)} base: ${mean(thBase).toFixed(1)}; after trade (cuts ${P[theirCut]?.full_name}): ${diff(await sim(them, thEdit), thBase)}`);
  const dyn = (xs: string[]) => xs.reduce((a, p) => a + dv(p), 0);
  const kv = (xs: string[]) => xs.reduce((a, p) => a + Math.pow(dv(p) / 10, 1.5), 0);
  console.log(`\nDYNASTY value (100*exp(-ADP/45)): you give ${dyn(give).toFixed(1)}, get ${dyn(get).toFixed(1)}  | trade-chart value (consolidation premium): give ${kv(give).toFixed(2)}, get ${kv(get).toFixed(2)}`);
})();
