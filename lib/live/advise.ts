// Advisor: turns a WeekContext into concrete recommendations.
//  - decisions: for each lockable (pending) starter: LOCK (slot) / HOLD / BENCH, evaluated by Monte-Carlo rollout
//    over the rest of the week for BOTH teams (common random numbers); reports expected points and win probability.
//  - plan: lineup for each upcoming tip-off in the next ~30h + "lock if >= X" cut-off for every starter.
//  - outlook: projected totals and win probability from simulating both teams' weeks.
//  - replay: run the full strategy over a finished week with the real results and log every decision.
import * as E from "../engine/core";
import { buildWeek, POLICY, etDate, type WeekContext, type LiveTeam } from "./week";

const fmtTime = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);

export interface Decision {
  player: string; pid: string; score: number; deadline: number | null; deadlineText: string;
  options: { action: string; slot: string | null; expPoints: number; winProb: number | null }[];
  recommended: string; recommendedSlot: string | null; threshold: number | null; reason: string;
}
export interface TipPlan { tip: number; when: string; starts: { slot: string; player: string; pid: string; proj: number; lockIf: number | null }[]; benched: { player: string; proj: number }[]; tentative: boolean }
export interface Advice {
  generatedAt: number; asOf: number; mode: "live" | "replay"; league: string; season: string; week: number; dates: string[];
  me: TeamView; opp: TeamView | null; outlook: Outlook; decisions: Decision[]; plan: TipPlan[]; actions: string[]; notes: string[];
}
export interface TeamView {
  rosterId: number; name: string; lockedTotal: number;
  slots: { slot: string; player: string | null; pid: string | null; locked: boolean; points: number | null; source: string | null; state: string }[];
  players: { pid: string; name: string; pos: string; injury: string | null; locked: boolean; games: { date: string; opp: string; tip: number; status: string; proj: number; actual: number | null }[] }[];
}
export interface Outlook { myMean: number; myP10: number; myP90: number; oppMean: number | null; oppP10: number | null; oppP90: number | null; winProb: number | null; sims: number }

function teamView(ctx: WeekContext, T: LiveTeam): TeamView {
  const st = T.st;
  const slots = ctx.slotNames.map((slot, s) => {
    const lp = st.lockedBy[s];
    if (lp >= 0) return { slot, player: T.names[lp], pid: T.pids[lp], locked: true, points: st.lockedPts[s], source: T.lockSource[s], state: "locked" };
    const pid = T.lineup[s]; const i = pid ? T.pids.indexOf(pid) : -1;
    const state = i < 0 ? "empty" : st.inGame[i] >= 0 ? "playing" : !Number.isNaN(st.pendingX[i]) ? "lockable" : "idle";
    return { slot, player: i >= 0 ? T.names[i] : null, pid, locked: false, points: i >= 0 && !Number.isNaN(st.pendingX[i]) ? st.pendingX[i] : null, source: null, state };
  });
  return {
    rosterId: T.rosterId, name: T.teamName, lockedTotal: Array.from(st.lockedBy).reduce((a, p, s) => a + (p >= 0 ? st.lockedPts[s] : 0), 0), slots,
    players: T.pids.map((pid, i) => ({
      pid, name: T.names[i], pos: T.positions[i].join("/"), injury: T.injury[i], locked: !!st.isLocked[i],
      games: T.games.filter((g) => g.pid === pid).map((g) => ({ date: g.date, opp: g.opp, tip: g.tip, status: g.status, proj: Math.round(g.proj * 10) / 10, actual: g.actual })),
    })),
  };
}

function finishWeek(T: LiveTeam, st: E.State, scen: { actual: Float64Array; played: Uint8Array }, fromEv: number) {
  return E.simulate(T.tw, POLICY, T.events, scen.actual, scen.played, st, fromEv).total;
}

function outlook(ctx: WeekContext, K: number, seed: number): Outlook {
  const r = E.rng(seed); const mine: number[] = []; const theirs: number[] = []; let wins = 0;
  for (let k = 0; k < K; k++) {
    const a = finishWeek(ctx.me, E.cloneState(ctx.me.st), E.sampleScenario(ctx.me.tw, ctx.me.st, ctx.asOf, r, ctx.me.real), ctx.me.evIdx);
    mine.push(a);
    if (ctx.opp) {
      const b = finishWeek(ctx.opp, E.cloneState(ctx.opp.st), E.sampleScenario(ctx.opp.tw, ctx.opp.st, ctx.asOf, r, ctx.opp.real), ctx.opp.evIdx);
      theirs.push(b); wins += a > b ? 1 : a === b ? 0.5 : 0;
    }
  }
  const q = (v: number[], p: number) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
  return { myMean: mean(mine), myP10: q(mine, 0.1), myP90: q(mine, 0.9), oppMean: ctx.opp ? mean(theirs) : null, oppP10: ctx.opp ? q(theirs, 0.1) : null, oppP90: ctx.opp ? q(theirs, 0.9) : null, winProb: ctx.opp ? wins / K : null, sims: K };
}

