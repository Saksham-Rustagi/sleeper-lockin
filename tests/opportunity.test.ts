import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
// isolate from the real ~/.sleeper-lockin/config.json
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "opp-cfg-"));
process.env.LOCKIN_CONFIG_DIR = CFG; delete process.env.LOCKIN_MINUTES_OVERRIDE; delete process.env.LOCKIN_OPPORTUNITY_ALERTS;
import * as O from "../lib/live/opportunity";
import { espnStats, parseSummary, normName, pidMatcher, boxRows, collectBoxScores } from "../lib/live/boxscores";
import { optionOn, resetOptionCache, setOverrideHash, overrideTag } from "../lib/live/override";
import { fingerprint } from "../lib/live/cache";
import { reportAlerts, overrideHashOf, minutesOverrides } from "../lib/live/oppscan";
import { fantasyPoints } from "../lib/engine/model";

const SCORING = { ast: 1, blk: 3, bonus_ast_15p: 3, bonus_pt_50p: 5, bonus_reb_20p: 3, dd: 2, ff: -1, fga: -1, fgm: 1, ftmi: -1, pf: -1, pts: 1, reb: 1, stl: 3, td: 5, tf: -1, to: -1, tpm: 0.5 };
const DAY = 86400e3, T0 = Date.parse("2026-11-01T23:00:00Z");

// team AAA, 12 games: star S (PG, 32 min) misses games 4-5 and is out from game 12 on; backup B (PG) plays 24 min when
// S is out, 8 otherwise; wing W (SF) 30 min always; deep bench D (C) 0-2 min
function hist(): O.Hist {
  const rows: (O.PGame & { pid: string })[] = [];
  for (let i = 0; i < 11; i++) {
    const key = `g${i}`, tip = T0 + i * 2 * DAY, date = new Date(tip).toISOString().slice(0, 10);
    const sOut = i === 3 || i === 4;
    const add = (pid: string, min: number) => rows.push({ pid, key, date, tip, team: "AAA", pre: false, min, fp: min * 1.0, played: min > 0 });
    add("S", sOut ? 0 : 32); add("B", sOut ? 24 : i >= 9 ? 9 : 8); add("W", 30); add("D", i % 3 === 0 ? 2 : 0);
  }
  return O.histFrom(rows);
}
const META: O.Meta = { positions: { S: ["PG"], B: ["PG"], W: ["SF"], D: ["C"] } };

test("detector: the same-position backup who played more without the star ranks first", () => {
  const h = hist(); const T = T0 + 11 * 2 * DAY;
  const a = O.replacementCandidates(h, "S", T, META)!;
  assert.equal(a.team, "AAA"); assert.ok(a.mpg >= 30);
  assert.equal(a.candidates[0].pid, "B");
  const b = a.candidates[0];
  assert.ok(b.gain >= 4, `backup gain ${b.gain}`); assert.ok(b.wo.n === 2 && (b.wo.delta ?? 0) > 10, "with/without history seen");
  assert.ok(b.expMin > b.base && b.est > 0 && Math.abs(b.est - b.rate * b.expMin) < 0.2);
  assert.ok(b.why.includes("same position"));
  const w = a.candidates.find((c) => c.pid === "W")!; assert.ok(w.gain < b.gain, "30-mpg wing absorbs less");
  // depth chart: next behind the absent player at his depth position gets +depthMin
  const d = O.replacementCandidates(h, "S", T, { ...META, depth: { S: { pos: "PG", order: 1 }, D: { pos: "PG", order: 2 } } })!;
  assert.ok(Math.abs(d.candidates.find((c) => c.pid === "D")!.gain - a.candidates.find((c) => c.pid === "D")!.gain - O.OPP.depthMin) < 0.11);
  assert.equal(O.replacementCandidates(h, "nobody", T, META), null);
});

test("position overlap", () => {
  assert.equal(O.posOverlap(["PG"], ["PG", "SG"]), 1);
  assert.equal(O.posOverlap(["SG"], ["PG"]), 0.6);
  assert.equal(O.posOverlap(["SF"], ["SG"]), 0.3);
  assert.equal(O.posOverlap(["C"], ["PG"]), 0.1);
});

