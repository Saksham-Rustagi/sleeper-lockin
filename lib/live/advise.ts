// Advisor: turns a WeekContext into concrete recommendations.
//  - decisions: for each lockable (pending) starter: LOCK (slot) / HOLD / BENCH, evaluated by Monte-Carlo rollout
//    over the rest of the week for BOTH teams (common random numbers); reports expected points and win probability.
//  - plan: lineup for each upcoming tip-off in the next ~30h + "lock if >= X" cut-off for every starter.
//  - outlook: projected totals and win probability from simulating both teams' weeks.
//  - replay: run the full strategy over a finished week with the real results and log every decision.
import * as E from "../engine/core";
import { buildWeek, POLICY, etDate, type WeekContext, type LiveTeam } from "./week";
import { cachedCompute, fingerprint } from "./cache";
import { teamFingerprint, teamSims, summarize, winProb, TEAM_SIMS, simCutoff } from "./teamsim";
import { decisionPolicy, simPolicy, planHooks, replayHooks, winActive, engineDecidesHolds, engineName, WIN_OPTS } from "./engine";
import { liveOppSource } from "./opponent";
import { betaAt } from "../engine/p11";

// more than ~5 days out, include the date ("Tue, Oct 20, 9:30 PM") so it isn't confused with this week's Tuesday
const START_SIMS = 200;
const fmtTime = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", ...(ms - Date.now() > 5 * 86400e3 ? { month: "short", day: "numeric" } : {}) }).format(ms);

export interface Decision {
  player: string; pid: string; score: number; deadline: number | null; deadlineText: string;
  options: { action: string; slot: string | null; expPoints: number; winProb: number | null }[];
  recommended: string; recommendedSlot: string | null; threshold: number | null; reason: string;
  moves: string[]; // step-by-step Sleeper moves to execute the recommendation (e.g. swap into the lock slot first)
}
export interface TipPlan {
  tip: number; when: string; starts: { slot: string; player: string; pid: string; proj: number; lockIf: number | null }[]; benched: { player: string; proj: number }[]; tentative: boolean;
  // players holding a finished, unlocked score: where they sit during this tip-off (any starting slot - never the bench)
  holds: { player: string; pid: string; score: number; slot: string; from: string | null; move: boolean }[];
  forfeits: { player: string; score: number }[]; // held scores the plan gives up to make room (only if locking them isn't better)
}
export interface Advice {
  generatedAt: number; asOf: number; mode: "live" | "replay"; league: string; season: string; week: number; dates: string[];
  me: TeamView; opp: TeamView | null; outlook: Outlook; decisions: Decision[]; plan: TipPlan[]; actions: string[]; notes: string[];
  cached?: boolean; checkedAt?: number;
}
export interface TeamView {
  rosterId: number; name: string; lockedTotal: number;
  slots: { slot: string; player: string | null; pid: string | null; locked: boolean; points: number | null; source: string | null; state: string; injury?: string | null }[];
  // projOverride: the minutes override replaced Sleeper's projection for this player (option "minutesOverride")
  players: { pid: string; name: string; pos: string; injury: string | null; locked: boolean; projOverride?: string; rosterNote?: string; games: { date: string; opp: string; tip: number; status: string; proj: number; actual: number | null; projOverride?: string }[] }[];
}
export interface Outlook { myMean: number; myP10: number; myP90: number; oppMean: number | null; oppP10: number | null; oppP90: number | null; winProb: number | null; sims: number }

