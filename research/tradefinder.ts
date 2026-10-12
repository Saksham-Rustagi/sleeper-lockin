// Trade finder prototype: scans all other teams for deals that are good for you (Lock-In simulation)
// AND look good to the other manager (projection-based "what he sees" + dynasty value + position need).
// Stages: (1) per-player marginal values by simulation (screen), (2) candidate 1-1 / 2-1 / 1-2 packages,
// (3) paired full simulation of the best candidates for both teams.
import * as E from "../lib/engine/core";
import { fantasyPoints } from "../lib/engine/model";
import { buildWeek } from "../lib/live/week";
import { weekValues } from "../lib/live/waivers";
import { sleeper } from "../lib/live/sources";
import fs from "fs";

const LID = "1344387394811490304", ME = 8;
const ASOF = Date.parse("2026-10-19T12:00:00Z");
const WEEKS = (process.env.WEEKS || "2,4,6").split(",").map(Number); // sample of the regular season
const N_SCREEN = Number(process.env.NS || 50), N_FULL = Number(process.env.NF || 150), TOP = Number(process.env.TOP || 40);
const DYN_W = 0.1; // 1 dynasty point (100*exp(-ADP/45)) ≈ 0.1 pts/wk, same scale on both sides
const OUT = process.env.OUT || "/root/sleeper-lockin/research/out/tradefinder.json";