// a free agent: 8-10 min for 10 games, then 28 min in the last 3
function surgeHist(last3: number[]) {
  const rows: (O.PGame & { pid: string })[] = [];
  for (let i = 0; i < 13; i++) {
    const key = `g${i}`, tip = T0 + i * 2 * DAY, date = new Date(tip).toISOString().slice(0, 10);
    const min = i >= 10 ? last3[i - 10] : 9;
    rows.push({ pid: "F", key, date, tip, team: "BBB", pre: false, min, fp: min * 0.95, played: min > 0 });
    rows.push({ pid: "X", key, date, tip, team: "BBB", pre: false, min: 30, fp: 30, played: true });
  }
  return O.histFrom(rows);
}
test("surge watch flags minutes well above Sleeper's projection, not otherwise", () => {
  const T = T0 + 13 * 2 * DAY;
  const s = O.surge(surgeHist([28, 30, 29]), "F", T, { min: 10, fp: 8 })!;
  assert.ok(s.flagged, s.why); assert.equal(s.last3, 29); assert.ok(s.est >= O.OPP.surgeFp && s.est >= 8 + O.OPP.surgeEdge);
  assert.ok(s.expMin < s.last3, "expected minutes regress toward the longer average");
  assert.ok(!O.surge(surgeHist([28, 30, 29]), "F", T, { min: 26, fp: 22 })!.flagged, "Sleeper already projects the minutes");
  assert.ok(!O.surge(surgeHist([28, 0, 29]), "F", T, { min: 10, fp: 8 })!.flagged, "a DNP in the last 3");
  assert.ok(O.surge(surgeHist([28, 30, 29]), "F", T, { min: null, fp: null })!.flagged, "no projection = Sleeper shows 0");
});

test("overrides: replacement beats surge, only-raise never lowers a projection, labels", () => {
  const h = hist(); const T = T0 + 11 * 2 * DAY;
  const a = O.replacementCandidates(h, "S", T, META)!;
  const sg = O.surge(surgeHist([28, 30, 29]), "F", T0 + 13 * 2 * DAY, { min: 10, fp: 8 })!;
  const ov = O.buildOverrides([a], [sg, { ...sg, pid: "B" }], { S: "Star" });
  assert.equal(ov.B.source, "replacement"); assert.ok(ov.B.label.startsWith("projection override: based on last 5 games")); assert.ok(ov.B.label.includes("Star out"));
  assert.equal(ov.F.source, "surge"); assert.ok(ov.F.label.includes("based on last 3 games"));
  const raised = O.buildOverrides([a], [sg], {}, O.OPP, (pid) => (pid === "B" ? 99 : null));
  assert.equal(raised.B, undefined, "estimate below Sleeper's projection: no override"); assert.ok(raised.F);
});

