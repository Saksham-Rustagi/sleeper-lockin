// "Do now" card (task U): the lineup to have set in Sleeper before the next tip-off, the diff against the current
// Sleeper lineup, and the changes later today (a slot is reused once its player's game ends). Pure: built from the
// advice's views (me.slots = Sleeper now, plan = the engine's lineup per tip-off, decisions = held-score calls).
//  - rows: the 9 starting slots in Sleeper order -> player + short status + the change to make now
//  - changes: the Sleeper moves to make now, in a safe order (free slots first, held players never via the bench)
//  - then: later changes (after a game ends / before a later tip-off) and the lock checks when games end
// Task T2 (Sleeper: a player can be moved at any time, even during his game; moving him between starting slots keeps
// the game, benching him mid-game forfeits it and frees the slot): a player in a game can move between starting slots
// now; only taking him out of the lineup or locking him waits until his game ends (this card never benches a player who
// is playing - except a mid-game forfeit, task T3). An Out player in a game in progress scores 0 anyway: benching him now
// forfeits nothing.
// Task T3: the engine may recommend benching a player in a game in progress now (plan[0].midgame, "BENCH_NOW": forfeits
// that game, frees his slot for this tip-off): a banner, and a bench change now (not after his game) with the reason.
import type { Advice, Decision, TipPlan } from "./advise";

export function slotLabels(names: string[]) {
  const seen: Record<string, number> = {};
  return names.map((n) => { seen[n] = (seen[n] || 0) + 1; return names.filter((x) => x === n).length > 1 ? `${n} ${seen[n]}` : n; });
}

export type DoNowKind = "locked" | "lock" | "held" | "start" | "freeRoll" | "playing" | "idle";
export interface DoNowRow {
  slot: string; player: string | null; pid: string | null; kind: DoNowKind | "empty"; status: string;
  change: string | null; // what to change in this slot now (null = already right)
  later: string | null;  // the next change in this slot later today ("~9:15 PM: Garland in")
}
export interface DoNowStep { t: number; when: string; title: string; items: string[]; tentative: boolean }
export interface DoNowLock { player: string; pid: string; slot: string; score: number; by: string; text: string }
// task T3: bench a player in a game in progress now (forfeits his points so far)
export interface DoNowForfeit { player: string; pid: string; slot: string; pts: number; gain: number; text: string }
export interface DoNow {
  tip: number | null; tipText: string | null; rows: DoNowRow[]; changes: string[]; locks: DoNowLock[];
  forfeits?: DoNowForfeit[]; midgameNotes?: string[]; // task T3: bench-now calls (banner) / players kept in for now (info)
  then: DoNowStep[]; bench: string[]; upToDate: string | null;
  compact: string; // "SG Black (free roll), PG Wallace (held 5.0), F Jalen Johnson" (reminder title)
  // the target lineup at the next tip-off (who starts / holds / locks; value = expected points of tonight's game for
  // a starter, the score for a held / locked one): the notifier's materiality and hysteresis (lib/live/lineupnotify.ts)
  target: { slot: string; pid: string; name: string; kind: DoNowKind; tip: number | null; value: number | null; early: boolean }[];
}
export type DoNowInput = Pick<Advice, "asOf" | "plan" | "decisions"> & { me: Pick<Advice["me"], "slots"> & { players?: Partial<Advice["me"]["players"][number]>[] } };

interface Occ {
  pid: string; name: string; kind: DoNowKind; score?: number | null; proj?: number; lockIf?: number | null;
  label?: string; playProb?: number; end?: number; opp?: string; tip?: number; early?: boolean;
  dnp?: boolean; team?: string; // in a game in progress he is Out for (scores 0, no lock call), his NBA team
}
type Lineup = (Occ | null)[];
interface Change { kind: "bench" | "move" | "swap" | "in" | "lock"; text: string; pids: string[]; slots: number[]; row: number; held?: boolean }

// which positions a slot takes (Sleeper NBA)
const SLOT_POS: Record<string, string[]> = { PG: ["PG"], SG: ["SG"], G: ["PG", "SG"], SF: ["SF"], PF: ["PF"], F: ["SF", "PF"], C: ["C"], UTIL: ["PG", "SG", "SF", "PF", "C"] };
const f1 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "?" : x.toFixed(1));
const etDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ms);
const clock = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(ms);
const dayClock = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const r5 = (ms: number) => Math.round(ms / 300e3) * 300e3; // game ends are estimates: show them to 5 min

