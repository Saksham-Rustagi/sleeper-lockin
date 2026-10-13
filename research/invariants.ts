// Rule / legality / sanity checker for Lock-In policies (ENGINE_V2 Phase 1.1).
// The engine is stepped ONE EVENT AT A TIME through its own simulate() (events.slice(0, i+1) from index i), with
// observe-only hooks wrapped around the policy's hooks (they return exactly what the policy returns), and every state
// diff is checked against the Sleeper rules. A separate "physical lineup" tracker records where every in-game, held
// and locked player actually sits (the engine itself only tracks pinned and locked slots), so lineup changes can be
// checked for reachability by legal Sleeper moves (move into an empty eligible slot / swap two movable starters each
// eligible for the other's slot; loose (unheld) players can always be benched, a held player can't without forfeiting).
//
// Count keys:  L_*  rule/legality violations      F_*  held-score forfeits by reason (explicit choices)
//              S_*  sanity / dominated actions     I_*  information (not violations)
import * as E from "./engine";

export interface Report { counts: Record<string, number>; amounts: Record<string, number>; examples: Record<string, string[]> }
export const newReport = (): Report => ({ counts: {}, amounts: {}, examples: {} });
export function mergeReport(a: Report, b: Report, maxEx = 8) {
  for (const [k, v] of Object.entries(b.counts)) a.counts[k] = (a.counts[k] || 0) + v;
  for (const [k, v] of Object.entries(b.amounts)) a.amounts[k] = (a.amounts[k] || 0) + v;
  for (const [k, v] of Object.entries(b.examples)) { const l = (a.examples[k] ??= []); for (const x of v) if (l.length < maxEx) l.push(x); }
}

// ---------------- placement & reachability ----------------
const elig = (tw: { slots: number[]; pmask: number[] }, p: number, s: number) => (tw.slots[s] & tw.pmask[p]) !== 0;
// a matching of players into the open slots (prefer[p] tried first), or null
export function placeAll(slots: number[], pmask: number[], open: number, players: number[], prefer?: ArrayLike<number>): Map<number, number> | null {
  const nS = slots.length; const match = new Int32Array(nS).fill(-1);
  const aug = (p: number, seen: Uint8Array): boolean => {
    const order: number[] = []; const pf = prefer ? prefer[p] : -1;
    if (pf >= 0) order.push(pf); for (let s = 0; s < nS; s++) if (s !== pf) order.push(s);
    for (const s of order) {
      if (!((open >> s) & 1) || seen[s] || !(slots[s] & pmask[p])) continue;
      seen[s] = 1;
      if (match[s] < 0 || aug(match[s], seen)) { match[s] = p; return true; }
    }
    return false;
  };
  for (const p of players) if (!aug(p, new Uint8Array(nS))) return null;
  const m = new Map<number, number>(); match.forEach((p, s) => { if (p >= 0) m.set(p, s); });
  return m;
}
// BFS over arrangements of `players` (currently at cur[i]) inside the movable slots using single Sleeper moves.
// Returns the first arrangement satisfying goal (fewest moves), or null if none is reachable.
export function reach(slots: number[], pmask: number[], movable: number, players: number[], cur: number[], goal: (pos: Int8Array) => boolean, maxStates = 400000):
  { pos: Int8Array; moves: number } | null | "capped" {
  const n = players.length; const nS = slots.length;
  const start = Int8Array.from(cur);
  if (goal(start)) return { pos: start, moves: 0 };
  const key = (a: Int8Array) => { let k = 0; for (let i = 0; i < n; i++) k = k * 16 + a[i]; return k; };
  const seen = new Set<number>([key(start)]); let frontier: Int8Array[] = [start]; let depth = 0;
  while (frontier.length) {
    depth++; const next: Int8Array[] = [];
    for (const a of frontier) {
      const occ = new Int8Array(nS).fill(-1); for (let i = 0; i < n; i++) occ[a[i]] = i;
      const push = (b: Int8Array): { pos: Int8Array; moves: number } | null => {
        const k = key(b); if (seen.has(k)) return null; seen.add(k);
        if (goal(b)) return { pos: b, moves: depth };
        next.push(b); return null;
      };
      for (let i = 0; i < n; i++) {
        const p = players[i];
        for (let s = 0; s < nS; s++) {
          if (!((movable >> s) & 1) || !(slots[s] & pmask[p]) || s === a[i]) continue;
          const j = occ[s];
          if (j < 0) { const b = a.slice(); b[i] = s; const r = push(b); if (r) return r; }
          else if (j > i && slots[a[i]] & pmask[players[j]]) { const b = a.slice(); b[i] = s; b[j] = a[i]; const r = push(b); if (r) return r; }
        }
      }
      if (seen.size > maxStates) return "capped";
    }
    frontier = next;
  }
  return null;
}

