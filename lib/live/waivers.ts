// Waiver / free-agent advisor: "add X, drop Y = +N pts", valued with the same Lock-In simulation as the
// lock decisions. Each roster variant is simulated over the rest of this week (from the live state) and all
// of next week, with common random numbers per player-game, so differences are paired and low-noise.
import * as E from "../engine/core";
import { gameDist, injuryPlayProb, fantasyPoints } from "../engine/model";
import { sleeper, type GameRow } from "./sources";
import { buildWeek, resolveWeek, POLICY, type LiveTeam } from "./week";
import { cachedCompute, fingerprint } from "./cache";
import { teamFingerprint, weekValues, parallelWeekValues } from "./teamsim";

export interface WaiverPlayer { pid: string; name: string; pos: string; team: string | null; age: number | null; injury: string | null; dynastyAdp: number | null; gamesThisWeek: number; gamesNextWeek: number; projPerGame: number | null; note?: string }
export interface WaiverMove { add: WaiverPlayer; drop: WaiverPlayer | null; gainThisWeek: number; gainNextWeek: number; total: number; se: number; confident: boolean }
export interface WaiverAdvice {
  generatedAt: number; week: number; nextWeek: number | null; rosterFull: boolean; openSpots: number;
  moves: WaiverMove[]; droppable: (WaiverPlayer & { loss: number; se: number; protected: boolean; reason: string | null })[];
  candidates: (WaiverPlayer & { gainNoDrop: number })[]; rules: string[]; notes: string[];
  cached?: boolean; checkedAt?: number;
}

export { weekValues } from "./teamsim";