function teamView(ctx: WeekContext, T: LiveTeam): TeamView {
  const st = T.st;
  const slots = ctx.slotNames.map((slot, s) => {
    const lp = st.lockedBy[s];
    if (lp >= 0) return { slot, player: T.names[lp], pid: T.pids[lp], locked: true, points: st.lockedPts[s], source: T.lockSource[s], state: "locked" };
    const pid = T.lineup[s]; const i = pid ? T.pids.indexOf(pid) : -1;
    const state = i < 0 ? "empty" : st.inGame[i] >= 0 ? "playing" : !Number.isNaN(st.pendingX[i]) ? "lockable" : "idle";
    return { slot, player: i >= 0 ? T.names[i] : null, pid, locked: false, points: i >= 0 && !Number.isNaN(st.pendingX[i]) ? st.pendingX[i] : null, source: null, state, injury: i >= 0 ? T.injury[i] : null };
  });
  return {
    rosterId: T.rosterId, name: T.teamName, lockedTotal: Array.from(st.lockedBy).reduce((a, p, s) => a + (p >= 0 ? st.lockedPts[s] : 0), 0), slots,
    players: T.pids.map((pid, i) => ({
      pid, name: T.names[i], pos: T.positions[i].join("/"), injury: T.injury[i], locked: !!st.isLocked[i], ...(T.overrides?.[pid] ? { projOverride: T.overrides[pid].label } : {}),
      ...(T.rosterFix?.[pid] ? { rosterNote: T.rosterFix[pid].label } : {}), // task R: his team's current NBA roster doesn't list him
      games: T.games.filter((g) => g.pid === pid).map((g) => ({ date: g.date, opp: g.opp, tip: g.tip, status: g.status, proj: Math.round(g.proj * 10) / 10, actual: g.actual, ...(g.projOverride ? { projOverride: g.projOverride } : {}) })),
    })),
  };
}

function finishWeek(T: LiveTeam, st: E.State, scen: { actual: Float64Array; played: Uint8Array }, fromEv: number) {
  return E.simulate(T.tw, simPolicy(), T.events, scen.actual, scen.played, st, fromEv).total;
}