function lockThreshold(T: LiveTeam, st: E.State, p: number, t: number): { threshold: number; slot: number } | null {
  const saved = st.pendingX[p]; st.pendingX[p] = 0;
  const ev = E.evalLock(T.tw, POLICY, st, p, t);
  st.pendingX[p] = saved;
  if (!Number.isFinite(ev.lockBest) || ev.lockSlot < 0) return null;
  // lockBest = x + R  =>  lock iff x >= cont - R
  return { threshold: ev.cont - ev.lockBest, slot: ev.lockSlot };
}

function decisions(ctx: WeekContext, K: number, seed: number): Decision[] {
  const T = ctx.me; const out: Decision[] = []; const r = E.rng(seed);
  for (let p = 0; p < T.pids.length; p++) {
    if (Number.isNaN(T.st.pendingX[p]) || T.st.isLocked[p]) continue;
    const x = T.st.pendingX[p];
    const next = T.tw.byPlayer[p].map((gi) => T.games[gi]).find((g) => g.tip > ctx.asOf);
    const alts: { action: string; slot: number | null }[] = [{ action: "HOLD", slot: null }, { action: "BENCH", slot: null }];
    const lockable = E.unpinnedOpen(T.st); const seen = new Set<number>();
    for (const s of E.slotOrder(T.tw.slots)) {
      if (!((lockable >> s) & 1) || !(T.tw.slots[s] & T.tw.pmask[p]) || seen.has(T.tw.slots[s])) continue;
      seen.add(T.tw.slots[s]); alts.push({ action: "LOCK", slot: s });
    }
    if (!next) alts.splice(0, 2, { action: "HOLD", slot: null }); // final game: holding == auto-count
    const pts = new Float64Array(alts.length); const win = new Float64Array(alts.length);
    for (let k = 0; k < K; k++) {
      const scen = E.sampleScenario(T.tw, T.st, ctx.asOf, r, T.real);
      const oppTot = ctx.opp ? finishWeek(ctx.opp, E.cloneState(ctx.opp.st), E.sampleScenario(ctx.opp.tw, ctx.opp.st, ctx.asOf, r, ctx.opp.real), ctx.opp.evIdx) : 0;
      alts.forEach((a, ai) => {
        const s2 = E.cloneState(T.st);
        if (a.action === "LOCK") E.doLock(s2, p, a.slot!);
        else if (a.action === "BENCH") s2.pendingX[p] = NaN;
        const tot = finishWeek(T, s2, scen, T.evIdx);
        pts[ai] += tot; win[ai] += tot > oppTot ? 1 : tot === oppTot ? 0.5 : 0;
      });
    }
    const options = alts.map((a, ai) => ({ action: a.action, slot: a.slot === null ? null : ctx.slotNames[a.slot], expPoints: pts[ai] / K, winProb: ctx.opp ? win[ai] / K : null }));
    // choose by expected points (backtest: points objective wins more head-to-heads than win-prob at this sample size);
    // break near-ties (< 0.5 pts) by win probability.
    let best = 0;
    options.forEach((o, i) => {
      const b = options[best];
      if (o.expPoints > b.expPoints + 0.5 || (Math.abs(o.expPoints - b.expPoints) <= 0.5 && (o.winProb ?? 0) > (b.winProb ?? 0))) best = i;
    });
    const th = lockThreshold(T, E.cloneState(T.st), p, ctx.asOf);
    const o = options[best];
    const deadline = next ? next.tip : null;
    const lockOpt = options.filter((q) => q.action === "LOCK").sort((a, b) => b.expPoints - a.expPoints)[0];
    const hold = options.find((q) => q.action === "HOLD")!;
    const reason = o.action === "LOCK" ? `Locking ${x.toFixed(1)} beats waiting by ${(o.expPoints - hold.expPoints).toFixed(1)} pts over the rest of the week.`
      : o.action === "HOLD" ? (next ? `Keep him in a starting slot (don't bench!) and decide before ${fmtTime(next.tip)}; locking now is worth ${lockOpt ? (lockOpt.expPoints - o.expPoints).toFixed(1) : "?"} pts vs holding.` : `This was his last game - leave him in a starting slot and it counts automatically.`)
      : `Free the slot for someone else: benching beats keeping ${x.toFixed(1)} by ${(o.expPoints - hold.expPoints).toFixed(1)} pts.`;
    out.push({ player: T.names[p], pid: T.pids[p], score: x, deadline, deadlineText: next ? `before ${fmtTime(next.tip)} (${next.opp})` : "end of week",
      options, recommended: o.action, recommendedSlot: o.slot, threshold: th ? Math.round(th.threshold * 10) / 10 : null, reason });
  }
  return out;
}