export function doNow(a: DoNowInput): DoNow {
  const S = a.me.slots; const L = slotLabels(S.map((s) => s.slot));
  const players = a.me.players ?? [];
  const names = new Map<string, string>();
  for (const p of players) if (p.pid && p.name) names.set(p.pid, p.name);
  for (const s of S) if (s.pid && s.player) names.set(s.pid, s.player);
  // (tolerate partial plan entries: older cached advice, test fixtures)
  const plan: TipPlan[] = a.plan.map((pl) => ({ ...pl, starts: pl.starts ?? [], holds: pl.holds ?? [], benched: pl.benched ?? [], forfeits: pl.forfeits ?? [] }));
  for (const pl of plan) {
    for (const x of [...pl.starts, ...pl.holds, ...(pl.locks ?? []), ...(pl.playing ?? [])]) names.set(x.pid, x.player);
    for (const b of pl.benched) if (b.pid) names.set(b.pid, b.player);
  }
  for (const d of a.decisions) names.set(d.pid, d.player);
  const nm = (pid: string) => names.get(pid) ?? pid;
  const pidOf = (name: string) => [...names.entries()].find(([, v]) => v === name)?.[0];
  const dec = new Map<string, Decision>(a.decisions.map((d) => [d.pid, d]));
  const injury = new Map<string, string | null>();
  for (const p of players) if (p.pid) injury.set(p.pid, p.injury ?? null);
  for (const s of S) if (s.pid && s.injury !== undefined) injury.set(s.pid, s.injury ?? null);
  const posOf = new Map<string, string>(); for (const p of players) if (p.pid && p.pos) posOf.set(p.pid, p.pos);
  // can he play slot s (null: positions unknown)
  const fits = (pid: string, s: number): boolean | null => { const ps = posOf.get(pid); const ok = SLOT_POS[S[s].slot]; return !ps || !ok ? null : ps.split("/").some((x) => ok.includes(x)); };
  // where he sits now / before a tip-off
  const where = (l: Lineup, pid: string) => l.findIndex((o) => o?.pid === pid);
  // how many positions a slot takes (PG 1, G 2, UTIL 5): a new starter goes into the narrowest slot he fits
  const width = (s: number) => SLOT_POS[S[s].slot]?.length ?? 5;
  const at = (label: string) => L.indexOf(label);
  const tip0 = plan[0]?.tip ?? null;
  // a late tip (past its scheduled time, not tipped yet; task T): "7:30 PM (late tip)" - its time is an estimate
  const lateAt = new Map<number, number>(); for (const pl of plan) if (pl.late) lateAt.set(pl.tip, pl.late);
  const tipTxt = (ms: number) => { const l = lateAt.get(ms); const t = l ?? ms; return `${etDay(t) === etDay(a.asOf) ? clock(t) : dayClock(t)}${l ? " (late tip)" : ""}`; };
  // his games on tip-off k's date (ET): "no game today" only when he has none that day (task T)
  const dayGames = (pid: string, t: number) => players.find((x) => x.pid === pid)?.games?.filter((g) => etDay(g.tip) === etDay(t));
  const dayNote = (pid: string, t: number): string | null => {
    const g = dayGames(pid, t); if (!g) return null;
    if (!g.length) return "no game today";
    const nxt = g.filter((x) => x.status !== "post" && x.tip > t).sort((x, y) => x.tip - y.tip)[0];
    if (nxt) return `next game ${tipTxt(nxt.tip)}`;
    if (g.some((x) => x.status === "in" || (x.status === "pre" && x.tip <= t))) return null; // (his game is now)
    return "his game today is over";
  };

  // ---- Sleeper now ----
  const cur: Lineup = S.map((s) => {
    if (!s.pid) return null;
    const base = { pid: s.pid, name: s.player ?? nm(s.pid) };
    if (s.locked || s.state === "locked") return { ...base, kind: "locked", score: s.points };
    if (s.state === "playing") return { ...base, kind: "playing", end: s.gameEnd, lockIf: s.dnp ? null : s.lockIf ?? null, ...(s.dnp ? { dnp: true, team: s.team } : {}) };
    if (s.state === "held") return { ...base, kind: "held", score: s.points };
    return { ...base, kind: "idle" };
  });
  const curHeld = new Map<string, number>(); cur.forEach((o) => { if (o?.kind === "held" && o.score != null) curHeld.set(o.pid, o.score); });

  // lock cut-off per player: the held-score call, the quick rule's for a game in progress, else his planned start's
  const cutoff = new Map<string, number>();
  for (const pl of plan) for (const x of pl.starts) if (x.lockIf != null && !cutoff.has(x.pid)) cutoff.set(x.pid, x.lockIf);
  cur.forEach((o) => { if (o?.lockIf != null) cutoff.set(o.pid, o.lockIf); });
  for (const d of a.decisions) if (d.threshold != null) cutoff.set(d.pid, d.threshold);
  const benchedAt = (k: number) => new Set(plan[k].benched.map((b) => b.pid ?? pidOf(b.player)).filter(Boolean) as string[]);
  // task T3: players in a game in progress the engine benches now (forfeit)
  const mgBench = new Map((plan[0]?.midgame ?? []).filter((m) => m.recommended === "BENCH_NOW").map((m) => [m.pid, m]));
  const forfeit0 = new Set((plan[0]?.forfeits ?? []).map((f) => pidOf(f.player)).filter(Boolean) as string[]);
  // ---- who is in the lineup at each tip-off (the engine's plan) and the engine's slot for him (a hint only) ----
  // Which slot a player gets among equally good options is arbitrary in the engine (Monte-Carlo ordering, slot order),
  // so it is never by itself a reason to move anyone: placement is re-solved here, sticky to where players sit.
  interface Item { o: Occ; hint: number; lock: boolean }
  const lockOcc = (pid: string, name: string, score: number | null | undefined): Occ => ({ pid, name, kind: "lock", score, lockIf: cutoff.get(pid) ?? null });
  const tips = plan.map((pl, k) => {
    const items: Item[] = []; const playing: Item[] = [];
    const has = (pid: string) => items.some((x) => x.o.pid === pid) || playing.some((x) => x.o.pid === pid);
    const add = (to: Item[], o: Occ, hint: number, lock = false) => { if (!has(o.pid)) to.push({ o, hint, lock }); };
    for (const x of pl.locks ?? []) add(items, lockOcc(x.pid, x.player, x.score), at(x.slot), true);
    for (const x of (pl.playing ?? []).filter((y) => !y.dnp)) add(playing, { pid: x.pid, name: x.player, kind: "playing", end: x.end, lockIf: x.dnp ? null : cutoff.get(x.pid) ?? null, ...(x.dnp ? { dnp: true, team: x.team } : {}) }, at(x.slot));
    for (const x of pl.starts) add(items, { pid: x.pid, name: x.player, kind: (x.label && /free roll/.test(x.label) ? "freeRoll" : "start") as DoNowKind, proj: x.proj, lockIf: x.lockIf, label: x.label, playProb: x.playProb, end: x.end, opp: x.opp, tip: pl.tip }, at(x.slot));
    for (const h of pl.holds) {
      const d = k === 0 ? dec.get(h.pid) : undefined;
      if (d?.recommended === "BENCH") continue;
      if (d?.recommended === "LOCK") add(items, lockOcc(h.pid, h.player, h.score), at(h.slot), true);
      else add(items, { pid: h.pid, name: h.player, kind: "held", score: h.score, lockIf: d?.threshold ?? null }, at(h.slot));
    }
    if (k === 0) {
      // safety: a held score the advice keeps (HOLD / LOCK) is never dropped because the plan didn't place it
      for (const d of a.decisions) {
        if (d.recommended === "BENCH") continue;
        const hint = [where(cur, d.pid), ...L.map((_, i) => i).filter((i) => S[i].slot === d.recommendedSlot)].find((i) => i >= 0) ?? -1;
        if (d.recommended === "LOCK") add(items, lockOcc(d.pid, d.player, d.score), hint, true);
        else add(items, { pid: d.pid, name: d.player, kind: "held", score: d.score, lockIf: d.threshold }, hint);
      }
    }
    return { items, playing };
  });
  // the lineup at tip-off k: fixed = locks so far (carry); players still in a game (they must keep a starting slot but
  // may move between starting slots - task T2), this tip-off's new locks, starters and held scores are assigned to the
  // free slots by one search, lexicographic:
  //   1. as many placed as possible (players in a game first)
  //   2. every later tip-off's lineup still placeable (fwd: a backtracking search over the later tip-offs, narrowest slot
  //      first, first feasible path wins), so a slot is freed or a held player moved now only when a later planned
  //      move needs it
  //   3. as many as possible stay where they sit (prev, else Sleeper now)
  //   4. a player who does move / comes in: the narrowest slot he fits, then the slot of a player going to the bench, then
  //      an empty slot, then the first in Sleeper order
  // (the engine's slot is not a tie-break: it is arbitrary among equal options, and following it made the card follow
  // the engine's relabels.) A lock keeps the engine's slot name (consumed for the rest of the week); positions unknown ->
  // the engine's slot name.
  const locksOf = (u: Lineup): Lineup => u.map((o) => (o && (o.kind === "locked" || o.kind === "lock") ? { ...o, kind: "locked" as DoNowKind } : null));
  const setup = (k: number, carry: Lineup, mine: Map<string, number>, prev: Lineup, flex: boolean) => {
    const { items, playing } = tips[k];
    const t = carry.slice(); const pins = new Map(mine);
    // (a player in a game: his slot so far is the hint - positions unknown -> a slot of the same name)
    const live = playing.map((x) => ({ ...x, hint: [pins.get(x.o.pid), where(cur, x.o.pid), x.hint].find((i) => i !== undefined && i >= 0) ?? -1 }));
    const its = [...live, ...items].filter((it) => where(t, it.o.pid) < 0);
    const free = L.map((_, i) => i).filter((i) => !t[i]);
    const sits = (pid: string) => { const p = where(prev, pid); return p >= 0 ? p : where(cur, pid); };
    const ok = (it: Item, s: number) => { const f = fits(it.o.pid, s); return it.lock || f === null ? it.hint >= 0 && S[s].slot === S[it.hint].slot : f; };
    // (a slot whose occupant goes to the bench: one swap in Sleeper; an empty one: one move)
    const out = benchedAt(k); if (k === 0) { forfeit0.forEach((p) => out.add(p)); a.decisions.filter((d) => d.recommended === "BENCH").forEach((d) => out.add(d.pid)); mgBench.forEach((_, p) => out.add(p)); }
    const W = (it: Item, s: number) => (it.o.kind === "playing" ? 1e5 : 0) + (!flex && sits(it.o.pid) === s ? 110 : 10 - width(s) + (prev[s] && out.has(prev[s]!.pid) ? 0.3 : !prev[s] ? 0.25 : 0) + (fits(it.o.pid, s) === null && s === it.hint ? 0.01 : 0));
    const cands = its.map((it) => free.filter((s) => ok(it, s)).sort((x, y) => W(it, y) - W(it, x) || x - y));
    const order = its.map((_, i) => i).sort((x, y) => cands[x].length - cands[y].length || x - y);
    const fill = (pick: number[]) => {
      const u = t.slice(); const m = new Map(pins);
      pick.forEach((s, j) => { if (s >= 0) { const o = its[order[j]].o; u[s] = o; if (o.kind === "start" || o.kind === "freeRoll" || o.kind === "playing") m.set(o.pid, s); } });
      return { u, m };
    };
    return { its, cands, order, W, fill };
  };
  // fewest occupants of tip-offs j.. that can't be placed (0 = the plan is reachable); budget: leaves left to try
  const fwd = (j: number, carry: Lineup, mine: Map<string, number>, prev: Lineup, budget: { n: number }): number => {
    if (j >= plan.length) return 0;
    const { cands, order, fill } = setup(j, carry, mine, prev, true);
    let best = Infinity; const pick: number[] = []; const used = new Set<number>();
    const dfs = (i: number, miss: number) => {
      if (best === 0 || miss >= best || (budget.n <= 0 && best < Infinity)) return;
      if (i === order.length) { budget.n--; const { u, m } = fill(pick); best = Math.min(best, miss + fwd(j + 1, locksOf(u), m, u, budget)); return; }
      for (const s of cands[order[i]]) { if (used.has(s)) continue; used.add(s); pick.push(s); dfs(i + 1, miss); pick.pop(); used.delete(s); }
      pick.push(-1); dfs(i + 1, miss + 1); pick.pop();
    };
    dfs(0, 0);
    return best;
  };
  interface Placed { t: Lineup; miss: number; mine: Map<string, number> }
  const place = (k: number, carry: Lineup, mine: Map<string, number>, prev: Lineup): Placed => {
    const { its, cands, order, W, fill } = setup(k, carry, mine, prev, false);
    const top = order.map((i) => (cands[i].length ? 1e4 + W(its[i], cands[i][0]) : 0));
    const rest = top.map((_, j) => top.slice(j).reduce((x, y) => x + y, 0)).concat(0);
    let best: number[] = order.map(() => -1); let bestSc = -Infinity; let bestMiss = its.length; let nodes = 0;
    const pick: number[] = []; const used = new Set<number>();
    // (search budgets: 20000 nodes here; forward search 500 leaves per candidate, 20000 in all - then first path only)
    let fwdLeft = 20000;
    const dfs = (j: number, sc: number) => {
      if (++nodes > 20000 || sc + rest[j] <= bestSc) return;
      if (j === order.length) {
        let total = sc;
        if (plan.length > k + 1) {
          const { u, m } = fill(pick); const b = { n: Math.min(500, fwdLeft) };
          total -= 1e3 * fwd(k + 1, locksOf(u), m, u, b); fwdLeft -= Math.min(500, fwdLeft) - Math.max(0, b.n);
        }
        if (total > bestSc) { bestSc = total; best = pick.slice(); bestMiss = pick.filter((s) => s < 0).length; }
        return;
      }
      const it = its[order[j]];
      for (const s of cands[order[j]]) {
        if (used.has(s)) continue;
        used.add(s); pick.push(s); dfs(j + 1, sc + 1e4 + W(it, s)); pick.pop(); used.delete(s);
      }
      pick.push(-1); dfs(j + 1, sc); pick.pop(); // (can't place him)
    };
    dfs(0, 0);
    const { u, m } = fill(best);
    return { t: u, miss: bestMiss, mine: m };
  };
  const R: Lineup[] = [];
  {
    let carry: Lineup = cur.map((o) => (o?.kind === "locked" ? o : null));
    let mine = new Map<string, number>(); cur.forEach((o, s) => { if (o?.kind === "playing" && !o.dnp) mine.set(o.pid, s); });
    let prev = cur;
    plan.forEach((_, k) => {
      const r = place(k, carry, mine, prev);
      R.push(r.t); mine = r.mine; prev = r.t; carry = locksOf(r.t);
    });
  }
  // a later starter today whose slot nobody uses before his game: set him now (one trip to Sleeper instead of two)
  for (let k = 1; k < plan.length; k++) {
    if (etDay(plan[k].tip) !== etDay(plan[0].tip)) break;
    R[k].forEach((q, s) => {
      if (!q || (q.kind !== "start" && q.kind !== "freeRoll") || q.tip !== plan[k].tip) return;
      if (cur.some((o) => o?.pid === q.pid && o.kind === "playing")) return;
      for (let j = 0; j < k; j++) if (R[j][s] || R[j].some((o) => o?.pid === q.pid) || plan[j].benched.some((b) => (b.pid ?? pidOf(b.player)) === q.pid)) return;
      for (let j = 0; j < k; j++) R[j][s] = { ...q, early: true };
    });
  }

  // ---- final lineups: previous occupants the plan doesn't use stay where they are when that's harmless ----
  const F: Lineup[] = [];
  let prev = cur;
  plan.forEach((_, k) => {
    const t = R[k].slice();
    const must = benchedAt(k); if (k === 0) { forfeit0.forEach((p) => must.add(p)); a.decisions.filter((d) => d.recommended === "BENCH").forEach((d) => must.add(d.pid)); mgBench.forEach((_, p) => must.add(p)); }
    prev.forEach((r, s) => {
      if (!r || r.kind === "locked" || r.kind === "lock" || t.some((x) => x?.pid === r.pid) || must.has(r.pid)) return;
      const keep: Occ = { ...r, kind: r.kind === "held" ? "held" : r.dnp && k === 0 ? "playing" : "idle", early: false };
      if (!t[s]) { t[s] = keep; return; }
      // displaced: take the slot the newcomer left (a single swap in Sleeper), or keep a held score in any free slot
      const from = prev.findIndex((o) => o?.pid === t[s]!.pid);
      const free = [from, ...(r.kind === "held" ? t.map((_, i) => i) : [])].find((i) => i >= 0 && !t[i] && fits(r.pid, i) === true);
      if (free !== undefined) t[free] = keep;
    });
    F.push(t); prev = t;
  });

  // ---- diffs ----
  const benchWhy = (r: Occ, k: number) => {
    const inj = injury.get(r.pid);
    const mf = k === 0 ? mgBench.get(r.pid) : undefined;
    if (mf) return ` now (in his game - forfeits his ${f1(mf.pts)} so far${mf.out ? `, ${mf.out}` : ""}; frees ${mf.slot}${mf.for.length ? ` for ${mf.for.join(" & ")}` : ""} at ${tipTxt(mf.tip)}, +${f1(mf.gain)} exp pts)`;
    if (r.dnp) return ` now (${inj || "out"} - not playing in his game in progress, scores 0: benching him forfeits nothing)`;
    if (r.kind === "held" || (k === 0 && curHeld.has(r.pid))) return ` (lets go of his held ${f1(r.score ?? curHeld.get(r.pid))})`;
    const b = plan[k]?.benched.find((x) => (x.pid ?? pidOf(x.player)) === r.pid);
    if (inj && /^(out|doubtful|inactive|sus)/i.test(inj)) return ` (${inj} - ruled out)`;
    if (b) return b.label ? ` (${b.label.split(":")[0]})` : ` (sits ${dayClock(plan[k].tip)}, proj ${f1(b.proj)})`;
    const n = plan[k] ? dayNote(r.pid, plan[k].tip) : null;
    return n ? ` (${n})` : "";
  };
  const diff = (p: Lineup, t: Lineup, k: number): Change[] => {
    const out: Change[] = [];
    t.forEach((q, s) => {
      if (!q) return;
      const r = p[s];
      if (r?.pid !== q.pid) {
        const from = p.findIndex((o) => o?.pid === q.pid);
        const gone = r && !t.some((x) => x?.pid === r.pid) ? [r.pid] : [];
        // (a player in a game moved between starting slots keeps the game - task T2)
        const inGame = (o: Occ | null | undefined) => !!o && ((o.kind === "playing" && !o.dnp) || (k > 0 && (o.kind === "start" || o.kind === "freeRoll") && !o.early && o.end != null && o.end > plan[k].tip));
        const ig = inGame(p[from]) || (r && inGame(r)) ? " (in-game moves between starting slots keep the game)" : "";
        if (from >= 0 && r && t[from]?.pid === r.pid) { if (s < from) out.push({ kind: "swap", text: `swap ${q.name} (${L[from]}) ↔ ${r.name} (${L[s]})${ig}`, pids: [q.pid, r.pid], slots: [s, from], row: s, held: q.kind === "held" || r.kind === "held" }); }
        else if (from >= 0) out.push({ kind: "move", text: `move ${q.name} ${L[from]} → ${L[s]}${inGame(p[from]) ? " (in his game now - moving between starting slots keeps it)" : q.kind === "held" ? ` (held ${f1(q.score)} - keep him in a starting slot, never via the bench)` : ""}`, pids: [q.pid, ...gone], slots: [from, s], row: s, held: q.kind === "held" });
        else out.push({ kind: "in", text: `put ${q.name} in ${L[s]}`, pids: [q.pid, ...gone], slots: [s], row: s });
      }
      if (q.kind === "lock") out.push({ kind: "lock", text: `LOCK ${q.name} in ${L[s]}${k > 0 || cur.some((o) => o?.pid === q.pid && o.kind === "playing") ? (q.lockIf != null ? ` if he scores ≥ ${f1(q.lockIf)}` : "") : ""}`, pids: [q.pid], slots: [s], row: s });
    });
    p.forEach((r, s) => {
      if (!r || r.kind === "locked" || t.some((x) => x?.pid === r.pid)) return;
      out.push({ kind: "bench", text: `bench ${r.name}${benchWhy(r, k)}`, pids: [r.pid], slots: [s], row: s, held: r.kind === "held" });
    });
    return out;
  };
  // safe order in Sleeper: free the slots first (benches - a held score is only benched when the plan lets it go),
  // move held players between starting slots, then swaps / new starters, locks last
  const rank = (c: Change) => (c.kind === "bench" ? 0 : c.kind === "move" ? (c.held ? 1 : 2) : c.kind === "swap" ? 2 : c.kind === "in" ? 3 : 5);
  const order = (cs: Change[]) => cs.map((c, i) => [c, i] as const).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map((x) => x[0]);
  const orderL = <T extends { c: Change }>(xs: T[]) => { const o = order(xs.map((x) => x.c)); return o.map((c) => xs.find((x) => x.c === c)!); };

  // changes that wait for a game in progress: anything touching a player in a game who leaves the lineup or is locked
  // (he can only be locked after it ends; benched mid-game he'd forfeit it), or his slot (closed under "touches a slot
  // whose occupant has to wait"). Moves of a player in a game between starting slots don't wait (task T2).
  const split = (cs: Change[], p: Lineup, t: Lineup, live: Map<string, number>) => {
    const wait = new Map([...live].filter(([pid]) => { const o = t.find((x) => x?.pid === pid); return !o || o.kind === "lock" || o.kind === "locked"; }));
    const dep = new Map<Change, number>(); let grew = true;
    const touched = (c: Change) => [...c.pids, ...c.slots.map((s) => p[s]?.pid ?? "")];
    while (grew) {
      grew = false;
      for (const c of cs) {
        if (dep.has(c)) continue;
        const ends = touched(c).filter((x) => wait.has(x)).map((x) => wait.get(x)!);
        if (!ends.length) continue;
        const end = Math.max(...ends); dep.set(c, end); grew = true;
        c.pids.forEach((x) => { if (!wait.has(x)) wait.set(x, end); });
      }
    }
    return { now: cs.filter((c) => !dep.has(c)), later: cs.filter((c) => dep.has(c)).map((c) => ({ c, end: dep.get(c)! })) };
  };

  const steps = new Map<string, DoNowStep & { due: number | null; after: Set<string> }>();
  const step = (t: number, tentative: boolean, due: number | null) => {
    const key = `${Math.round(t / 60e3)}|${due ?? ""}`;
    if (!steps.has(key)) steps.set(key, { t, when: "", title: "", items: [], tentative, due, after: new Set() });
    return steps.get(key)!;
  };
  const rowLater = new Map<number, { when: string; text: string }>();
  // a row's next change (at the same time, who comes in beats who goes to the bench)
  const noteLater = (c: Change, when: string) => {
    for (const s of c.kind === "bench" || c.kind === "swap" ? c.slots : [c.row]) {
      const x = rowLater.get(s);
      if (!x || (x.when === when && /^bench /.test(x.text) && c.kind !== "bench")) rowLater.set(s, { when, text: c.text });
    }
  };

  let nowChanges: Change[] = [];
  let shown: Lineup = cur;
  if (plan.length) {
    const live0 = new Map<string, number>();
    cur.forEach((o) => { if (o?.kind === "playing" && !o.dnp && !mgBench.has(o.pid) && !(plan[0].playing ?? []).some((x) => x.pid === o.pid)) live0.set(o.pid, o.end ?? plan[0].tip); });
    const c0 = diff(cur, F[0], 0);
    const sp = split(c0, cur, F[0], live0);
    nowChanges = order(sp.now);
    // the lineup to set now: the target, except slots still waiting for a game in progress
    const waitSlots = new Set(sp.later.flatMap((x) => x.c.slots));
    // (a player in his game now who only moves keeps his "in game now" status, not the plan's held estimate)
    shown = F[0].map((o, s) => { if (waitSlots.has(s)) return cur[s]; const c = o ? cur.find((x) => x?.pid === o.pid && x.kind === "playing" && !x.dnp) : undefined; return c && o!.kind === "held" ? c : o; });
    for (const { c, end } of orderL(sp.later)) {
      const st = step(end, true, plan[0].tip); st.items.push(c.text);
      c.pids.concat(c.slots.map((s) => cur[s]?.pid ?? "")).forEach((x) => { if (live0.has(x) && live0.get(x) === end) st.after.add(nm(x)); });
      noteLater(c, `~${clock(r5(end))}`);
    }
    for (let k = 1; k < plan.length; k++) {
      const p = F[k - 1];
      const live = new Map<string, number>();
      p.forEach((o) => { if (o && (o.kind === "start" || o.kind === "freeRoll" || o.kind === "playing") && !o.dnp && !o.early && o.end != null && !(plan[k].playing ?? []).some((x) => x.pid === o.pid)) live.set(o.pid, o.end); });
      const sp2 = split(diff(p, F[k], k), p, F[k], live);
      for (const c of order(sp2.now)) { step(plan[k].tip - 1, true, plan[k].tip).items.push(c.text); noteLater(c, `before ${tipTxt(plan[k].tip)}`); }
      for (const { c, end } of orderL(sp2.later)) {
        const st = step(end, true, plan[k].tip); st.items.push(c.text);
        c.pids.concat(c.slots.map((s) => p[s]?.pid ?? "")).forEach((x) => { if (live.get(x) === end) st.after.add(nm(x)); });
        noteLater(c, `~${clock(r5(end))}`);
      }
    }
  }
  // lock checks when games end (cut-off: the score at which locking beats holding)
  const checked = new Set<string>();
  const check = (o: Occ | null) => {
    if (!o || (o.kind !== "start" && o.kind !== "freeRoll" && o.kind !== "playing") || o.end == null || o.lockIf == null || o.dnp || (o.kind === "playing" && mgBench.has(o.pid))) return;
    const key = `${o.pid}|${o.end}`; if (checked.has(key)) return; checked.add(key);
    const st = [...steps.values()].find((x) => Math.abs(x.t - o.end!) < 60e3) ?? step(o.end, o.kind !== "playing", null);
    st.after.add(o.name);
    if (!st.items.some((i) => i.startsWith(`LOCK ${o.name} in`))) st.items.unshift(`${o.name}: lock him if he scores ≥ ${f1(o.lockIf)}`);
  };
  cur.forEach(check); F.forEach((t) => t.forEach(check));
  const until: string[] = [];
  const then = [...steps.values()].sort((x, y) => x.t - y.t).map(({ due, after, ...st }) => {
    const isEnd = after.size > 0;
    const when = isEnd ? `~${tipTxt(r5(st.t))}` : `before ${tipTxt(due ?? st.t)}`;
    const who = `${[...after].join(" & ")}'s game${after.size > 1 ? "s end" : " ends"}`;
    const moves = due && st.items.some((i) => !/lock him if/.test(i));
    const tight = moves && due! - st.t < 15 * 60e3 ? " - tight: if the game runs late, refresh before moving anyone" : "";
    const title = isEnd ? `${when}, when ${who}${moves ? ` (changes due before the ${tipTxt(due!)} tip-off${tight})` : ""}` : `Before the ${tipTxt(due ?? st.t)} tip-off`;
    until.push(isEnd ? `${when}, when ${who}` : `the ${tipTxt(due ?? st.t)} tip-off`);
    return { ...st, when, title, items: st.items.map(cap) };
  });

  // ---- rows ----
  const status = (o: Occ | null, s: number): string => {
    if (!o) { const later = rowLater.get(s); return later ? `empty until ${later.when}` : "empty"; }
    const lk = (x: number | null | undefined) => (x != null ? ` · lock if ≥ ${f1(x)}` : "");
    switch (o.kind) {
      case "locked": return `locked ${f1(o.score)}`;
      case "lock": {
        if (cur.some((c) => c?.pid === o.pid && c.kind === "playing")) return `in game now - lock after it ends${lk(o.lockIf)}`;
        return `LOCK now (${f1(o.score)}${o.lockIf != null ? (o.score! >= o.lockIf ? ` ≥ lock-if ${f1(o.lockIf)}` : `; quick cut-off ${f1(o.lockIf)}, the race says lock`) : ""})`;
      }
      case "held": {
        const d = dec.get(o.pid);
        if (d && !d.deadline) return `held ${f1(o.score)} - last game, counts automatically`;
        return `held ${f1(o.score)} - keep, don't lock${d?.threshold != null ? ` (lock-if ${f1(d.threshold)})` : ""}${d?.deadline ? ` · next game ${dayClock(d.deadline)}` : ""}`;
      }
      case "start": {
        const h = curHeld.get(o.pid);
        return `plays ${tipTxt(o.tip!)}${o.opp ? ` vs ${o.opp}` : ""} (proj ${f1(o.proj)})${lk(o.lockIf)}${h != null ? ` · replaces held ${f1(h)}` : ""}${o.early ? " · set now, slot unused before" : ""}`;
      }
      case "freeRoll": return `free roll - ${injury.get(o.pid) || "injured"}, ${Math.round((o.playProb ?? 0) * 100)}% to play (${tipTxt(o.tip!)})`;
      case "playing":
        if (o.dnp) return `${cap(injury.get(o.pid) || "out")} - not playing in ${o.team ? `the ${o.team}` : "his"} game in progress, scores 0; bench him any time - forfeits nothing, the slot is free now`;
        return `in game now${o.end ? ` (ends ~${clock(r5(o.end))})` : ""}${lk(o.lockIf)}`;
      case "idle": {
        if (tip0 === null) return "no game left - can stay";
        const n = dayNote(o.pid, tip0);
        return n === "no game today" || n === "his game today is over" ? `${n} - can stay` : `no game at ${tipTxt(tip0)}${n ? ` (${n})` : ""} - can stay`;
      }
    }
  };
  const rowChange = new Map<number, string[]>();
  for (const c of nowChanges) for (const s of c.kind === "swap" ? c.slots : [c.row]) rowChange.set(s, [...(rowChange.get(s) ?? []), c.text]);
  const rows: DoNowRow[] = shown.map((o, s) => ({
    slot: L[s], player: o?.name ?? null, pid: o?.pid ?? null, kind: o?.kind ?? "empty", status: status(o, s),
    change: rowChange.has(s) ? rowChange.get(s)!.join(" · ") : null, later: rowLater.has(s) ? `${rowLater.get(s)!.when}: ${rowLater.get(s)!.text}` : null,
  }));

  // ---- lock banners, bench list, nothing-to-do ----
  const locks: DoNowLock[] = a.decisions.filter((d) => d.recommended === "LOCK").map((d) => {
    const s = shown.findIndex((o) => o?.pid === d.pid && o.kind === "lock");
    const slot = s >= 0 ? L[s] : (plan[0]?.locks ?? []).find((x) => x.pid === d.pid)?.slot ?? d.recommendedSlot ?? "?";
    return { player: d.player, pid: d.pid, slot, score: d.score, by: d.deadlineText, text: `LOCK ${d.player} (${f1(d.score)}) in ${slot} - ${d.deadlineText}` };
  });
  const bench: string[] = []; const seenB = new Set<string>();
  plan.forEach((pl) => pl.benched.forEach((b) => {
    const k = b.pid ?? b.player; if (seenB.has(k)) return; seenB.add(k);
    bench.push(`${b.player} - sits ${dayClock(pl.tip)}${b.label ? ` (${b.label.replace(/: don't start/, " - don't start")})` : ` (proj ${f1(b.proj)})`}`);
  }));
  (plan[0]?.forfeits ?? []).forEach((f) => bench.push(`${f.player} - let go of his held ${f1(f.score)} (the slot is worth more)`));
  const forfeits: DoNowForfeit[] = [...mgBench.values()].map((m) => ({ player: m.player, pid: m.pid, slot: m.slot, pts: m.pts, gain: m.gain, text: m.text }));
  const midgameNotes = (plan[0]?.midgame ?? []).filter((m) => m.recommended === "KEEP" && m.deferred !== undefined).map((m) => m.text);
  const upToDate = nowChanges.length || locks.length || forfeits.length ? null
    : !plan.length ? "Your lineup is already correct - no more games for your players this week."
    : `Your lineup is already correct - nothing to do until ${until[0] ?? `the ${plan[0].when} tip-off`}.`;
  const tag = (o: Occ) => (o.kind === "held" ? ` (held ${f1(o.score)})` : o.kind === "freeRoll" ? " (free roll)" : o.kind === "lock" ? ` (LOCK ${f1(o.score)})` : "");
  const gets = new Set(nowChanges.flatMap((c) => (c.kind === "bench" || c.kind === "lock" ? [] : c.kind === "swap" ? c.slots : [c.row]))); // slots getting a player
  const compact = rows.filter((r, s) => gets.has(s) && r.pid).map((r, _, __, s = L.indexOf(r.slot)) => `${r.slot} ${r.player}${tag(shown[s]!)}`).join(", ");
  const value = (o: Occ) => (o.kind === "start" || o.kind === "freeRoll" ? (o.proj ?? 0) * (o.playProb ?? 1) : o.score ?? null);
  const target = (F[0] ?? []).flatMap((o, s) => (o ? [{ slot: L[s], pid: o.pid, name: o.name, kind: o.kind, tip: o.tip ?? null, value: value(o), early: !!o.early }] : []));
  return { tip: tip0, tipText: plan[0]?.when ?? null, rows, changes: nowChanges.map((c) => cap(c.text)), locks, then, bench, upToDate, compact, target,
    ...(forfeits.length ? { forfeits } : {}), ...(midgameNotes.length ? { midgameNotes } : {}) };
}

// plain-text rendering of the card (live checks, logs)
export function doNowText(d: DoNow): string {
  const out: string[] = [];
  for (const l of d.locks) out.push(`🔒 ${l.text}`);
  for (const f of d.forfeits ?? []) out.push(`⚠️ ${f.text}`);
  out.push(`Set your lineup to${d.tipText ? ` (before the ${d.tipText} tip-off)` : ""}:`);
  for (const r of d.rows) out.push(`  ${r.change ? "*" : " "} ${r.slot.padEnd(6)} ${(r.player ?? "-").padEnd(24)} ${r.status}${r.change ? `\n             -> change: ${r.change}` : ""}${r.later ? `\n             -> later ${r.later}` : ""}`);
  out.push(d.upToDate ?? `Do now, in this order:\n${d.changes.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`);
  if (d.then.length) { out.push("Then:"); for (const s of d.then) out.push(`  ${s.title}${s.tentative ? " [tentative]" : ""}\n${s.items.map((i) => `     - ${i}`).join("\n")}`); }
  if (d.bench.length) out.push(`Bench: ${d.bench.join("; ")}`);
  for (const m of d.midgameNotes ?? []) out.push(`(in-game) ${m}`);
  return out.join("\n");
}
