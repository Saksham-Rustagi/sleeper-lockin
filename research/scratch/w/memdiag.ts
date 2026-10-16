// Memory of the race workers after a P10b week (random 9-slot week, 7 game days): process RSS, per-worker V8 heap.
// usage: node research/dist/memdiag.cjs <simworker.cjs> [workers]
import * as E from "../../../lib/engine/core";
import { p10Hooks } from "../../../lib/engine/p10";
import { createRacePool } from "../../../lib/live/racepool";
import { priceStats } from "../../../lib/engine/p8";
const H = 3600e3, T0 = Date.parse("2026-10-26T23:00:00Z");
const POS = [["PG"], ["SG"], ["PG", "SG"], ["SF"], ["PF"], ["SF", "PF"], ["C"], ["PF", "C"]];
const r = E.rng(5); const games: E.Game[] = []; const n = 14;
const players = Array.from({ length: n }, () => ({ pos: POS[Math.floor(r() * POS.length)], games: [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.55).map((d) => ({ tip: T0 + d * 24 * H + Math.floor(r() * 4) * H, mu: 10 + Math.round(r() * 30), actual: Math.round(r() * 55 - 3) })) }));
players.forEach((p, i) => p.games.forEach((g) => games.push({ p: i, tip: g.tip, end: g.tip + 2.5 * H, mu: g.mu, sd: 8, projRaw: g.mu, actual: g.actual, played: true })));
games.sort((a, b) => a.tip - b.tip); const byPlayer = players.map(() => [] as number[]); games.forEach((g, i) => byPlayer[g.p].push(i));
const slots = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"];
const tw: E.TeamWeek = { slots: slots.map((s) => E.SLOT_MASK[s]), slotNames: slots, pmask: players.map((p) => E.posMask(p.pos)), names: players.map((_, i) => `P${i}`), games, byPlayer, lastPlayed0: players.map(() => 1), dnp: { p1: 0.92, p0: 0.4 } };
const TOP: E.Policy = { name: "P8", matching: "exact", value: "stop", defer: true, reserve: false, chain: true, index: { resolve: "tip", iters: 100 } };
const B8: E.Policy = { ...TOP, index: { resolve: "tip", iters: 100, slot: "roll" } };
const mb = (x: number) => Math.round(x / 1048576);
(async () => {
  const nw = Number(process.argv[3] ?? 12); const pool = nw > 0 ? createRacePool(process.argv[2], nw, console.log)! : null; const c0 = process.cpuUsage();
  const ev = E.buildEvents(tw, true); const re = { actual: Float64Array.from(games.map((g) => g.actual)), played: Uint8Array.from(games.map(() => 1)) };
  const h = p10Hooks(tw, B8, ev, 1, re, {}, undefined, { pool });
  const t0 = performance.now(); const tot = E.simulate(tw, TOP, ev, re.actual, re.played, E.initState(tw), 0, h).total;
  console.log(`total ${tot.toFixed(2)} in ${((performance.now() - t0) / 1000).toFixed(1)} s, raced ${h.stats.raced}, sims ${h.stats.sims}`);
  const cu = process.cpuUsage(c0); console.log(`cpu ${((cu.user + cu.system) / 1e6).toFixed(1)} s, solves ${JSON.stringify(priceStats(tw))}`);
  const hs = pool ? await pool.heap() : []; const m = process.memoryUsage();
  console.log(`rss ${mb(m.rss)} MB, main heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} MB, workers used/total MB: ${hs.map((x) => `${mb(x.used)}/${mb(x.total)}`).join(" ")}`);
  await pool?.close(); process.exit(0);
})();