test("alerts: free agent / my player texts, dedupe, newly-out bookkeeping", () => {
  const h = hist(); const T = T0 + 11 * 2 * DAY;
  const a = O.replacementCandidates(h, "S", T, META)!;
  a.candidates[0].est = 21.3; a.candidates[0].gain = Math.max(a.candidates[0].gain, 5);
  const ctx = (fa: string[], mine: string[]): O.AlertCtx => ({ names: { S: "Star Guard", B: "Backup Guard" }, teams: { B: "AAA" }, freeAgents: new Set(fa), mine: new Set(mine),
    nextTip: () => Date.parse("2026-11-24T00:00:00Z"), sleeperProj: () => null, fmtTime: () => "Mon 7:00 PM" });
  const al = O.opportunityAlerts([{ ...a, since: 123 }], [], ctx(["B"], []));
  assert.equal(al.length, 1);
  assert.equal(al[0].title, `🚀 Opportunity: Backup Guard (AAA) - Star Guard out, ${a.candidates[0].last3} mpg last 3, ~21.3 fp/g est, free agent in your league - add before Mon 7:00 PM`);
  assert.match(al[0].body, /^Why: #1 to absorb Star Guard's/);
  assert.equal(al[0].key, "opp|B|S|123");
  assert.equal(O.opportunityAlerts([a], [], ctx([], [])).length, 0, "rostered elsewhere: no alert");
  const mine = O.opportunityAlerts([a], [], ctx([], ["B"])); assert.equal(mine.length, 1); assert.match(mine[0].title, /Role up: Backup Guard .*\(yours\) - start him/);
  a.candidates[0].est = 12; assert.equal(O.opportunityAlerts([a], [], ctx(["B"], [])).length, 0, "estimate below the alert floor");
  // dedupe
  assert.equal(O.newAlerts(al, { [al[0].key]: 1 }).length, 0); assert.equal(O.newAlerts([...al, ...al], {}).length, 1);
  // newly out: first run marks current absences old; a new absence is fresh; flapping within 36 h keeps since
  const now = Date.parse("2026-11-20T15:00:00Z");
  let st = O.updateSince({}, ["S"], now, true); assert.equal(st.S.since, 0); assert.ok(!O.isFresh(st.S.since, now));
  st = O.updateSince(st, ["S", "Q"], now + 3600e3); assert.equal(st.Q.since, now + 3600e3); assert.ok(O.isFresh(st.Q.since, now + 2 * 3600e3));
  st = O.updateSince(st, ["S"], now + 10 * 3600e3); st = O.updateSince(st, ["S", "Q"], now + 20 * 3600e3); assert.equal(st.Q.since, now + 3600e3, "back out within 36 h");
  st = O.updateSince(st, [], now + 80 * 3600e3); assert.equal(st.Q, undefined);
  assert.ok(!O.isFresh(now - 4 * DAY, now));
});

test("reportAlerts builds alerts from a scan report (fresh filter)", () => {
  const cand: any = { pid: "B", name: "Backup Guard", team: "AAA", status: "fa", injury: null, sleeperProj: null, nextTip: null, gain: 6, est: 18, last3: 20, expMin: 24, why: "x" };
  const r: any = { absences: [{ pid: "S", name: "Star Guard", team: "AAA", injury: "Out", mpg: 32, missedBefore: 0, since: 5, candidates: [cand] }], surges: [] };
  assert.equal(reportAlerts(r).length, 1);
  assert.equal(reportAlerts(r, () => false).length, 0);
  assert.equal(reportAlerts({ ...r, absences: [{ ...r.absences[0], candidates: [{ ...cand, injury: "Out" }] }] }).length, 0, "an injured free agent is no opportunity");
});

test("ESPN box cells -> Sleeper stat keys -> league fantasy points", () => {
  const keys = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks", "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus"];
  const s = espnStats(keys, ["34", "24", "9-17", "2-6", "4-5", "11", "3", "2", "1", "2", "3", "8", "3", "+7"]);
  assert.deepEqual([s.sp, s.pts, s.fgm, s.fga, s.tpm, s.ftm, s.fta, s.ftmi, s.reb, s.dd, s.td, s.gp], [2040, 24, 9, 17, 2, 4, 5, 1, 11, 1, undefined, 1]);
  // 24 + 11 + 3 + 3*1 + 3*2 - 2 + 9 - 17 - 1 - 3 + 0.5*2 + 2 (dd) = 36
  assert.equal(fantasyPoints(s, SCORING), 36);
  const j = { boxscore: { players: [{ team: { abbreviation: "GS" }, statistics: [{ keys, athletes: [
    { athlete: { id: "1", displayName: "Al Horford" }, starter: false, didNotPlay: false, stats: ["21", "8", "3-6", "2-4", "0-0", "6", "2", "1", "0", "1", "1", "5", "2", "+3"] },
    { athlete: { id: "2", displayName: "Moses Moody" }, starter: false, didNotPlay: true, reason: "COACH'S DECISION", stats: [] }] }] }] } };
  const g = parseSummary(j, { id: "9", date: "2026-10-14", tip: 1, seasonType: 1 });
  assert.equal(g.preseason, true); assert.deepEqual(g.teams, ["GSW"]);
  assert.equal(g.box.GSW[0].min, 21); assert.equal(g.box.GSW[1].dnp, true); assert.equal(g.box.GSW[1].reason, "COACH'S DECISION");
});

test("ESPN names -> Sleeper ids (suffixes, accents, same name on two teams)", () => {
  assert.equal(normName("Brandon Boston Jr."), "brandonboston"); assert.equal(normName("Nikola Jokić"), "nikolajokic"); assert.equal(normName("Kel'el Ware"), "kelelware");
  const players: any = { "10": { full_name: "Brandon Boston", team: "CHI" }, "11": { full_name: "Jalen Williams", team: "OKC" }, "12": { full_name: "Jalen Williams", team: "DEN" }, "13": { full_name: "Nikola Jokic", team: "DEN" } };
  const m = pidMatcher(players);
  assert.equal(m("Brandon Boston Jr.", "CHI"), "10"); assert.equal(m("Nikola Jokić", "DEN"), "13");
  assert.equal(m("Jalen Williams", "DEN"), "12"); assert.equal(m("Jalen Williams", "LAL"), null); assert.equal(m("Nobody Here", "DEN"), null);
  const store: any = { v: 1, season: "2026", days: {}, games: { "9": { id: "9", date: "2026-10-14", tip: 5, preseason: true, seasonType: 1, teams: ["DEN"], box: { DEN: [{ name: "Nikola Jokić", dnp: false, min: 30, stats: { pts: 30, sp: 1800 } }, { name: "Who Dat", dnp: true, min: 0, stats: {} }] } } } };
  const { rows, unmatched } = boxRows(store, players, SCORING);
  assert.equal(rows.length, 1); assert.equal(rows[0].pid, "13"); assert.equal(rows[0].pre, true); assert.equal(rows[0].fp, 30); assert.deepEqual(unmatched, ["Who Dat (DEN)"]);
});

test("box-score store: completed games fetched once, days marked complete", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "box-"));
  const keys = ["minutes", "points"];
  const sb = { events: [{ id: "77", date: "2026-10-14T23:30:00Z", season: { type: 1 }, status: { type: { state: "post", shortDetail: "Final" } }, competitions: [{ competitors: [{ score: "100", team: { abbreviation: "MIA" } }, { score: "99", team: { abbreviation: "BKN" } }] }] }] };
  const summary = { boxscore: { players: [{ team: { abbreviation: "MIA" }, statistics: [{ keys, athletes: [{ athlete: { id: "1", displayName: "A B" }, starter: true, didNotPlay: false, stats: ["30", "20"] }] }] }] } };
  const realFetch = globalThis.fetch; let sbCalls = 0;
  globalThis.fetch = (async (url: string) => { if (String(url).includes("scoreboard")) { sbCalls++; return { ok: true, json: async () => sb } as any; } throw new Error("unexpected " + url); }) as any;
  try {
    let n = 0; const fetchJson = async () => { n++; return summary; };
    const now = Date.parse("2026-10-16T16:00:00Z");
    const a = await collectBoxScores({ season: "2026", from: "2026-10-14", to: "2026-10-14", dir, now, fetchJson });
    assert.equal(a.fetched, 1); assert.equal(n, 1); assert.ok(a.store.games["77"].preseason); assert.ok(a.store.days["2026-10-14"]);
    assert.equal(a.store.games["77"].box.MIA[0].min, 30);
    const b = await collectBoxScores({ season: "2026", from: "2026-10-14", to: "2026-10-14", dir, now, fetchJson });
    assert.equal(b.fetched, 0); assert.equal(n, 1, "completed game not fetched again");
    assert.ok(fs.existsSync(path.join(dir, "boxscores", "2026.json")));
    assert.ok(sbCalls >= 1);
  } finally { globalThis.fetch = realFetch; }
});