// ---------------- physical lineup tracker ----------------
const NONE = 0, PINNED = 1, HELD = 2, LOCKED = 3, PHANTOM = 4; // phantom: the engine thinks he holds a score, but he had to leave the lineup
class Tracker {
  status: Uint8Array; pos: Int32Array; heldFrom: Int32Array; heldX: Float64Array; lockedX: Float64Array; lockTarget: Int32Array;
  constructor(nP: number, nS: number) {
    this.status = new Uint8Array(nP); this.pos = new Int32Array(nP).fill(-1); this.heldFrom = new Int32Array(nP).fill(-1);
    this.heldX = new Float64Array(nP); this.lockedX = new Float64Array(nS); this.lockTarget = new Int32Array(nP).fill(-1);
  }
  occ(nS: number) { const o = new Int32Array(nS).fill(-1); this.status.forEach((s, p) => { if (s >= PINNED && s <= LOCKED && this.pos[p] >= 0) o[this.pos[p]] = p; }); return o; }
  // slots nobody can move out of: in-game players and locks already in place (a lock decided this moment still moves)
  frozen() { let m = 0; this.status.forEach((s, p) => { if (s === PINNED || (s === LOCKED && this.lockTarget[p] < 0)) m |= 1 << this.pos[p]; }); return m; }
  held() { const h: number[] = []; this.status.forEach((s, p) => { if (s === HELD) h.push(p); }); return h; }
  free(p: number) { this.status[p] = NONE; this.pos[p] = -1; this.heldFrom[p] = -1; }
}

export interface CheckResult { total: number; trackerTotal: number; rep: Report; overrides: number; tipoffs: number }