function plan(ctx: WeekContext, hours: number): TipPlan[] {
  const T = ctx.me; const out: TipPlan[] = [];
  // median path: unknown games score their mean, everyone plays
  const actual = T.real.actual.slice(); const played = T.real.played.slice();
  T.games.forEach((g) => { if (g.status !== "post") { actual[g.gi] = g.mu; played[g.gi] = 1; } });
  let st = E.cloneState(T.st); let ev = T.evIdx; let first = true;
  const tips = [...new Set(T.games.filter((g) => g.tip > ctx.asOf && g.tip < ctx.asOf + hours * 3600e3).map((g) => g.tip))].sort((a, b) => a - b);
  for (const tip of tips) {
    const res = E.simulate(T.tw, POLICY, T.events, actual, played, st, ev, undefined, tip);
    st = res.st; ev = res.evIdx;
    const groupGames = T.games.filter((g) => g.tip === tip);
    const starts: TipPlan["starts"] = []; const benched: TipPlan["benched"] = [];
    for (const g of groupGames) {
      const p = T.tw.games[g.gi].p;
      const s = Array.from(st.pinned).indexOf(p);
      if (s >= 0 && st.inGame[p] === g.gi) {
        const th = lockThreshold(T, E.cloneState(st), p, g.end);
        starts.push({ slot: ctx.slotNames[s], player: T.names[p], pid: T.pids[p], proj: Math.round(g.proj * 10) / 10, lockIf: th ? Math.round(th.threshold * 10) / 10 : null });
      } else if (!st.isLocked[p]) benched.push({ player: T.names[p], proj: Math.round(g.proj * 10) / 10 });
    }
    out.push({ tip, when: fmtTime(tip), starts, benched, tentative: !first });
    first = false;
  }
  return out;
}

function actionsFrom(ctx: WeekContext, ds: Decision[], pl: TipPlan[]): string[] {
  const a: string[] = [];
  for (const d of ds) {
    if (d.recommended === "LOCK") a.push(`LOCK ${d.player} (${d.score.toFixed(1)}) at ${d.recommendedSlot} - ${d.deadlineText}`);
    else if (d.recommended === "BENCH") a.push(`PASS on ${d.player} (${d.score.toFixed(1)}): bench him to free the slot - ${d.deadlineText}`);
    else if (d.deadline) a.push(`HOLD ${d.player} (${d.score.toFixed(1)}) in a starting slot; decide ${d.deadlineText}. Lock if nothing better shows up (cut-off ${d.threshold ?? "?"}).`);
  }
  const nxt = pl[0];
  if (nxt) {
    const current = new Set(ctx.me.lineup.filter(Boolean) as string[]);
    const moves = nxt.starts.filter((s) => !current.has(s.pid));
    if (moves.length) a.push(`Before ${nxt.when}: start ${moves.map((m) => `${m.player} (${m.slot})`).join(", ")}.`);
    if (nxt.starts.length) a.push(`Tonight's cut-offs: ${nxt.starts.filter((s) => s.lockIf !== null).map((s) => `${s.player} lock if >= ${s.lockIf}`).join("; ")}.`);
  }
  return a;
}

export async function advise(o: { leagueId: string; rosterId: number; week?: number; asOf?: number; lockOverrides?: Record<number, string | null>; K?: number }): Promise<Advice> {
  const ctx = await buildWeek({ ...o, mode: "live" });
  const K = o.K ?? 300;
  // Seed from the game state (finished games, locks, pending scores), not the clock: numbers only change when
  // something actually happens, instead of jittering on every refresh.
  let h = 2166136261 ^ ctx.week;
  const mix = (x: number) => { h = Math.imul(h ^ Math.round(x * 10), 16777619) >>> 0; };
  for (const T of [ctx.me, ctx.opp]) if (T) {
    T.games.forEach((g) => mix(g.status === "post" ? 1000 + (g.actual ?? 0) : g.status === "in" ? 7 : 3));
    T.st.lockedPts.forEach(mix); T.st.lockedBy.forEach(mix); T.st.pendingX.forEach((x) => mix(Number.isNaN(x) ? -1 : x));
  }
  const seed = h;
  const ds = decisions(ctx, K, seed);
  const pl = plan(ctx, 30);
  return {
    generatedAt: Date.now(), asOf: ctx.asOf, mode: "live", league: ctx.league.name, season: ctx.season, week: ctx.week, dates: ctx.dates,
    me: teamView(ctx, ctx.me), opp: ctx.opp ? teamView(ctx, ctx.opp) : null, outlook: outlook(ctx, 2000, seed + 1), // 2000 weeks: win-prob 95% margin ≈ ±2 pts (300 gave ±5.7)
    decisions: ds, plan: pl, actions: actionsFrom(ctx, ds, pl), notes: ctx.notes,
  };
}