function sharedOutlook(ms: Float64Array, os: Float64Array | null): Outlook {
  const a = summarize(ms), b = os ? summarize(os) : null;
  return { myMean: a.mean, myP10: a.p10, myP90: a.p90, oppMean: b?.mean ?? null, oppP10: b?.p10 ?? null, oppP90: b?.p90 ?? null, winProb: os ? winProb(ms, os) : null, sims: ms.length };
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

// Quick lock cut-off from the rule's lock evaluation (POLICY, whatever the engine: for p8/p9 it only seeds the
// simulated cut-off of the first tip-off and approximates the later ones).
function lockThreshold(T: LiveTeam, st: E.State, p: number, t: number): { threshold: number; slot: number } | null {
  const saved = st.pendingX[p]; st.pendingX[p] = 0;
  const ev = E.evalLock(T.tw, POLICY, st, p, t);
  st.pendingX[p] = saved;
  if (!Number.isFinite(ev.lockBest) || ev.lockSlot < 0) return null;
  // lockBest = x + R  =>  lock iff x >= cont - R
  return { threshold: ev.cont - ev.lockBest, slot: ev.lockSlot };
}

export function slotLabels(names: string[]) {
  const seen: Record<string, number> = {};
  return names.map((n) => { seen[n] = (seen[n] || 0) + 1; return names.filter((x) => x === n).length > 1 ? `${n} ${seen[n]}` : n; });
}

// Moves needed in Sleeper to lock player p into slot `target`: he may only move between STARTING slots
// (touching the bench forfeits the game), players in a live game can't move, locked players can't move.
export function lockMoves(slotNames: string[], slots: number[], pmask: number[], names: string[], pids: string[], lineup: (string | null)[], st: E.State, p: number, target: number): string[] {
  const L = slotLabels(slotNames); const pid = pids[p];
  const cur = lineup.indexOf(pid);
  const idx = (q: string | null) => (q ? pids.indexOf(q) : -1);
  if (cur === target) return [`Lock ${names[p]} in ${L[target]} (he's already there).`];
  const steps: string[] = [];
  const occ = idx(lineup[target]);
  if (cur < 0) steps.push(`⚠️ Sleeper doesn't show ${names[p]} in your starting lineup - he must have started this game to be lockable.`);
  if (occ < 0) steps.push(`Move ${names[p]} ${cur >= 0 ? L[cur] : ""} → ${L[target]} (slot is empty).`);
  else if (cur >= 0 && (slots[cur] & pmask[occ])) steps.push(`Swap ${names[p]} (${L[cur]}) ↔ ${names[occ]} (${L[target]}).`);
  else {
    // occupant can't take p's old slot: find another open, movable starting slot he fits
    const k = slots.findIndex((m, s) => s !== target && s !== cur && st.lockedBy[s] < 0 && st.pinned[s] < 0 && (m & pmask[occ]) && (lineup[s] === null || idx(lineup[s]) < 0));
    if (k >= 0) steps.push(`Move ${names[occ]} ${L[target]} → ${L[k]}, then ${names[p]} ${cur >= 0 ? L[cur] + " " : ""}→ ${L[target]}.`);
    else steps.push(`Move ${names[occ]} out of ${L[target]} into another starting slot he can play${!Number.isNaN(st.pendingX[occ]) ? ` (NOT the bench - that forfeits his ${st.pendingX[occ].toFixed(1)})` : ""}, then move ${names[p]} → ${L[target]}.`);
  }
  steps.push(`Lock ${names[p]} in ${L[target]}.`);
  return steps;
}

// The engine's own call for held score p at the plan's first tip-off (p10b): locked there -> LOCK (slot); let go
// (no score, not playing) -> BENCH; otherwise HOLD (keeps holding, or plays his game tipping then).
export function engineCall(st: E.State, p: number): { action: "LOCK" | "HOLD" | "BENCH"; slot: number | null } {
  if (st.isLocked[p]) return { action: "LOCK", slot: Array.from(st.lockedBy).indexOf(p) };
  if (Number.isNaN(st.pendingX[p]) && st.inGame[p] < 0) return { action: "BENCH", slot: null };
  return { action: "HOLD", slot: null };
}

// eng (p10b): the state after the engine's decision at the plan's first tip-off; each recommendation is that decision
function decisions(ctx: WeekContext, K: number, seed: number, eng?: { st: E.State; tip: number } | null): Decision[] {
  const T = ctx.me; const out: Decision[] = []; const r = E.rng(seed);
  // objective "win" (p10 / p10b): options scored by points + beta * P(beat the opponent simulated as a human)
  const D = winActive() ? liveOppSource(ctx.opp, ctx.asOf, seed ^ 0x5f3759df)?.dist(ctx.asOf) ?? null : null;
  const beta = D ? betaAt(T.tw, ctx.asOf, WIN_OPTS) : 0;
  for (let p = 0; p < T.pids.length; p++) {
    if (Number.isNaN(T.st.pendingX[p]) || T.st.isLocked[p]) continue;
    const x = T.st.pendingX[p];
    const next = T.tw.byPlayer[p].map((gi) => T.games[gi]).find((g) => g.tip > ctx.asOf);
    const alts: { action: string; slot: number | null }[] = [{ action: "HOLD", slot: null }, { action: "BENCH", slot: null }];
    const lockable = E.unpinnedOpen(T.st); const seen = new Set<number>();
    for (const s of E.slotOrder(T.tw.slots)) {
      if (!((lockable >> s) & 1) || !(T.tw.slots[s] & T.tw.pmask[p]) || seen.has(T.tw.slots[s])) continue;
      seen.add(T.tw.slots[s]); alts.push({ action: "LOCK", slot: E.sameTypeHere(T.tw, T.st, p, s, lockable) });
    }
    // where he sits now (from Sleeper's lineup): offer "lock in place" explicitly
    const hereIdx = T.lineup.indexOf(T.pids[p]);
    if (hereIdx >= 0 && ((lockable >> hereIdx) & 1) && (T.tw.slots[hereIdx] & T.tw.pmask[p])) {
      const dup = alts.findIndex((x) => x.action === "LOCK" && x.slot !== null && T.tw.slots[x.slot] === T.tw.slots[hereIdx]);
      if (dup >= 0) alts[dup].slot = hereIdx; else alts.push({ action: "LOCK", slot: hereIdx });
    }
    if (!next) alts.splice(0, 2, { action: "HOLD", slot: null }); // final game: holding == auto-count
    // the engine's call is always one of the options (a lock in a slot of the same type is the same decision: it
    // keeps the slot he sits in when that one qualifies, as above)
    const call = eng ? engineCall(eng.st, p) : null;
    let ei = -1;
    if (call) {
      ei = alts.findIndex((a) => a.action === call.action && (call.slot === null || (a.slot !== null && T.tw.slots[a.slot] === T.tw.slots[call.slot])));
      if (ei < 0) { alts.push({ action: call.action, slot: call.slot }); ei = alts.length - 1; }
    }
    const pts = new Float64Array(alts.length); const win = new Float64Array(alts.length); const fw = new Float64Array(alts.length);
    for (let k = 0; k < K; k++) {
      const scen = E.sampleScenario(T.tw, T.st, ctx.asOf, r, T.real);
      const oppTot = ctx.opp ? finishWeek(ctx.opp, E.cloneState(ctx.opp.st), E.sampleScenario(ctx.opp.tw, ctx.opp.st, ctx.asOf, r, ctx.opp.real), ctx.opp.evIdx) : 0;
      alts.forEach((a, ai) => {
        const s2 = E.cloneState(T.st);
        if (a.action === "LOCK") E.doLock(s2, p, a.slot!);
        else if (a.action === "BENCH") s2.pendingX[p] = NaN;
        const tot = finishWeek(T, s2, scen, T.evIdx);
        pts[ai] += tot; win[ai] += tot > oppTot ? 1 : tot === oppTot ? 0.5 : 0; if (D) fw[ai] += D.F(tot);
      });
    }
    const options = alts.map((a, ai) => ({ action: a.action, slot: a.slot === null ? null : ctx.slotNames[a.slot], expPoints: pts[ai] / K, winProb: D ? fw[ai] / K : ctx.opp ? win[ai] / K : null }));
    // (playing for the win: compare points + beta * win probability; with beta = 0 this is the points rule below)
    const u = (i: number) => options[i].expPoints + (D ? beta * (options[i].winProb ?? 0) : 0);
    // choose by expected points (backtest: points objective wins more head-to-heads than win-prob at this sample size);
    // break near-ties (< 0.5 pts) by win probability.
    let best = 0;
    options.forEach((o, i) => {
      const b = options[best];
      if (u(i) > u(best) + 0.5 || (Math.abs(u(i) - u(best)) <= 0.5 && (o.winProb ?? 0) > (b.winProb ?? 0))) best = i;
    });
    // a LOCK in his current slot wins near-ties against a LOCK elsewhere (no shuffling in Sleeper)
    if (alts[best].action === "LOCK" && hereIdx >= 0 && alts[best].slot !== hereIdx) {
      const hi = alts.findIndex((x) => x.action === "LOCK" && x.slot === hereIdx);
      if (hi >= 0 && options[hi].expPoints >= options[best].expPoints - 0.5) best = hi;
    }
    const quick = best; if (ei >= 0) best = ei;
    const th = lockThreshold(T, E.cloneState(T.st), p, ctx.asOf);
    const o = options[best];
    const deadline = next ? next.tip : null;
    const lockOpt = options.filter((q) => q.action === "LOCK").sort((a, b) => b.expPoints - a.expPoints)[0];
    const hold = options.find((q) => q.action === "HOLD")!;
    let reason = o.action === "LOCK" ? `Locking ${x.toFixed(1)} beats waiting by ${(o.expPoints - hold.expPoints).toFixed(1)} pts over the rest of the week.`
      : o.action === "HOLD" ? (next ? `Keep him in a starting slot (don't bench!) and decide before ${fmtTime(next.tip)}; locking now is worth ${lockOpt ? (lockOpt.expPoints - o.expPoints).toFixed(1) : "?"} pts vs holding.` : `This was his last game - leave him in a starting slot and it counts automatically.`)
      : `Free the slot for someone else: benching beats keeping ${x.toFixed(1)} by ${(o.expPoints - hold.expPoints).toFixed(1)} pts.`;
    if (eng) {
      // p10b decides; the quick simulations (rest of the week by the fast rule) are shown, and flagged when they disagree
      const what = o.action === "LOCK" ? `lock ${x.toFixed(1)} now` : o.action === "BENCH" ? `let ${x.toFixed(1)} go (bench him)` : next ? `keep holding ${x.toFixed(1)} in a starting slot (don't bench!)` : `leave him in a starting slot - his last game counts automatically`;
      const q = options[quick]; const gap = q.expPoints - o.expPoints;
      const qa = q.action === "LOCK" ? "locking" : q.action === "BENCH" ? "benching" : "holding";
      const en = engineName() === "p10c" ? "P10c" : "P10b";
      reason = `${en} (complete decision for the ${fmtTime(eng.tip)} tip-off, raced by simulation): ${what}.` + (alts[quick].action === o.action ? ""
        : gap > 0.5 ? ` The quick simulations rate ${qa} ${gap.toFixed(1)} pts higher; ${en}'s search is the better-tested one (backtest +2.4 pts/wk).`
        : ` The quick simulations call it a near-tie (${qa} ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts).`);
    }
    const bestAlt = alts[best];
    const moves = o.action === "LOCK" && bestAlt.slot !== null
      ? lockMoves(ctx.slotNames, T.tw.slots, T.tw.pmask, T.names, T.pids, T.lineup, T.st, p, bestAlt.slot)
      : o.action === "BENCH" ? [`Move ${T.names[p]} to the bench ${next ? `before ${fmtTime(next.tip)}` : ""} so the slot is free.`]
      : [`Keep ${T.names[p]} in a starting slot (any starting slot is fine; never the bench).`];
    out.push({ player: T.names[p], pid: T.pids[p], score: x, deadline, deadlineText: next ? `before ${fmtTime(next.tip)} (${next.opp})` : "end of week",
      options, recommended: o.action, recommendedSlot: o.slot, threshold: th ? Math.round(th.threshold * 10) / 10 : null, reason, moves });
  }
  return out;
}

// first (optional): receives the state right after the decision at the plan's first tip-off
async function plan(ctx: WeekContext, hours: number, first0?: { st?: E.State; tip?: number }): Promise<TipPlan[]> {
  const T = ctx.me; const out: TipPlan[] = [];
  // median path: unknown games score their mean, everyone plays
  const actual = T.real.actual.slice(); const played = T.real.played.slice();
  T.games.forEach((g) => { if (g.status !== "post") { actual[g.gi] = g.mu; played[g.gi] = 1; } });
  let st = E.cloneState(T.st); let ev = T.evIdx; let first = true;
  // who starts at each tip-off: decided by simulation (rule's lineup vs small changes, 200 continuations each).
  // Backtest 2025-26: +4.3 ± 2.0 pts/week over lock-only simulation.
  const startHooks = planHooks(T.tw, T.events, START_SIMS, 4242 + ctx.week, T.real, undefined, winActive() ? liveOppSource(ctx.opp, ctx.asOf, 4242 + ctx.week) : null); const pol = decisionPolicy();
  let tips = [...new Set(T.games.filter((g) => g.tip > ctx.asOf && g.tip < ctx.asOf + hours * 3600e3).map((g) => g.tip))].sort((a, b) => a - b);
  if (!tips.length) { // nothing soon (e.g. preseason / off days): plan the next game day instead
    const nextDay = T.games.filter((g) => g.tip > ctx.asOf).map((g) => g.date).sort()[0];
    tips = [...new Set(T.games.filter((g) => g.date === nextDay && g.tip > ctx.asOf).map((g) => g.tip))].sort((a, b) => a - b);
  }
  for (const tip of tips) {
    const res = E.simulate(T.tw, pol, T.events, actual, played, st, ev, startHooks, tip);
    st = res.st; ev = res.evIdx;
    if (first && first0) { first0.st = E.cloneState(st); first0.tip = tip; }
    const groupGames = T.games.filter((g) => g.tip === tip);
    const starts: TipPlan["starts"] = []; const benched: TipPlan["benched"] = [];
    for (const g of groupGames) {
      const p = T.tw.games[g.gi].p;
      const s = Array.from(st.pinned).indexOf(p);
      if (s >= 0 && st.inGame[p] === g.gi) {
        const th0 = lockThreshold(T, E.cloneState(st), p, g.end);
        // the cut-off shown is the simulated one (first tip-off of the plan); the quick rule only seeds it
        const th = th0 && first ? { ...th0, threshold: await simCutoff(T, st, ev, p, g.gi, th0.threshold, ctx.asOf) } : th0;
        starts.push({ slot: slotLabels(ctx.slotNames)[s], player: T.names[p], pid: T.pids[p], proj: Math.round(g.proj * 10) / 10, lockIf: th ? Math.round(th.threshold * 10) / 10 : null });
      } else if (!st.isLocked[p]) benched.push({ player: T.names[p], proj: Math.round(g.proj * 10) / 10 });
    }
    // held scores: everyone still lockable but not playing now keeps a starting slot (assigned among free slots)
    const L = slotLabels(ctx.slotNames);
    const held: number[] = []; const w = new Float64Array(T.pids.length);
    for (let p = 0; p < T.pids.length; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p] && st.inGame[p] < 0) { held.push(p); w[p] = st.pendingX[p] + 1000; }
    const ha = E.assignExact(T.tw.slots, E.unpinnedOpen(st), held, T.tw.pmask, w);
    const holds: TipPlan["holds"] = [];
    for (const p of held) {
      const s = ha.slotOf.get(p); if (s === undefined) continue;
      const cur = first ? T.lineup.indexOf(T.pids[p]) : -1;
      // keep him where he is if that slot is still free for him; otherwise move him to the assigned free slot
      const stay = cur >= 0 && st.pinned[cur] < 0 && st.lockedBy[cur] < 0 && (T.tw.slots[cur] & T.tw.pmask[p]) && ![...ha.slotOf.entries()].some(([q, sq]) => q !== p && sq === cur);
      const slotIdx = stay ? cur : s;
      holds.push({ player: T.names[p], pid: T.pids[p], score: st.pendingX[p], slot: L[slotIdx], from: cur >= 0 ? L[cur] : null, move: first && !stay });
    }
    const before = first ? T.st : null;
    const forfeits: TipPlan["forfeits"] = [];
    if (before) for (let p = 0; p < T.pids.length; p++) if (!Number.isNaN(before.pendingX[p]) && Number.isNaN(st.pendingX[p]) && !st.isLocked[p] && st.inGame[p] < 0) forfeits.push({ player: T.names[p], score: before.pendingX[p] });
    out.push({ tip, when: fmtTime(tip), starts, benched, tentative: !first, holds, forfeits });
    first = false;
  }
  return out;
}