test("config switches default off; fingerprints unchanged when off, include the override hash when on", async () => {
  resetOptionCache();
  assert.equal(optionOn("minutesOverride"), false); assert.equal(optionOn("opportunityAlerts"), false); assert.equal(overrideTag(), null);
  const x = { week: 3, v: [1, 2] }; const off = fingerprint(x); setOverrideHash("abc"); assert.equal(fingerprint(x), off, "option off: hash ignored");
  fs.writeFileSync(path.join(CFG, "config.json"), JSON.stringify({ minutesOverride: true, opportunityAlerts: true })); resetOptionCache();
  assert.equal(optionOn("minutesOverride"), true); assert.equal(optionOn("opportunityAlerts"), true);
  setOverrideHash("abc"); const on1 = fingerprint(x); setOverrideHash("def"); const on2 = fingerprint(x);
  assert.notEqual(on1, off); assert.notEqual(on1, on2);
  process.env.LOCKIN_MINUTES_OVERRIDE = "0"; assert.equal(optionOn("minutesOverride"), false, "env wins"); assert.equal(fingerprint(x), off);
  delete process.env.LOCKIN_MINUTES_OVERRIDE; fs.unlinkSync(path.join(CFG, "config.json")); resetOptionCache();
  // off: no scan, no network
  const realFetch = globalThis.fetch; globalThis.fetch = (async () => { throw new Error("network used"); }) as any;
  try { assert.equal(await minutesOverrides("L1"), null); } finally { globalThis.fetch = realFetch; }
  // the hash depends on the override values only
  const ov = { B: { pid: "B", perGame: 18.04, expMin: 25, rate: 0.7, n: 5, source: "replacement" as const, label: "x" } };
  assert.equal(overrideHashOf(ov), overrideHashOf({ B: { ...ov.B, label: "y" } })); assert.notEqual(overrideHashOf(ov), overrideHashOf({ B: { ...ov.B, perGame: 19 } }));
  assert.equal(overrideHashOf(null), null);
});