// Run policy `pol` (+ its own hooks `inner`) on one realised week and check every step.
// Decisions taken at the same instant (deadline locks/releases of players tipping at t, and the tip-off at t) form one
// "moment": a user would bench the let-go players first, then rearrange, then lock; the check finds any legal order.
export function runChecked(tw: E.TeamWeek, pol: E.Policy, events: E.Ev[], actual: Float64Array, played: Uint8Array, inner?: E.Hooks,
  opts: { label?: string; maxEx?: number } = {}): CheckResult {
  const nS = tw.slots.length, nP = tw.pmask.length; const ALL = (1 << nS) - 1;
  const st = E.initState(tw); const tr = new Tracker(nP, nS); const R = newReport();
  const maxEx = opts.maxEx ?? 3; const label = opts.label ?? "";
  const lastGame = tw.byPlayer.map((l) => (l.length ? l[l.length - 1] : -1));
  let t = 0;
  const day = (x: number) => { const d = new Date(x - 5 * 3600e3); return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}ET`; };
  const nm = (p: number) => tw.names[p]; const sn = (s: number) => `${tw.slotNames[s]}#${s}`;
  const hit = (k: string, msg?: string, amount?: number) => {
    R.counts[k] = (R.counts[k] || 0) + 1; if (amount !== undefined) R.amounts[k] = (R.amounts[k] || 0) + amount;
    if (msg !== undefined) { const l = (R.examples[k] ??= []); if (l.length < maxEx) l.push(`${label} ${day(t)}: ${msg}`); }
  };
  const maskOf = (ss: Iterable<number>) => { let m = 0; for (const s of ss) m |= 1 << s; return m; };
  // observe-only hook wrappers: they return exactly what the policy's own hooks return
  type StartCall = { rule: Map<number, number>; applied: Map<number, number>; overridden: boolean; tipping: number[]; gameOf: Map<number, number> };
  let startCall: StartCall | null = null;
  const lastStartCall = (): StartCall | null => startCall; // (read through a function: it is set inside the hook closure)
  let overrides = 0, tipoffs = 0;
  const hooks: E.Hooks = {
    decideLock: (s, p, tt, evIdx, ev) => (inner?.decideLock ? inner.decideLock(s, p, tt, evIdx, ev) : undefined) as any,
    decideStarts: (s, tt, evIdx, tipping, pending, gameOf, slotOf, free) => {
      const alt = inner?.decideStarts ? inner.decideStarts(s, tt, evIdx, tipping, pending, gameOf, slotOf, free) : undefined;
      // the lineup startGroup applies: the hook's (or rule's) map, with held scores re-seated unless legacy "reseat"
      const applied = E.legacy(pol, "reseat") ? (alt ?? slotOf) : E.reseatHeld(tw, s, alt ?? slotOf, tipping, pending, gameOf, free);
      startCall = { rule: new Map(slotOf), applied: new Map(applied), overridden: !!alt, tipping: tipping.slice(), gameOf: new Map(gameOf) };
      return alt;
    },
  };
  const snaps: { t: number; occ: Int32Array }[] = [];
  const idle: { p: number; g: number; t: number; end: number; slots: number[]; exante: boolean }[] = [];
  const released = new Int32Array(nP).fill(-1); // let go at his own deadline (game index); resolved at the tip-off
  const lockers: number[] = [];                 // locks decided this moment, not yet physically resolved

  // rule checks of a lock that don't depend on where people sit
  const lockLegal = (before: E.State, p: number, s: number, ctx: string) => {
    const x = st.lockedPts[s];
    if (tr.status[p] === PHANTOM) hit("L_count_forfeited", `${ctx}: locked ${nm(p)} ${x} although he had to leave the lineup earlier (forfeited)`, x);
    else if (tr.status[p] !== HELD) hit("L_lock_not_held", `${ctx}: locked ${nm(p)} (${x}) who holds no score from a started game`);
    const g0 = tr.heldFrom[p];
    if (g0 >= 0) {
      if (!before.started[g0]) hit("L_lock_not_started", `${nm(p)} locked from an unstarted game`);
      const want = played[g0] ? actual[g0] : 0; if (Math.abs(want - x) > 1e-9) hit("L_lock_pts_mismatch", `${nm(p)} locked ${x}, his game scored ${want}`);
      for (const gi of tw.byPlayer[p]) if (tw.games[gi].tip > tw.games[g0].end && tw.games[gi].tip < t) hit("L_lock_stale", `${nm(p)} locked a score older than his last tip-off`);
      if (g0 === lastGame[p]) hit("I_lock_final_game");
    }
    if (!elig(tw, p, s)) hit("L_lock_inelig", `${nm(p)} locked into ineligible ${sn(s)}`);
    if (before.lockedBy[s] >= 0 || before.pinned[s] >= 0) hit("L_lock_slot_taken", `${nm(p)} locked into ${sn(s)} which was locked/in use`);
    if (x < 0) hit("S_lock_negative", `locked ${nm(p)} at ${x} (letting go scores 0)`, -x);
    else if (x === 0) hit("S_lock_zero", `locked ${nm(p)} at 0 (${g0 >= 0 && !played[g0] ? "DNP" : "scored 0"})`);
    tr.lockedX[s] = tr.status[p] === HELD ? tr.heldX[p] : 0; // independent of the engine's lockedPts: a score he no longer holds is worth 0
    if (tr.status[p] === PHANTOM) tr.pos[p] = -1;
    tr.status[p] = LOCKED; tr.lockTarget[p] = s; tr.heldFrom[p] = -1; lockers.push(p);
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]; t = e.t;
    const before = E.cloneState(st);
    startCall = null;
    E.simulate(tw, pol, events.slice(0, i + 1), actual, played, st, i, hooks);
    // generic: locked slots never change, pinned players stay put during their game, locked players never play
    for (let s = 0; s < nS; s++) {
      if (before.lockedBy[s] >= 0 && (st.lockedBy[s] !== before.lockedBy[s] || st.lockedPts[s] !== before.lockedPts[s])) hit("L_locked_changed", `locked ${sn(s)} changed`);
      const q = before.pinned[s];
      if (q >= 0 && st.pinned[s] !== q && !(e.kind === 0 && tw.games[e.g].p === q && before.inGame[q] === e.g)) hit("L_pinned_moved", `${nm(q)} left ${sn(s)} during his game`);
    }
    const newLocks: [number, number][] = [];
    for (let s = 0; s < nS; s++) if (before.lockedBy[s] < 0 && st.lockedBy[s] >= 0) newLocks.push([st.lockedBy[s], s]);
    for (let p = 0; p < nP; p++) if (st.isLocked[p] && st.inGame[p] >= 0 && before.inGame[p] !== st.inGame[p]) hit("L_start_locked_player", `locked ${nm(p)} started`);

    if (e.kind === 0) {
      const p = tw.games[e.g].p;
      if (before.inGame[p] === e.g) {
        const x = played[e.g] ? actual[e.g] : 0;
        if (st.pendingX[p] !== x) hit("L_heldX_mismatch", `${nm(p)} holds ${st.pendingX[p]} after scoring ${x}`);
        if (st.inGame[p] !== -1 || Array.from(st.pinned).includes(p)) hit("L_pin_not_released", `${nm(p)} still pinned after his game`);
        if (tr.status[p] === PINNED) { tr.status[p] = HELD; tr.heldFrom[p] = e.g; tr.heldX[p] = x; }
      }
      if (newLocks.length) hit("L_unexpected_change", "lock at a game end with a deferring policy");
    } else if (e.kind === 1) {
      const p = tw.games[e.g].p;
      const wasPending = !Number.isNaN(before.pendingX[p]) && !before.isLocked[p];
      for (const [q, s] of newLocks) { if (q !== p) hit("L_unexpected_change", `${nm(q)} locked at ${nm(p)}'s deadline`); lockLegal(before, q, s, "deadline"); }
      if (wasPending && !st.isLocked[p] && Number.isNaN(st.pendingX[p])) {
        released[p] = e.g; if (tr.status[p] === HELD) { tr.heldX[p] = before.pendingX[p]; tr.status[p] = NONE; tr.pos[p] = -1; } else if (tr.status[p] === PHANTOM) tr.status[p] = NONE;
      }
    } else {
      // ---- the moment at t: let-go players leave first, locks + lineup are resolved jointly ----
      const groupPlayers = e.group!.map((g) => tw.games[g].p);
      const F: [number, number][] = []; // [player, held score] let go at this tip-off
      for (let p = 0; p < nP; p++) {
        const wasP = !Number.isNaN(before.pendingX[p]) && !before.isLocked[p];
        if (!wasP || st.isLocked[p] || !Number.isNaN(st.pendingX[p])) continue;
        if (groupPlayers.includes(p)) { hit("L_state_mismatch", `${nm(p)} pending at his own tip-off`); continue; }
        if (tr.status[p] === PHANTOM) { hit("F_after_phantom", undefined, before.pendingX[p]); tr.free(p); continue; }
        F.push([p, before.pendingX[p]]); tr.free(p);
      }
      for (const [q, s] of newLocks) lockLegal(before, q, s, "tip-off");
      const sc = lastStartCall();
      const M = sc ? sc.applied : new Map<number, number>();
      const tipping = sc ? sc.tipping : [];
      const starters = tipping.filter((p) => M.has(p));
      const starterSlots = new Set(starters.map((p) => M.get(p)!));
      const lockSlots = new Set(lockers.map((p) => tr.lockTarget[p]));
      const movable = ALL & ~tr.frozen();
      if (sc) {
        tipoffs++; if (sc.overridden) { overrides++; hit("I_start_override"); }
        const usedS = new Set<number>();
        for (const p of starters) {
          const s = M.get(p)!; const g = sc.gameOf.get(p)!;
          if (!elig(tw, p, s)) hit("L_start_bad_slot", `${nm(p)} started in ineligible ${sn(s)}`);
          if (!((movable >> s) & 1) || lockSlots.has(s)) hit("L_start_bad_slot", `${nm(p)} started in ${sn(s)} which is locked or in use`);
          if (usedS.has(s)) hit("L_start_bad_slot", `two starters in ${sn(s)}`); usedS.add(s);
          if (st.inGame[p] !== g || st.pinned[s] !== p || !st.started[g]) hit("L_state_mismatch", `${nm(p)} start not recorded as decided`);
          if (tr.status[p] === HELD) hit("L_start_while_held", `${nm(p)} started while still holding ${tr.heldX[p]}`);
        }
      }
      for (const g of e.group!) if (st.started[g] && !before.started[g] && !starters.includes(tw.games[g].p)) hit("L_state_mismatch", `${nm(tw.games[g].p)} started outside the decided lineup`);
      // joint rearrangement: kept held players to their lineup slots, lockers to their lock slots
      const kept = tr.held();
      if (sc) for (const q of kept) if (!M.has(q)) hit("L_kept_without_slot", `held ${nm(q)} kept but has no slot in the lineup`);
      const players = [...kept, ...lockers.filter((q) => tr.pos[q] >= 0)]; const cur = players.map((q) => tr.pos[q]); // (phantom lockers already reported)
      const tgt = players.map((q, k) => (k >= kept.length ? tr.lockTarget[q] : M.has(q) ? M.get(q)! : cur[k]));
      const blocked = new Int32Array(nS); starterSlots.forEach((s) => (blocked[s] = 1)); lockSlots.forEach((s) => (blocked[s] = 1));
      const lockersPlaced = (a: Int8Array) => { for (let k = kept.length; k < players.length; k++) if (a[k] !== tgt[k]) return false; return true; };
      const okPos = cur.every((s) => s >= 0);
      // (without a lineup decision the kept players have no prescribed slot: only "lockers placed, others anywhere" applies)
      let r = okPos ? reach(tw.slots, tw.pmask, movable, players, cur, sc ? (a) => a.every((s, k) => s === tgt[k]) : (a) => lockersPlaced(a) && a.every((s, k) => k >= kept.length || !blocked[s])) : null;
      if (r === "capped") { hit("I_bfs_capped"); r = { pos: Int8Array.from(tgt), moves: 0 }; }
      if (r) players.forEach((q, k) => (tr.pos[q] = r!.pos[k]));
      else {
        const r2 = okPos ? reach(tw.slots, tw.pmask, movable, players, cur, (a) => lockersPlaced(a) && a.every((s, k) => k >= kept.length || !blocked[s])) : null;
        if (r2 && r2 !== "capped") { hit("I_lineup_equivalent", `engine's placement of held players is unreachable; an equivalent one is reachable`); players.forEach((q, k) => (tr.pos[q] = r2.pos[k])); }
        else {
          const open = movable & ~maskOf(starterSlots) & ~maskOf(lockSlots);
          let keep = kept.slice(); let mm = placeAll(tw.slots, tw.pmask, open, keep, tr.pos);
          if (mm) {
            hit("L_lineup_unreachable", `no legal sequence of moves keeps ${kept.map(nm).join(", ")}${lockers.length ? `, locks ${lockers.map((q) => nm(q) + "->" + sn(tr.lockTarget[q])).join(", ")}` : ""} and seats ${starters.map(nm).join(", ")}`);
          } else {
            // maximum matching (Kuhn: a player that can't be augmented at his turn never can), best held scores first
            keep = []; for (const q of [...kept].sort((a, b) => tr.heldX[b] - tr.heldX[a])) if (placeAll(tw.slots, tw.pmask, open, [...keep, q])) keep.push(q);
            mm = placeAll(tw.slots, tw.pmask, open, keep, tr.pos);
            const lost = kept.filter((q) => !keep.includes(q));
            for (const q of lost) {
              hit("L_held_stranded", `${lockers.length ? `locking ${lockers.map((x) => nm(x) + "->" + sn(tr.lockTarget[x])).join(", ")}` : ""}${starters.length ? ` seating ${starters.map(nm).join(", ")}` : ""} leaves held ${nm(q)} (${tr.heldX[q]}) without a slot: forfeited without a decision`, tr.heldX[q]);
              tr.status[q] = PHANTOM; tr.pos[q] = -1;
            }
          }
          if (mm) for (const [q, s3] of mm) tr.pos[q] = s3;
        }
      }
      for (const q of lockers) {
        const s = tr.lockTarget[q];
        // dominated slot choice: a strictly narrower eligible slot was open and is left unused this moment
        const usedNow = new Set<number>([...starterSlots, ...lockSlots, ...kept.map((k) => tr.pos[k])]);
        for (let s2 = 0; s2 < nS; s2++) {
          if (s2 === s || !((movable >> s2) & 1) || usedNow.has(s2) || !elig(tw, q, s2)) continue;
          if ((tw.slots[s2] & tw.slots[s]) === tw.slots[s2] && tw.slots[s2] !== tw.slots[s]) { hit("S_lock_wider", `locked ${nm(q)} into ${sn(s)} while the narrower ${sn(s2)} was open`); break; }
        }
        if (cur[players.indexOf(q)] !== s) hit("I_lock_moved");
        tr.pos[q] = s; tr.lockTarget[q] = -1;
      }
      for (const p of starters) { if (tr.status[p] !== NONE) tr.free(p); tr.status[p] = PINNED; tr.pos[p] = M.get(p)!; }
      // why was each let-go held score given up?
      const keptNow = tr.held(); const open = movable & ~maskOf(starterSlots) & ~maskOf(lockSlots);
      const reserved = sc ? [...sc.rule.keys()].filter((q) => !sc.tipping.includes(q) && Number.isNaN(before.pendingX[q]) && !st.isLocked[q]) : [];
      // jointly: the largest set (best scores first) that could have stayed even with the reserved players seated is
      // "idle"; then the largest further set that only reserved players displace; the rest made room for tonight
      const byX = [...F].sort((a, b) => b[1] - a[1]);
      const idleSet: number[] = [], resSet: number[] = [];
      for (const [p] of byX) if (placeAll(tw.slots, tw.pmask, open, [...keptNow, ...reserved, ...idleSet, p])) idleSet.push(p);
      for (const [p] of byX) if (!idleSet.includes(p) && placeAll(tw.slots, tw.pmask, open, [...keptNow, ...idleSet, ...resSet, p])) resSet.push(p);
      for (const [p, x] of F) {
        if (idleSet.includes(p)) { hit("F_yield_idle", `${nm(p)} let go of ${x} although he could stay without displacing anyone`, x); if (x > 0) hit("S_forfeit_unforced", `${nm(p)} let go of ${x} although an eligible slot stays free${sc?.overridden ? " (simulation changed the lineup)" : ""}`, x); }
        else if (resSet.includes(p)) hit("F_yield_reserved", `${nm(p)} let go of ${x} for a slot reserved for a later tip-off (he could hold it until then)`, x);
        else hit("F_yield_tipping", `${nm(p)} let go of ${x} for tonight's starters/locks`, x);
      }
      for (const p of groupPlayers) if (released[p] >= 0) {
        const x = tr.heldX[p];
        if (starters.includes(p)) hit("F_deadline_replaced", undefined, x); else hit("F_deadline_benched", `${nm(p)} let go of ${x} at his tip-off and sat`, x);
        released[p] = -1;
      }
      lockers.length = 0;
      // idle-slot benching candidates
      const occ = tr.occ(nS);
      for (const p of tipping) {
        if (M.has(p) || st.isLocked[p]) continue;
        const g = sc!.gameOf.get(p)!; const end = tw.games[g].end;
        const cand: number[] = []; let exante = false;
        const tipsIn = tw.games.filter((q) => q.tip > t && q.tip < end && !st.isLocked[q.p] && q.p !== p);
        for (let s = 0; s < nS; s++) {
          if (!((movable >> s) & 1) || occ[s] >= 0 || !elig(tw, p, s)) continue;
          cand.push(s);
          const wantS = tipsIn.some((q) => elig(tw, q.p, s));
          const heldWant = tipsIn.length > 0 && Array.from({ length: nP }, (_, q) => q).some((q) => q !== p && !st.isLocked[q] && elig(tw, q, s) &&
            (tr.status[q] === HELD || (tr.status[q] === PINNED && st.inGame[q] >= 0 && tw.games[st.inGame[q]].end < end)));
          if (!wantS && !heldWant) exante = true;
        }
        if (cand.length) idle.push({ p, g, t, end, slots: cand, exante });
      }
    }
    // the engine's held / locked sets must match the physical ones
    for (let p = 0; p < nP; p++) {
      const eng = !Number.isNaN(st.pendingX[p]) && !st.isLocked[p]; const phys = tr.status[p] === HELD || tr.status[p] === PHANTOM;
      if (eng && !phys) { hit("L_state_mismatch", `engine holds ${st.pendingX[p]} for ${nm(p)} who is not holding`); tr.status[p] = PHANTOM; tr.heldX[p] = st.pendingX[p]; }
      if (!eng && phys && !(released[p] >= 0)) { hit("L_forfeit_unexplained", `${nm(p)}'s held ${tr.heldX[p]} vanished without a decision`, tr.heldX[p]); tr.free(p); }
      if (st.isLocked[p] !== (tr.status[p] === LOCKED ? 1 : 0)) hit("L_state_mismatch", `${nm(p)} lock state differs`);
    }
    snaps.push({ t, occ: tr.occ(nS) });
  }
  // week end: engine total vs independent recount
  t = events.length ? events[events.length - 1].t : 0;
  const total = E.simulate(tw, pol, events, actual, played, st, events.length).total;
  const pend: number[] = []; const w = new Float64Array(nP); const negEnd = E.legacy(pol, "negEnd");
  for (let p = 0; p < nP; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
    if (!negEnd && st.pendingX[p] <= 0) { if (st.pendingX[p] < 0) hit("I_weekend_benched_negative", undefined, -st.pendingX[p]); continue; } // benched before week end (rule 4)
    pend.push(p); w[p] = st.pendingX[p] + 1000;
  }
  const counted = E.assignExact(tw.slots, E.openMaskOf(st), pend, tw.pmask, w).slotOf;
  let trackerTotal = 0;
  for (let s = 0; s < nS; s++) if (st.lockedBy[s] >= 0) trackerTotal += tr.lockedX[s];
  for (const p of pend) {
    if (!counted.has(p)) { hit("F_weekend_dropped", `${nm(p)}'s held ${st.pendingX[p]} not counted at week end`, st.pendingX[p]); continue; }
    if (tr.status[p] === PHANTOM) { hit("L_count_forfeited", `week end counts ${nm(p)}'s ${st.pendingX[p]} although he had to leave the lineup`, st.pendingX[p]); continue; }
    if (tr.heldFrom[p] !== lastGame[p]) hit("L_weekend_nonfinal", `week end counts ${nm(p)}'s score from a game that is not his last`);
    if (st.pendingX[p] < 0) hit("S_weekend_negative", `week end counts ${nm(p)}'s ${st.pendingX[p]} (benching him scores 0)`, -st.pendingX[p]);
    trackerTotal += tr.heldX[p];
  }
  if (Math.abs(total - trackerTotal) > 1e-6) hit("L_total_mismatch", `engine total ${total} vs legal recount ${trackerTotal}`, total - trackerTotal);
  for (const c of idle) {
    const expost = c.slots.some((s) => snaps.every((sn) => sn.t < c.t || sn.t >= c.end || sn.occ[s] < 0));
    t = c.t;
    if (c.exante) hit("S_idle_bench_exante", `${nm(c.p)} sat (game ${played[c.g] ? actual[c.g] : "DNP"}) while ${c.slots.map(sn).join("/")} stayed free and nobody else could use it`);
    else if (expost) hit("I_idle_bench_expost", `${nm(c.p)} sat (game ${played[c.g] ? actual[c.g] : "DNP"}); ${c.slots.map(sn).join("/")} ended up unused during his game`);
  }
  return { total, trackerTotal, rep: R, overrides, tipoffs };
}