// ---------------- replay ----------------
export interface ReplayLog { t: number; when: string; text: string; kind: "start" | "lock" | "pass" | "bench" | "auto" }
export interface Replay { league: string; season: string; week: number; dates: string[]; team: string; appTotal: number; humanTotal: number | null; hindsight: number; oppHuman: number | null; oppName: string | null; log: ReplayLog[]; lineupBySlot: { slot: string; player: string | null; points: number | null }[] }

export async function replay(o: { leagueId: string; rosterId: number; week: number; K?: number }): Promise<Replay> {
  const ctx = await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week: o.week, mode: "replay" });
  const T = ctx.me; const tw = T.tw; const K = o.K ?? 150;
  const hooks = E.rolloutHooks(tw, POLICY, T.events, "points", K, 12, o.week * 1000 + o.rosterId, T.real);
  let st = E.initState(tw); const log: ReplayLog[] = [];
  const times = [...new Set(T.events.map((e) => e.t))].sort((a, b) => a - b);
  let ev = 0;
  for (const t of times) {
    const before = E.cloneState(st);
    const res = E.simulate(tw, POLICY, T.events, T.real.actual, T.real.played, st, ev, hooks, t);
    st = res.st; ev = res.evIdx;
    for (let s = 0; s < tw.slots.length; s++) {
      if (before.lockedBy[s] < 0 && st.lockedBy[s] >= 0) log.push({ t, when: fmtTime(t), kind: "lock", text: `LOCK ${tw.names[st.lockedBy[s]]} at ${ctx.slotNames[s]} for ${st.lockedPts[s].toFixed(1)}` });
      if (st.pinned[s] >= 0 && before.pinned[s] !== st.pinned[s]) { const p = st.pinned[s]; const g = T.games[st.inGame[p]]; log.push({ t, when: fmtTime(t), kind: "start", text: `Start ${tw.names[p]} at ${ctx.slotNames[s]} (proj ${g.proj.toFixed(1)} vs ${g.opp})` }); }
    }
    for (let p = 0; p < tw.pmask.length; p++) {
      if (!Number.isNaN(before.pendingX[p]) && Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
        const last = tw.byPlayer[p].map((gi) => T.games[gi]).filter((g) => g.end <= t).pop();
        const dnp = last && !last.played;
        log.push({ t, when: fmtTime(t), kind: "pass", text: dnp ? `${tw.names[p]} didn't play (${last!.opp}) - slot freed` : `Pass on ${tw.names[p]}'s ${before.pendingX[p].toFixed(1)}` });
      }
    }
  }
  const fin = E.simulate(tw, POLICY, T.events, T.real.actual, T.real.played, st, T.events.length);
  // week-end auto counts
  const lineupBySlot = ctx.slotNames.map((slot, s) => ({ slot, player: st.lockedBy[s] >= 0 ? tw.names[st.lockedBy[s]] : null, points: st.lockedBy[s] >= 0 ? st.lockedPts[s] : null }));
  for (let p = 0; p < tw.pmask.length; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
    const s = lineupBySlot.findIndex((x) => x.player === null && (tw.slots[ctx.slotNames.indexOf(x.slot)] & tw.pmask[p]));
    if (s >= 0) { lineupBySlot[s] = { slot: lineupBySlot[s].slot, player: tw.names[p] + " (auto)", points: st.pendingX[p] }; log.push({ t: ctx.asOf, when: "week end", kind: "auto", text: `${tw.names[p]}'s final game counts automatically: ${st.pendingX[p].toFixed(1)}` }); }
  }
  return { league: ctx.league.name, season: ctx.season, week: ctx.week, dates: ctx.dates, team: T.teamName, appTotal: fin.total, humanTotal: T.sleeperPoints, hindsight: E.hindsight(tw), oppHuman: ctx.opp?.sleeperPoints ?? null, oppName: ctx.opp?.teamName ?? null, log, lineupBySlot };
}

export { etDate };