export async function waiverAdvice(o: { leagueId: string; rosterId: number; protect?: string[]; N?: number; asOf?: number; maxCandidates?: number; force?: boolean }): Promise<WaiverAdvice> {
  const N = o.N ?? 2000; const asOf = o.asOf ?? Date.now(); // N: ±0.6 pts on a drop/add effect (300 gave ±1.7); spread over worker threads
  const league = await sleeper.league(o.leagueId); const season = league.season; const S = league.scoring_settings;
  const week = await resolveWeek(season, asOf);
  const sched = await sleeper.schedule(season);
  const nextWeek = sched.some((g) => g.week === week + 1) ? week + 1 : null;
  const [players, rosters, txs, sproj] = await Promise.all([
    sleeper.players(60 * 60e3), sleeper.rosters(o.leagueId), sleeper.transactions(o.leagueId, week).catch(() => []),
    sleeper.seasonProjections(season).catch(() => ({} as Record<string, Record<string, number>>)),
  ]);
  const projRows: GameRow[] = [
    ...(await sleeper.weekProjections(season, week).catch(() => [])),
    ...(nextWeek ? await sleeper.weekProjections(season, nextWeek).catch(() => []) : []),
  ];
  const me = rosters.find((r) => r.roster_id === o.rosterId)!;
  const rostered = new Set(rosters.flatMap((r) => [...(r.players || []), ...(r.taxi || []), ...(r.reserve || [])]));
  const benchSlots = league.roster_positions.filter((s) => s === "BN").length;
  const startSlots = league.roster_positions.filter((s) => !["BN", "IR", "TAXI"].includes(s)).length;
  const activeCount = (me.players || []).filter((p) => !(me.taxi || []).includes(p) && !(me.reserve || []).includes(p)).length;
  const openSpots = Math.max(0, startSlots + benchSlots - activeCount);
  const protect = new Set(o.protect || []);

  const wkOf = (date: string) => sched.find((g) => g.date === date)?.week;
  const info = (pid: string, extra?: Partial<WaiverPlayer>): WaiverPlayer => {
    const p = players[pid] as any; const rows = projRows.filter((r) => r.player_id === pid && r.stats && Object.keys(r.stats).length);
    const thisW = rows.filter((r) => wkOf(r.date) === week && Date.parse(r.date + "T23:59:00Z") > asOf).length;
    const nextW = rows.filter((r) => wkOf(r.date) === nextWeek).length;
    const pp = rows.length ? rows.reduce((a, r) => a + fantasyPoints(r.stats, S), 0) / rows.length : null;
    return { pid, name: p?.full_name || pid, pos: (p?.fantasy_positions || []).join("/"), team: p?.team ?? null, age: p?.age ?? null, injury: p?.injury_status ?? null,
      dynastyAdp: sproj[pid]?.adp_dynasty ?? null, gamesThisWeek: thisW, gamesNextWeek: nextW, projPerGame: pp === null ? null : Math.round(pp * 10) / 10, ...extra };
  };

  // ---- free-agent pool: expected value of their remaining games (this + next week) ----
  const byPid = new Map<string, number>();
  for (const r of projRows) {
    if (rostered.has(r.player_id) || !r.stats || !Object.keys(r.stats).length) continue;
    if (Date.parse(r.date + "T23:59:00Z") < asOf) continue;
    const p = players[r.player_id]; if (!p?.team) continue;
    const pk = injuryPlayProb(p.injury_status) ?? 0.91;
    byPid.set(r.player_id, (byPid.get(r.player_id) || 0) + pk * Math.max(0, gameDist(fantasyPoints(r.stats, S)).mu));
  }
  const recentlyDropped = new Map<string, number>();
  for (const t of txs) if (t.status === "complete" && t.drops) for (const pid of Object.keys(t.drops)) recentlyDropped.set(pid, Math.max(recentlyDropped.get(pid) || 0, t.created));
  const pool = [...byPid.entries()].sort((a, b) => b[1] - a[1]).slice(0, o.maxCandidates ?? 12).map(([pid]) => pid);

  // ---- recompute only if an input changed (rosters, projections, injuries, waiver status, my live state) ----
  const baseCtxNow = await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week, asOf, skipOpp: true });
  const rel = new Set([...pool, ...baseCtxNow.me.pids]);
  const fp = o.force ? String(Math.random()) : fingerprint({
    v: 6, N, week, nextWeek, protect: [...protect].sort(), pool, openSpots,
    rosters: rosters.map((r) => [r.roster_id, r.players, r.taxi, r.reserve]),
    proj: projRows.filter((r) => rel.has(r.player_id)).map((r) => [r.player_id, r.date, fantasyPoints(r.stats, S)]),
    inj: [...rel].map((p) => [p, players[p]?.injury_status ?? null]),
    dropped: [...recentlyDropped.entries()].filter(([p]) => rel.has(p)),
    me: teamFingerprint(baseCtxNow.me),
  });
  const res = await cachedCompute(`waivers-${o.leagueId}-${o.rosterId}`, fp, () => simulateWaivers());
  return { ...res.value, cached: res.cached, checkedAt: Date.now() };

  async function simulateWaivers(): Promise<WaiverAdvice> {
  // ---- simulate variants ----
  const variant = async (edit?: { add?: string[]; drop?: string[] }) => {
    const a = await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week, asOf, rosterEdit: edit, skipOpp: true });
    const b = nextWeek ? await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week: nextWeek, asOf, rosterEdit: edit, skipOpp: true }) : null;
    const [va, vb] = await Promise.all([parallelWeekValues(a.me, N, week * 7919, asOf), b ? parallelWeekValues(b.me, N, nextWeek! * 7919, asOf) : Promise.resolve(null)]);
    return { a: va, b: vb, ctx: a };
  };
  const base = await variant();
  const diff = (x: { a: Float64Array; b: Float64Array | null }) => {
    const d = Array.from({ length: N }, (_, k) => (x.a[k] - base.a[k]) + (x.b && base.b ? x.b[k] - base.b[k] : 0));
    const mean = d.reduce((s, v) => s + v, 0) / N; const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, N - 1));
    const da = Array.from(x.a).reduce((s, v, k) => s + v - base.a[k], 0) / N;
    const db = x.b && base.b ? Array.from(x.b).reduce((s, v, k) => s + v - base.b![k], 0) / N : 0;
    return { total: mean, se: sd / Math.sqrt(N), a: da, b: db };
  };

  // droppable: anyone active who isn't locked / playing / holding a lockable game this week
  const st = base.ctx.me.st; const T0 = base.ctx.me;
  const dropCands = T0.pids.filter((pid, i) => !st.isLocked[i] && st.inGame[i] < 0 && Number.isNaN(st.pendingX[i]));
  const droppable: WaiverAdvice["droppable"] = [];
  for (const pid of dropCands) {
    const d = diff(await variant({ drop: [pid] }));
    const inf = info(pid);
    const young = (inf.age ?? 99) <= 23 || (inf.dynastyAdp ?? 999) <= 120;
    droppable.push({ ...inf, loss: -d.total, se: d.se, protected: protect.has(pid) || young, reason: protect.has(pid) ? "protected by you" : young ? `dynasty asset (age ${inf.age ?? "?"}, ADP ${inf.dynastyAdp ? Math.round(inf.dynastyAdp) : "?"})` : null });
  }
  droppable.sort((x, y) => x.loss - y.loss);
  const dropPick = droppable.filter((d) => !d.protected).slice(0, 3);

  const candidates: WaiverAdvice["candidates"] = [];
  for (const pid of pool) {
    const d = diff(await variant({ add: [pid] }));
    const dropped = recentlyDropped.get(pid);
    const note = dropped && asOf - dropped < 2 * 86400e3 ? `on waivers until ${new Date(dropped + 2 * 86400e3).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric" })} (claim)` : "free agent: add before his next tip-off (waiver-locked once his game starts)";
    candidates.push({ ...info(pid, { note }), gainNoDrop: d.total });
  }
  candidates.sort((a, b) => b.gainNoDrop - a.gainNoDrop);

  const moves: WaiverMove[] = [];
  for (const c of candidates.slice(0, 6)) {
    if (openSpots > 0) {
      const d = diff(await variant({ add: [c.pid] }));
      moves.push({ add: c, drop: null, gainThisWeek: d.a, gainNextWeek: d.b, total: d.total, se: d.se, confident: d.total > Math.max(1, 2 * d.se) });
    }
    for (const dr of dropPick) {
      const d = diff(await variant({ add: [c.pid], drop: [dr.pid] }));
      moves.push({ add: c, drop: dr, gainThisWeek: d.a, gainNextWeek: d.b, total: d.total, se: d.se, confident: d.total > Math.max(1, 2 * d.se) });
    }
  }
  moves.sort((a, b) => b.total - a.total);
  const rules = [
    "Dropped players sit on waivers for 2 days (claims by rolling priority).",
    "Free agents become waiver-locked once their game starts — add before tip-off.",
    `Roster: ${activeCount}/${startSlots + benchSlots} active spots used${openSpots ? `, ${openSpots} open` : " (full: every add needs a drop)"}; taxi and IR don't count.`,
  ];
  const notes = [`Values = change in expected Lock-In points over the rest of week ${week}${nextWeek ? ` + week ${nextWeek}` : ""}, ${N} paired simulations each. "±" is the simulation noise; only moves clearly above it are marked worth doing.`,
    "Players aged ≤23 or with dynasty ADP ≤120 are never suggested as drops (dynasty value). Protect others from the list below."];
  return { generatedAt: Date.now(), week, nextWeek, rosterFull: openSpots === 0, openSpots, moves: moves.slice(0, 12), droppable, candidates, rules, notes };
  }
}