function actionsFrom(ctx: WeekContext, ds: Decision[], pl: TipPlan[]): string[] {
  const a: string[] = [];
  for (const d of ds) {
    if (d.recommended === "LOCK") a.push(`LOCK ${d.player} (${d.score.toFixed(1)}) at ${d.recommendedSlot} - ${d.deadlineText}. Steps: ${d.moves.join(" ")}`);
    else if (d.recommended === "BENCH") a.push(`PASS on ${d.player} (${d.score.toFixed(1)}): bench him to free the slot - ${d.deadlineText}`);
    else if (d.deadline) a.push(`HOLD ${d.player} (${d.score.toFixed(1)}) in a starting slot; decide ${d.deadlineText}. Lock if nothing better shows up (cut-off ${d.threshold ?? "?"}).`);
  }
  const nxt = pl[0];
  if (nxt) {
    const current = new Set(ctx.me.lineup.filter(Boolean) as string[]);
    const moves = nxt.starts.filter((s) => !current.has(s.pid));
    const hm = nxt.holds.filter((h) => h.move);
    if (hm.length) a.push(`Before ${nxt.when}: move held ${hm.map((h) => `${h.player} (${h.score.toFixed(1)}) ${h.from ?? ""} → ${h.slot}`).join(", ")} - keep them in starting slots, NOT the bench.`);
    if (moves.length) a.push(`Before ${nxt.when}: start ${moves.map((m) => `${m.player} (${m.slot})`).join(", ")}.`);
    if (nxt.forfeits.length) a.push(`At ${nxt.when} the plan lets go of ${nxt.forfeits.map((f) => `${f.player}'s ${f.score.toFixed(1)}`).join(", ")} (locking isn't worth the slot).`);
    if (nxt.starts.length) a.push(`${nxt.tip - ctx.asOf < 20 * 3600e3 ? "Tonight's" : `${nxt.when}`} cut-offs: ${nxt.starts.filter((s) => s.lockIf !== null).map((s) => `${s.player} lock if >= ${s.lockIf}`).join("; ")}.`);
  }
  return a;
}

export { teamFingerprint } from "./teamsim";

export async function advise(o: { leagueId: string; rosterId: number; week?: number; asOf?: number; lockOverrides?: Record<number, string | null>; K?: number; force?: boolean }): Promise<Advice> {
  const ctx = await buildWeek({ ...o, mode: "live" });
  const K = o.K ?? 300;
  const windowTips = [...new Set(ctx.me.games.filter((g) => g.tip > ctx.asOf && g.tip < ctx.asOf + 30 * 3600e3).map((g) => g.tip))].sort();
  if (!windowTips.length) { const nd = ctx.me.games.filter((g) => g.tip > ctx.asOf).map((g) => g.date).sort()[0]; if (nd) windowTips.push(...ctx.me.games.filter((g) => g.date === nd).map((g) => g.tip)); }
  const fp = o.force ? String(Math.random()) : fingerprint({ v: 12, K, week: ctx.week, me: teamFingerprint(ctx.me), opp: ctx.opp ? teamFingerprint(ctx.opp) : null, windowTips, notes: ctx.notes });
  const [ms, os] = await Promise.all([teamSims(ctx.me, ctx.week, ctx.asOf), ctx.opp ? teamSims(ctx.opp, ctx.week, ctx.asOf) : Promise.resolve(null)]);
  const { value, cached } = await cachedCompute(`advise-${o.leagueId}-${o.rosterId}`, fp, () => computeAdvice(ctx, K, ms, os));
  return { ...value, cached, checkedAt: Date.now() };
}

// (exported for tests and research/livecost: advice for a prepared WeekContext, no fetching, no cache)
export async function computeAdvice(ctx: WeekContext, K: number, ms: Float64Array, os: Float64Array | null): Promise<Advice> {
  // Seed from the game state (finished games, locks, pending scores), not the clock: numbers only change when
  // something actually happens, instead of jittering on every refresh.
  let h = 2166136261 ^ ctx.week;
  const mix = (x: number) => { h = Math.imul(h ^ Math.round(x * 10), 16777619) >>> 0; };
  for (const T of [ctx.me, ctx.opp]) if (T) {
    T.games.forEach((g) => mix(g.status === "post" ? 1000 + (g.actual ?? 0) : g.status === "in" ? 7 : 3));
    T.st.lockedPts.forEach(mix); T.st.lockedBy.forEach(mix); T.st.pendingX.forEach((x) => mix(Number.isNaN(x) ? -1 : x));
  }
  const seed = h;
  let ds: Decision[], pl: TipPlan[];
  if (engineDecidesHolds()) {
    // p10b: the plan's first tip-off decision (P10b's race) is also the hold / lock / bench call for every held score
    const first: { st?: E.State; tip?: number } = {};
    pl = await plan(ctx, 30, first);
    ds = decisions(ctx, K, seed, first.st ? { st: first.st, tip: first.tip! } : null);
  } else {
    ds = decisions(ctx, K, seed);
    pl = await plan(ctx, 30);
  }
  return {
    generatedAt: Date.now(), asOf: ctx.asOf, mode: "live", league: ctx.league.name, season: ctx.season, week: ctx.week, dates: ctx.dates,
    me: teamView(ctx, ctx.me), opp: ctx.opp ? teamView(ctx, ctx.opp) : null, outlook: sharedOutlook(ms, os),
    decisions: ds, plan: pl, actions: actionsFrom(ctx, ds, pl), notes: ctx.notes,
  };
}

// ---------------- replay ----------------
export interface ReplayLog { t: number; when: string; text: string; kind: "start" | "lock" | "pass" | "bench" | "auto" }
export interface Replay { league: string; season: string; week: number; dates: string[]; team: string; appTotal: number; humanTotal: number | null; hindsight: number; oppHuman: number | null; oppName: string | null; log: ReplayLog[]; lineupBySlot: { slot: string; player: string | null; points: number | null }[] }

export async function replay(o: { leagueId: string; rosterId: number; week: number; K?: number }): Promise<Replay> {
  const ctx = await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week: o.week, mode: "replay" });
  const K = o.K ?? 150;
  const fp = fingerprint({ v: 2, K, pids: ctx.me.pids, games: ctx.me.games.map((g) => [g.pid, g.tip, g.actual, g.played, Math.round(g.proj * 10) / 10]), human: ctx.me.sleeperPoints, opp: ctx.opp?.sleeperPoints ?? null });
  return (await cachedCompute(`replay-${o.leagueId}-${o.rosterId}-${o.week}`, fp, () => computeReplay(ctx, o.rosterId, o.week, K))).value;
}

function computeReplay(ctx: WeekContext, rosterId: number, week: number, K: number): Replay {
  const T = ctx.me; const tw = T.tw;
  const hooks = replayHooks(tw, T.events, K, week * 1000 + rosterId, T.real); const pol = decisionPolicy();
  let st = E.initState(tw); const log: ReplayLog[] = [];
  const times = [...new Set(T.events.map((e) => e.t))].sort((a, b) => a - b);
  let ev = 0;
  for (const t of times) {
    const before = E.cloneState(st);
    const res = E.simulate(tw, pol, T.events, T.real.actual, T.real.played, st, ev, hooks, t);
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
  const fin = E.simulate(tw, pol, T.events, T.real.actual, T.real.played, st, T.events.length);
  // week-end auto counts
  const lineupBySlot = ctx.slotNames.map((slot, s) => ({ slot, player: st.lockedBy[s] >= 0 ? tw.names[st.lockedBy[s]] : null, points: st.lockedBy[s] >= 0 ? st.lockedPts[s] : null }));
  for (let p = 0; p < tw.pmask.length; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
    const s = lineupBySlot.findIndex((x) => x.player === null && (tw.slots[ctx.slotNames.indexOf(x.slot)] & tw.pmask[p]));
    if (s >= 0) { lineupBySlot[s] = { slot: lineupBySlot[s].slot, player: tw.names[p] + " (auto)", points: st.pendingX[p] }; log.push({ t: ctx.asOf, when: "week end", kind: "auto", text: `${tw.names[p]}'s final game counts automatically: ${st.pendingX[p].toFixed(1)}` }); }
  }
  return { league: ctx.league.name, season: ctx.season, week: ctx.week, dates: ctx.dates, team: T.teamName, appTotal: fin.total, humanTotal: T.sleeperPoints, hindsight: E.hindsight(tw), oppHuman: ctx.opp?.sleeperPoints ?? null, oppName: ctx.opp?.teamName ?? null, log, lineupBySlot };
}

export { etDate };
