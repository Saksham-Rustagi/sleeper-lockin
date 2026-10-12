// Walk-forward backtest on the real 2025-26 season of league 'late night fun'.
// usage: npx tsx research/backtest.ts <weekFrom> <weekTo> <policyNames,comma> <out.json> [K]
import fs from "fs";
import * as E from "./engine";

const S = JSON.parse(fs.readFileSync(process.env.SEASON || "/root/sleeper/research/season.json", "utf8"));
const [wFrom, wTo, polNames, outFile, Karg] = process.argv.slice(2);
const K = Number(Karg ?? 200);

const POLICIES: Record<string, E.Policy> = {
  APP: { name: "APP", matching: "appGreedy", value: "rawMax", defer: false, reserve: false, chain: true },
  P1: { name: "P1", matching: "exact", value: "stop", defer: false, reserve: false, chain: true },
  P2: { name: "P2", matching: "exact", value: "stop", defer: true, reserve: true, chain: true },
  P2_NOCHAIN: { name: "P2_NOCHAIN", matching: "exact", value: "stop", defer: true, reserve: true, chain: false },
  P2_NORES: { name: "P2_NORES", matching: "exact", value: "stop", defer: true, reserve: false, chain: true },
  P3: { name: "P3", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "points", K, margin: 12 } },
  P4S: { name: "P4S", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "softwin", K, margin: 12 } },
  P3W: { name: "P3W", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "points", K, margin: 25 } },
  P4:  { name: "P4", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, rollout: { objective: "win", K, margin: 12 } },
};

// ---------- all games sorted, for walk-forward features ----------
type G = { pid: string; tip: number; actual: number; played: boolean; proj_sleeper: number | null; week: number };
const all: G[] = [];
for (const [w, gs] of Object.entries<any[]>(S.games)) for (const g of gs) all.push({ ...g, week: Number(w) });
all.sort((a, b) => a.tip - b.tip);
const byPid = new Map<string, G[]>();
for (const g of all) { if (!byPid.has(g.pid)) byPid.set(g.pid, []); byPid.get(g.pid)!.push(g); }

function projPre(g: G): number {
  if (g.proj_sleeper != null) return g.proj_sleeper;
  const hist = byPid.get(g.pid)!; let lastProj: number | null = null; const acts: number[] = [];
  for (const h of hist) { if (h.tip >= g.tip) break; if (h.proj_sleeper != null) lastProj = h.proj_sleeper; if (h.played) acts.push(h.actual); }
  if (lastProj != null) return lastProj;
  if (acts.length) return acts.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, acts.length);
  return 12;
}

interface Model { a: number; b: number; c: number; d: number; dnp: E.DnpModel }
function fitModel(week: number): Model {
  const train = all.filter((g) => g.week < week);
  if (train.length < 300) return { a: -1.5, b: 0.95, c: 40, d: 2.5, dnp: { p1: 0.93, p0: 0.4 } };
  const xy = train.filter((g) => g.played).map((g) => [projPre(g), g.actual]);
  const n = xy.length; const mx = xy.reduce((s, v) => s + v[0], 0) / n; const my = xy.reduce((s, v) => s + v[1], 0) / n;
  let sxy = 0, sxx = 0; for (const [x, y] of xy) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  // variance model: r^2 = c + d*mu
  const rr = xy.map(([x, y]) => { const mu = a + b * x; return [mu, (y - mu) ** 2]; });
  const m2 = rr.reduce((s, v) => s + v[0], 0) / n, r2 = rr.reduce((s, v) => s + v[1], 0) / n;
  let s2 = 0, q2 = 0; for (const [mu, e] of rr) { s2 += (mu - m2) * (e - r2); q2 += (mu - m2) ** 2; }
  const d = Math.max(0, s2 / q2), c = Math.max(10, r2 - d * m2);
  // DNP chain
  let pp = 0, pn = 0, mp = 0, mn = 0;
  for (const [, gs] of byPid) { let prev: boolean | null = null; for (const g of gs) { if (g.week >= week) break; if (prev !== null) { if (prev) { pn++; if (g.played) pp++; } else { mn++; if (g.played) mp++; } } prev = g.played; } }
  return { a, b, c, d, dnp: { p1: pn ? pp / pn : 0.93, p0: mn ? mp / mn : 0.4 } };
}

function teamWeek(week: number, rid: string, model: Model): { tw: E.TeamWeek; real: { actual: Float64Array; played: Uint8Array } } {
  const team = S.weeks.find((x: any) => x.week === week).teams[rid];
  const pids: string[] = team.players;
  const pidx = new Map(pids.map((p, i) => [p, i]));
  const wg = (S.games[String(week)] as any[]).filter((g) => pidx.has(g.pid)).sort((a, b) => a.tip - b.tip);
  const games: E.Game[] = wg.map((g) => {
    const pr = projPre({ ...g, week });
    const mu = model.a + model.b * pr; const sd = Math.sqrt(Math.max(9, model.c + model.d * mu));
    return { p: pidx.get(g.pid)!, tip: g.tip, end: g.tip + 2.5 * 3600e3, mu, sd, projRaw: pr, actual: g.actual, played: g.played };
  });
  const byPlayer: number[][] = pids.map(() => []);
  games.forEach((g, i) => byPlayer[g.p].push(i));
  const lastPlayed0 = pids.map((p) => { const h = (byPid.get(p) || []).filter((g) => g.week < week); return h.length ? (h[h.length - 1].played ? 1 : 0) : 1; });
  const slotNames: string[] = S.slots;
  const tw: E.TeamWeek = {
    slots: slotNames.map((s) => E.SLOT_MASK[s]), slotNames, pmask: pids.map((p) => E.posMask(S.players[p]?.pos || ["UTIL"])),
    names: pids.map((p) => S.players[p]?.name || p), games, byPlayer, lastPlayed0, dnp: model.dnp,
  };
  return { tw, real: { actual: Float64Array.from(games.map((g) => g.actual)), played: Uint8Array.from(games.map((g) => (g.played ? 1 : 0))) } };
}

const results: any[] = [];
const pols = polNames.split(",");
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
      const pol = POLICIES[pn]; const t0 = Date.now();
      const evs = E.buildEvents(tw, pol.chain);
      let hooks: E.Hooks | undefined;
      if (pol.rollout) {
        const base = POLICIES.P2;
        const o = oppOf.get(rid);
        const opp = o ? (() => { const ob = built.get(o)!; return { tw: ob.tw, events: E.buildEvents(ob.tw, true), pol: base, realised: ob.real }; })() : undefined;
        hooks = E.rolloutHooks(tw, base, evs, pol.rollout.objective, pol.rollout.K, pol.rollout.margin, week * 1000 + Number(rid), real, opp);
      }
      const res = E.simulate(tw, pol, evs, real.actual, real.played, E.initState(tw), 0, hooks);
      row[pn] = Math.round(res.total * 10) / 10; row[pn + "_ms"] = Date.now() - t0;
    }
    results.push(row);
    process.stderr.write(`w${week} r${rid} ${pols.map((p) => p + "=" + row[p]).join(" ")} human=${row.human} hs=${row.hindsight.toFixed(0)}\n`);
  }
}
fs.writeFileSync(outFile, JSON.stringify(results));