// ---------------- CLI (one team-week per process; see research/runtasks.mjs) ----------------
// node research/dist/invariants.cjs <week> <rid> <out.json> [main|mono7]
//  main : P2LAH + P7H on the real outcomes (checked; totals must equal the backtest), P2LAH checked on NSIM model
//         scenarios, and the monotonicity test for P2LAH: drop each player in turn, NMONO paired (CRN) scenarios.
//  mono7: the monotonicity test for P7H for the players in env PLAYERS (comma list of player indices), on the first
//         N7 scenarios of research/gap.ts (same seeds, so the full-roster arm is gap.ts's P7H run).
if (typeof require !== "undefined" && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs"); const { S, fitModel, teamWeek } = require("./btcommon"); const PL = require("./policies");
  const [week, rid, out, mode = "main"] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]];
  const W = S.weeks.find((x: any) => x.week === week); const { tw, real } = teamWeek(week, rid, fitModel(week));
  const seed = week * 1000 + Number(rid); const row: any = { week, rid, mode }; const t0 = Date.now();
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  if (mode === "main") {
    for (const pn of ["P2LAH", "P7H"]) {
      const ru = PL.runner(pn, tw, seed, real); const t1 = Date.now();
      const r = runChecked(tw, ru.pol, ru.events, real.actual, real.played, ru.hooks, { label: `w${week} r${rid} ${pn} real` });
      row[pn] = { total: r.total, recount: r.trackerTotal, rep: r.rep, overrides: r.overrides, tipoffs: r.tipoffs, ms: Date.now() - t1 };
    }
    const NSIM = Number(process.env.NSIM || 200); const sc = PL.scenarios(tw, NSIM, seed * 7 + 3); const rep = newReport();
    sc.forEach((s: any, k: number) => { const ru = PL.runner("P2LAH", tw, seed, s); mergeReport(rep, runChecked(tw, ru.pol, ru.events, s.actual, s.played, ru.hooks, { label: `w${week} r${rid} P2LAH sim${k}`, maxEx: 2 }).rep, 8); });
    row.P2LAH_sim = { n: NSIM, rep };
    const NM = Number(process.env.NMONO || 1000); const ms = PL.scenarios(tw, NM, seed * 11 + 5);
    const ru0 = PL.runner("P2LAH", tw, seed, real);
    const full = ms.map((s: any) => E.simulate(tw, ru0.pol, ru0.events, s.actual, s.played).total);
    row.mono = { n: NM, full: sum(full) / NM, drops: [] as any[] };
    for (let j = 0; j < tw.pmask.length; j++) {
      if (!tw.byPlayer[j].length) continue;
      const d = PL.dropPlayer(tw, j); const ev = E.buildEvents(d.tw, true);
      const diff = ms.map((s: any, k: number) => E.simulate(d.tw, ru0.pol, ev, Float64Array.from(d.keep, (g: number) => s.actual[g]), Uint8Array.from(d.keep, (g: number) => s.played[g])).total - full[k]);
      const m = sum(diff) / NM; const sd = Math.sqrt(sum(diff.map((x: number) => (x - m) ** 2)) / (NM - 1));
      row.mono.drops.push({ j, name: tw.names[j], games: tw.byPlayer[j].length, gain: m, se: sd / Math.sqrt(NM) });
    }
  } else if (mode === "mono7") {
    const N7 = Number(process.env.N7 || 12); const sc = PL.scenarios(tw, N7, seed * 13 + 7); // = research/gap.ts scenarios
    row.drops = [];
    for (const j of (process.env.PLAYERS || "").split(",").filter(Boolean).map(Number)) {
      const d = PL.dropPlayer(tw, j); const totals: number[] = [];
      sc.forEach((s: any, k: number) => {
        const s2 = { actual: Float64Array.from(d.keep, (g: number) => s.actual[g]), played: Uint8Array.from(d.keep, (g: number) => s.played[g]) };
        const ru = PL.runner("P7H", d.tw, seed + 7919 * (k + 1), s2);
        totals.push(E.simulate(d.tw, ru.pol, ru.events, s2.actual, s2.played, E.initState(d.tw), 0, ru.hooks).total);
      });
      row.drops.push({ j, name: tw.names[j], totals });
    }
  }
  row.ms = Date.now() - t0; row.teamHuman = W.teams[rid].human_points;
  fs.writeFileSync(out, JSON.stringify(row));
}
