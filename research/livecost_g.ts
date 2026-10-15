// Task G: latency the live app sees with engine p10b (decisions by P10b, mass simulations by POLICY) vs p7h, on the
// real league data. One view per process (fresh memory caches); disk cache dir = env LOCKIN_CACHE_DIR (the runner
// decides cold / warm); worker threads as in the app (env LOCKIN_SIMWORKER).
// usage: node research/dist/livecost_g.cjs <view> <out.json>
//   info | advise-now | advise-tue | tick | league | waivers | ir | replay
//   advise-*: advise() twice in one process (cold, then warm from the memory cache) - the web request /api/advise
//   tick: the notifier's advise (K = 250) 10 min before a tip-off with held scores (state simulated forward, below)
import fs from "fs";
import * as E from "../lib/engine/core";
import { buildWeek, resolveWeek, POLICY, etDate, type LiveTeam, type WeekContext } from "../lib/live/week";
import { advise, computeAdvice, replay } from "../lib/live/advise";
import { teamSims } from "../lib/live/teamsim";
import { waiverAdvice } from "../lib/live/waivers";
import { leagueWeek } from "../lib/live/league";
import { irAdvice } from "../lib/live/ir";
import { engineName } from "../lib/live/engine";
import { sleeper } from "../lib/live/sources";
import os from "os";

const LEAGUE = process.env.LEAGUE || "1344387394811490304", ROSTER = Number(process.env.ROSTER || 8);
const [view, out] = [process.argv[2], process.argv[3]];
const now = () => performance.now();
const load = () => os.loadavg().map((x) => Math.round(x * 100) / 100);

// week 1's dates and my team's tip-offs
async function week1() {
  const league = await sleeper.league(LEAGUE);
  const sched = await sleeper.schedule(league.season);
  const dates = [...new Set(sched.filter((g) => g.week === 1).map((g) => g.date))].sort();
  return { league, dates };
}
// Tuesday of week 1, noon ET (before any tip-off)
async function tuesdayNoon() {
  const { dates } = await week1();
  const tue = dates.find((d) => new Date(d + "T12:00:00Z").getUTCDay() === 2) ?? dates[0];
  return Date.parse(tue + "T16:00:00Z");
}

// Move a live team forward to time t along one sampled scenario, played by POLICY (stands in for what happened before
// the tick): games finished by t become "post" with the sampled score, games under way "in"; state, event index and
// Sleeper lineup follow.
function advance(T: LiveTeam, from: number, t: number, seed: number) {
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
  T.lockSource = T.tw.slots.map((_, s) => (T.st.lockedBy[s] >= 0 ? "sim" : null));
}