(async () => {
  const t0 = Date.now();
  const league = await sleeper.league(LID); const S = league.scoring_settings;
  const [rosters, users, players, sproj] = await Promise.all([sleeper.rosters(LID), sleeper.users(LID), sleeper.players(6 * 3600e3), sleeper.seasonProjections(league.season)]);
  const owner = (rid: number) => { const r = rosters.find((x) => x.roster_id === rid)!; const u = users.find((x: any) => x.user_id === r.owner_id) as any; return u?.display_name || `team ${rid}`; };
  const P = players as Record<string, any>;
  const name = (p: string) => P[p]?.full_name || p;
  const pos = (p: string): string[] => P[p]?.fantasy_positions || ["UTIL"];
  const ppg = (p: string) => (sproj[p] ? fantasyPoints(sproj[p], S) : 0);
  const adp = (p: string) => sproj[p]?.adp_dynasty ?? null;
  const dv = (p: string) => { const a = adp(p); return a ? 100 * Math.exp(-a / 45) : 0; };
  const protectedMe = (p: string) => (P[p]?.age ?? 99) <= 23 || (adp(p) ?? 999) <= 120;
  const active = (rid: number) => { const r = rosters.find((x) => x.roster_id === rid)!; return (r.players || []).filter((p) => !(r.reserve || []).includes(p) && !(r.taxi || []).includes(p)); };
  const others = rosters.map((r) => r.roster_id).filter((r) => r !== ME);

  // ---- "what he sees": best 9-slot lineup by projected PPG (+ small bench credit) + dynasty value
  const SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
  // dynasty trade value with a consolidation premium (one stud > two good players), like dynasty trade charts
  const kv = (p: string) => Math.pow(dv(p) / 10, 1.5);
  const KV_MIN = Number(process.env.KV_MIN || 0.9); // he must get back >= 90% of the dynasty value he sends
  function projPts(roster: string[]) {
    const ps = [...roster].sort((a, b) => ppg(b) - ppg(a)); const used = new Set<string>(); let starters = 0;
    for (const s of SLOTS) { const m = E.SLOT_MASK[s]; const p = ps.find((q) => !used.has(q) && (E.posMask(pos(q)) & m)); if (p) { used.add(p); starters += ppg(p); } }
    return 3.5 * (starters + 0.15 * ps.filter((p) => !used.has(p)).slice(0, 5).reduce((a, p) => a + ppg(p), 0));
  }
  function perceived(roster: string[]) {
    const ps = [...roster].sort((a, b) => ppg(b) - ppg(a)); const used = new Set<string>(); let starters = 0;
    for (const s of SLOTS) { const m = E.SLOT_MASK[s]; const p = ps.find((q) => !used.has(q) && (E.posMask(pos(q)) & m)); if (p) { used.add(p); starters += ppg(p); } }
    const bench = ps.filter((p) => !used.has(p)).slice(0, 5).reduce((a, p) => a + ppg(p), 0);
    return 3.5 * (starters + 0.15 * bench) + DYN_W * roster.reduce((a, p) => a + dv(p), 0); // ≈ projected pts/wk + dynasty
  }
  // position depth (eligible players with ≥ 22 proj PPG) for "short at C, long at F" labels
  function depth(roster: string[]) { const d: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 }; for (const p of roster) if (ppg(p) >= 22) for (const k of Object.keys(d)) if (pos(p).includes(k)) d[k]++; return d; }

  // ---- simulation value of a roster edit (paired random numbers across edits)
  const cache = new Map<string, number[]>();
  async function simVals(rid: number, edit: { add?: string[]; drop?: string[] }, N: number) {
    const key = `${rid}|${N}|${[...(edit.add || [])].sort()}|${[...(edit.drop || [])].sort()}`;
    if (cache.has(key)) return cache.get(key)!;
    const out: number[] = [];
    for (const w of WEEKS) { const c = await buildWeek({ leagueId: LID, rosterId: rid, week: w, asOf: ASOF, rosterEdit: edit, skipOpp: true }); out.push(...Array.from(weekValues(c.me, N, w * 7919, ASOF))); }
    cache.set(key, out); return out;
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const diff = (a: number[], b: number[]) => { const d = a.map((x, i) => x - b[i]); const m = mean(d); return { m, se: Math.sqrt(mean(d.map((x) => (x - m) ** 2)) / d.length) }; };

  // ---- stage 1: marginal values
  const meRoster = active(ME); const meBase = await simVals(ME, {}, N_SCREEN);
  const loseMe = new Map<string, number>(); for (const p of meRoster) loseMe.set(p, mean(meBase) - mean(await simVals(ME, { drop: [p] }, N_SCREEN)));
  const gainMe = new Map<string, number>();
  for (const rid of others) for (const p of active(rid)) gainMe.set(p, mean(await simVals(ME, { add: [p] }, N_SCREEN)) - mean(meBase));
  process.stderr.write(`stage 1 done ${(Date.now() - t0) / 1000}s\n`);
  const myCheapestDrop = (exclude: string[]) => meRoster.filter((p) => !exclude.includes(p) && !protectedMe(p)).sort((a, b) => loseMe.get(a)! - loseMe.get(b)!)[0];
  const theirCheapestDrop = (roster: string[]) => [...roster].sort((a, b) => ppg(a) + 0.3 * dv(a) - ppg(b) - 0.3 * dv(b))[0];

  // ---- stage 2: candidates
  type Cand = { rid: number; give: string[]; get: string[]; myDrop?: string; theirDrop?: string; screen: number; theyPerceive: number; kvRatio: number; theirProj: number };
  const cands: Cand[] = [];
  for (const rid of others) {
    const th = active(rid); const thBase = perceived(th);
    const gives: string[][] = []; for (const a of meRoster) { gives.push([a]); for (const b of meRoster) if (a < b) gives.push([a, b]); }
    const gets: string[][] = []; for (const a of th) { gets.push([a]); for (const b of th) if (a < b) gets.push([a, b]); }
    for (const give of gives) for (const get of gets) {
      if (give.length + get.length > 3) continue;
      const myDrop = get.length > give.length ? myCheapestDrop(give) : undefined;
      let theirRoster = th.filter((p) => !get.includes(p)).concat(give);
      const theirDrop = give.length > get.length ? theirCheapestDrop(theirRoster) : undefined;
      if (theirDrop) theirRoster = theirRoster.filter((p) => p !== theirDrop);
      if (theirDrop && give.includes(theirDrop)) continue; // he'd just cut what we sent
      const theyPerceive = perceived(theirRoster) - thBase;
      const kvIn = give.reduce((a, p) => a + kv(p), 0) - (theirDrop ? kv(theirDrop) : 0), kvOut = get.reduce((a, p) => a + kv(p), 0);
      const theirProj = projPts(theirRoster) - projPts(th);
      if (kvIn < KV_MIN * kvOut || theirProj < -3 || theyPerceive <= 0) continue; // must look fair-or-better to him
      const myPts = get.reduce((a, p) => a + gainMe.get(p)!, 0) - give.reduce((a, p) => a + loseMe.get(p)!, 0) - (myDrop ? loseMe.get(myDrop)! : 0);
      const myDyn = get.reduce((a, p) => a + dv(p), 0) - give.reduce((a, p) => a + dv(p), 0) - (myDrop ? dv(myDrop) : 0);
      const screen = myPts + DYN_W * myDyn;
      if (screen > 0) cands.push({ rid, give, get, myDrop, theirDrop, screen, theyPerceive, kvRatio: kvIn / Math.max(kvOut, 1e-9), theirProj });
    }
  }
  // keep the best few per team so the list isn't one team's variations
  const per = new Map<number, Cand[]>(); for (const c of cands.sort((a, b) => b.screen - a.screen)) { const l = per.get(c.rid) || []; if (l.length < Math.ceil(TOP / others.length) + 1) l.push(c); per.set(c.rid, l); }
  const short = [...per.values()].flat().sort((a, b) => b.screen - a.screen).slice(0, TOP);
  process.stderr.write(`stage 2: ${cands.length} candidates pass both screens, confirming ${short.length}  ${(Date.now() - t0) / 1000}s\n`);

  // ---- stage 3: paired full simulation for both teams
  const meFull = await simVals(ME, {}, N_FULL);
  const rows: any[] = [];
  for (const c of short) {
    const myEdit = { add: c.get, drop: [...c.give, ...(c.myDrop ? [c.myDrop] : [])] };
    const thEdit = { add: c.give.filter((p) => p !== c.theirDrop), drop: [...c.get, ...(c.theirDrop ? [c.theirDrop] : [])] };
    const me = diff(await simVals(ME, myEdit, N_FULL), meFull);
    const them = diff(await simVals(c.rid, thEdit, N_FULL), await simVals(c.rid, {}, N_FULL));
    const myDyn = c.get.reduce((a, p) => a + dv(p), 0) - c.give.reduce((a, p) => a + dv(p), 0) - (c.myDrop ? dv(c.myDrop) : 0);
    const meAfter = meRoster.filter((p) => !myEdit.drop.includes(p)).concat(c.get), thBefore = active(c.rid), thAfter = thBefore.filter((p) => !thEdit.drop.includes(p)).concat(thEdit.add);
    rows.push({ team: owner(c.rid), rid: c.rid, give: c.give.map(name), get: c.get.map(name), myDrop: c.myDrop && name(c.myDrop), theirDrop: c.theirDrop && name(c.theirDrop),
      myPts: me.m, mySe: me.se, myDyn, kvRatio: c.kvRatio, theirProj: c.theirProj, theirRealPts: them.m, theirSe: them.se, theyPerceive: c.theyPerceive,
      depthMe: [depth(meRoster), depth(meAfter)], depthThem: [depth(thBefore), depth(thAfter)],
      detail: { give: c.give.map((p) => ({ n: name(p), pos: pos(p).join("/"), ppg: +ppg(p).toFixed(1), age: P[p]?.age, adp: adp(p) })), get: c.get.map((p) => ({ n: name(p), pos: pos(p).join("/"), ppg: +ppg(p).toFixed(1), age: P[p]?.age, adp: adp(p) })) } });
  }
  const score = (r: any) => r.myPts + DYN_W * r.myDyn;
  const good = rows.filter((r) => r.myPts > 2 * r.mySe && r.myDyn > -15).sort((a, b) => score(b) - score(a));
  fs.writeFileSync(OUT, JSON.stringify({ generated: Date.now(), weeks: WEEKS, base: { me: mean(meFull) }, rows, good }, null, 1));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${rows.length} confirmed, ${good.length} clearly good for you`);
})();