(async () => {
  const row: any = { engine: engineName(), view, at: new Date().toISOString(), cacheDir: process.env.LOCKIN_CACHE_DIR ?? null, load0: load() };
  if (view === "info") {
    const { league, dates } = await week1();
    const tue = await tuesdayNoon();
    const ctx = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf: tue });
    row.result = { season: league.season, week: ctx.week, dates, tue: new Date(tue).toISOString(), myGames: ctx.me.games.length, oppGames: ctx.opp?.games.length ?? null,
      tips: [...new Set(ctx.me.games.map((g) => g.tip))].sort().map((t) => new Date(t).toISOString()), prev: league.previous_league_id ?? null };
  } else if (view === "advise-now" || view === "advise-tue") {
    const asOf = view === "advise-tue" ? await tuesdayNoon() : undefined;
    let t = now(); const ctx = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf }); row.buildMs = now() - t; // network, fills the source caches
    const K = Number(process.env.K || 300);
    t = now(); const a = await advise({ leagueId: LEAGUE, rosterId: ROSTER, asOf, K }); row.coldMs = now() - t; row.coldCached = a.cached;
    t = now(); const b = await advise({ leagueId: LEAGUE, rosterId: ROSTER, asOf, K }); row.warmMs = now() - t; row.warmCached = b.cached;
    row.result = { week: a.week, asOf: new Date(a.asOf).toISOString(), gamesLeft: ctx.me.games.filter((g) => g.status === "pre").length, decisions: a.decisions.length,
      plan: a.plan.map((p) => ({ when: p.when, starts: p.starts.map((s) => `${s.player}@${s.slot}${s.lockIf !== null ? ` lock>=${s.lockIf}` : ""}`), benched: p.benched.map((x) => x.player) })),
      outlook: a.outlook, actions: a.actions };
  } else if (view === "tick") {
    // the busiest day of week 1 for my team after the first, 10 min before my team's first tip-off that day
    const { dates } = await week1(); const tue = await tuesdayNoon();
    const ctx0 = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf: tue });
    const byDate = new Map<string, number[]>(); for (const g of ctx0.me.games) { if (!byDate.has(g.date)) byDate.set(g.date, []); byDate.get(g.date)!.push(g.tip); }
    const day = process.env.DAY || [...byDate.entries()].filter(([d]) => d !== dates[0]).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0][0];
    const tip = Math.min(...byDate.get(day)!); const t = tip - 10 * 60e3;
    // (built at Tuesday noon, so the simulated days before the tick are played, then moved to the tick)
    const ctx: WeekContext = await buildWeek({ leagueId: LEAGUE, rosterId: ROSTER, asOf: tue });
    for (const [T, s] of [[ctx.me, 101], [ctx.opp, 202]] as const) if (T) advance(T, tue, t, s);
    ctx.asOf = t;
    row.state = { day, tick: new Date(t).toISOString(), held: ctx.me.pids.filter((_, p) => !Number.isNaN(ctx.me.st.pendingX[p]) && !ctx.me.st.isLocked[p]).map((pid) => ctx.me.names[ctx.me.pids.indexOf(pid)]),
      locked: Array.from(ctx.me.st.lockedBy).filter((p) => p >= 0).length, tipsIn30h: new Set(ctx.me.games.filter((g) => g.tip > t && g.tip < t + 30 * 3600e3).map((g) => g.tip)).size };
    let t0 = now(); const [ms, os2] = await Promise.all([teamSims(ctx.me, ctx.week, t), ctx.opp ? teamSims(ctx.opp, ctx.week, t) : Promise.resolve(null)]); row.simsMs = now() - t0;
    t0 = now(); const a = await computeAdvice(ctx, Number(process.env.K || 250), ms, os2); row.adviceMs = now() - t0;
    row.coldMs = row.simsMs + row.adviceMs;
    row.result = { decisions: a.decisions.map((d) => ({ player: d.player, score: d.score, rec: d.recommended, slot: d.recommendedSlot, reason: d.reason, options: d.options.map((o) => `${o.action}${o.slot ? "@" + o.slot : ""} ${o.expPoints.toFixed(1)}`) })),
      plan: a.plan.map((p) => ({ when: p.when, starts: p.starts.map((s) => `${s.player}@${s.slot}${s.lockIf !== null ? ` lock>=${s.lockIf}` : ""}`), holds: p.holds.map((h) => `${h.player} ${h.score.toFixed(1)}@${h.slot}`), forfeits: p.forfeits.map((f) => f.player) })),
      outlook: a.outlook };
  } else if (view === "league") {
    let t = now(); const a = await leagueWeek({ leagueId: LEAGUE, rosterId: ROSTER }); row.coldMs = now() - t; row.coldCached = a.cached;
    t = now(); const b = await leagueWeek({ leagueId: LEAGUE, rosterId: ROSTER }); row.warmMs = now() - t; row.warmCached = b.cached;
    row.result = { week: a.week, matchups: a.matchups.map((m) => `${m.a.name} ${m.a.mean.toFixed(1)} vs ${m.b?.name} ${m.b?.mean.toFixed(1)} (${m.winA === null ? "-" : (m.winA * 100).toFixed(1)}%)`) };
  } else if (view === "waivers") {
    let t = now(); const w = await waiverAdvice({ leagueId: LEAGUE, rosterId: ROSTER }); row.coldMs = now() - t; row.coldCached = (w as any).cached;
    t = now(); const w2 = await waiverAdvice({ leagueId: LEAGUE, rosterId: ROSTER }); row.warmMs = now() - t; row.warmCached = (w2 as any).cached;
    row.result = { moves: w.moves.slice(0, 5).map((m) => `${m.add.name} for ${m.drop?.name ?? "-"} ${m.total.toFixed(2)}`) };
  } else if (view === "ir") {
    let t = now(); const r = await irAdvice({ leagueId: LEAGUE, rosterId: ROSTER }); row.coldMs = now() - t; row.coldCached = r.cached;
    t = now(); const r2 = await irAdvice({ leagueId: LEAGUE, rosterId: ROSTER }); row.warmMs = now() - t; row.warmCached = r2.cached;
    row.result = { actions: r.actions.map((a) => a.kind + ": " + a.title) };
  } else if (view === "replay") {
    const league = await sleeper.league(LEAGUE); const prev = process.env.REPLAY_LEAGUE || league.previous_league_id!;
    const week = Number(process.env.WEEK || 5);
    let t = now(); const r = await replay({ leagueId: prev, rosterId: ROSTER, week }); row.coldMs = now() - t;
    t = now(); await replay({ leagueId: prev, rosterId: ROSTER, week }); row.warmMs = now() - t;
    row.result = { league: prev, week, team: r.team, appTotal: r.appTotal, humanTotal: r.humanTotal, hindsight: r.hindsight, decisions: r.log.length };
  } else throw new Error("unknown view " + view);
  row.load1 = load();
  fs.writeFileSync(out, JSON.stringify(row, null, 1));
  console.log(JSON.stringify({ engine: row.engine, view, coldMs: Math.round(row.coldMs ?? 0), warmMs: row.warmMs !== undefined ? Math.round(row.warmMs) : undefined, coldCached: row.coldCached, warmCached: row.warmCached, load: row.load0 }));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
