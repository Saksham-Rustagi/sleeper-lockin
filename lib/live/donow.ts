// "Do now" card (task U): the lineup to have set in Sleeper before the next tip-off, the diff against the current
// Sleeper lineup, and the changes later today (a slot is reused once its player's game ends). Pure: built from the
// advice's views (me.slots = Sleeper now, plan = the engine's lineup per tip-off, decisions = held-score calls).
//  - rows: the 9 starting slots in Sleeper order -> player + short status + the change to make now
//  - changes: the Sleeper moves to make now, in a safe order (free slots first, held players never via the bench)
//  - then: later changes (after a game ends / before a later tip-off) and the lock checks when games end
// A change that involves a player who is in a game right now (or his slot) waits until that game ends.
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
export interface DoNow {
  tip: number | null; tipText: string | null; rows: DoNowRow[]; changes: string[]; locks: DoNowLock[];
  then: DoNowStep[]; bench: string[]; upToDate: string | null;
  compact: string; // "SG Black (free roll), PG Wallace (held 5.0), F Jalen Johnson" (reminder title)
}
export type DoNowInput = Pick<Advice, "asOf" | "plan" | "decisions"> & { me: Pick<Advice["me"], "slots"> & { players?: Partial<Advice["me"]["players"][number]>[] } };

interface Occ {
  pid: string; name: string; kind: DoNowKind; score?: number | null; proj?: number; lockIf?: number | null;
  label?: string; playProb?: number; end?: number; opp?: string; tip?: number; early?: boolean;
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
  // this tip-off's starters on the engine's slot names (slots of one name are interchangeable, and they are all in a
  // game for the same stretch), arranged to keep as many players as possible where they sit now
  const arrange = (group: { s: number; o: Occ }[], t: Lineup, pre: Lineup, keep: Set<string>): number[] => {
    const engine = group.map((g) => g.s);
    if (group.length > 6) return engine;
    const cand = [...new Set([...engine, ...L.map((_, i) => i).filter((i) => !t[i] && engine.some((e) => S[e].slot === S[i].slot))])];
    const need = new Map<string, number>(); engine.forEach((e) => need.set(S[e].slot, (need.get(S[e].slot) ?? 0) + 1));
    let best = engine; let bestScore = -Infinity; const pick: number[] = []; const used = new Set<number>();
    // +1 per starter who stays where he sits, -1 per held score he would push out of its slot
    const score = (ss: number[]) => ss.reduce((x, s, gi) => x + (where(pre, group[gi].o.pid) === s ? 1 : 0)
      - (pre[s] && keep.has(pre[s]!.pid) && !group.some((g) => g.o.pid === pre[s]!.pid) ? 1 : 0) + (s === engine[gi] ? 1e-3 : 0), 0);
    const dfs = (gi: number) => {
      if (gi === group.length) { const sc = score(pick); if (sc > bestScore) { bestScore = sc; best = pick.slice(); } return; }
      for (const s of cand) {
        const nmS = S[s].slot; const ok = fits(group[gi].o.pid, s);
        if (used.has(s) || !(need.get(nmS) ?? 0) || (ok === null ? nmS !== S[engine[gi]].slot : !ok)) continue;
        used.add(s); need.set(nmS, need.get(nmS)! - 1); pick.push(s);
        dfs(gi + 1);
        used.delete(s); need.set(nmS, need.get(nmS)! + 1); pick.pop();
      }
    };
    dfs(0);
    return best;
  };
  // held scores: stay where they sit when that slot is free, the rest matched to free slots they can play (the
  // engine's slot first); if that fails, the engine's own placement
  const placeHolds = (hs: { o: Occ; slot: number }[], t: Lineup, prev: Lineup) => {
    const free = () => L.map((_, i) => i).filter((i) => !t[i]);
    const ok = (h: { o: Occ; slot: number }, s: number) => { const f = fits(h.o.pid, s); return f === null ? s === h.slot || S[s].slot === S[h.slot]?.slot : f; };
    const match = (items: { o: Occ; slot: number }[], slots: number[]): Map<number, number> | null => {
      const owner = new Map<number, number>(); // slot -> item
      const tryItem = (i: number, seen: Set<number>): boolean => {
        const order = [items[i].slot, ...slots.filter((s) => s !== items[i].slot)];
        for (const s of order) {
          if (!slots.includes(s) || seen.has(s) || !ok(items[i], s)) continue;
          seen.add(s);
          if (!owner.has(s) || tryItem(owner.get(s)!, seen)) { owner.set(s, i); return true; }
        }
        return false;
      };
      for (let i = 0; i < items.length; i++) if (!tryItem(i, new Set())) return null;
      return owner;
    };
    const stay = hs.filter((h) => { const p = where(prev, h.o.pid); return p >= 0 && !t[p] && ok(h, p); });
    for (const h of stay) t[where(prev, h.o.pid)] = h.o;
    const rest = hs.filter((h) => !stay.includes(h));
    let m = match(rest, free());
    if (!m) { for (const h of stay) t[where(prev, h.o.pid)] = null; m = match(hs, free()); if (!m) { for (const h of hs) if (h.slot >= 0 && !t[h.slot]) t[h.slot] = h.o; return; } m.forEach((i, s) => { t[s] = hs[i].o; }); return; }
    m.forEach((i, s) => { t[s] = rest[i].o; });
  };
  const at = (label: string) => L.indexOf(label);
  const tip0 = plan[0]?.tip ?? null;
  const tipTxt = (ms: number) => (etDay(ms) === etDay(a.asOf) ? clock(ms) : dayClock(ms));

  // ---- Sleeper now ----
  const cur: Lineup = S.map((s) => {
    if (!s.pid) return null;
    const base = { pid: s.pid, name: s.player ?? nm(s.pid) };
    if (s.locked || s.state === "locked") return { ...base, kind: "locked", score: s.points };
    if (s.state === "playing") return { ...base, kind: "playing", end: s.gameEnd, lockIf: s.lockIf ?? null };
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
  const forfeit0 = new Set((plan[0]?.forfeits ?? []).map((f) => pidOf(f.player)).filter(Boolean) as string[]);
  // the lineup at each tip-off; ref: a first build's lineups, so a later tip-off's starters are arranged around where
  // players will sit by then (first build: where they sit now)
  const build = (ref: Lineup[] | null): Lineup[] => {
  // ---- the engine's lineup at each tip-off: fixed occupants (locks, games in progress, this tip-off's starters);
  // held scores are placed afterwards, as close as possible to where they sit ----
  const R: Lineup[] = []; const H: { o: Occ; slot: number }[][] = [];
  let carry: Lineup = cur.map((o) => (o?.kind === "locked" ? o : null));
  // relabelled slots (engine slot <-> ours, same slot name) stay swapped for every later engine placement while the
  // players involved are still in that game (locks: for good)
  const swaps: { a: number; b: number; pids: string[] | null }[] = [];
  const mine = new Map<string, number>(); // pid -> our slot for him (in a game / locked)
  plan.forEach((pl, k) => {
    const t = carry.slice(); const hs: { o: Occ; slot: number }[] = [];
    const inGame = new Set((pl.playing ?? []).map((x) => x.pid));
    const active = swaps.filter((w) => !w.pids || w.pids.some((x) => inGame.has(x)));
    const map = (e: number) => active.reduce((x, w) => (x === w.a ? w.b : x === w.b ? w.a : x), e);
    const at = (label: string) => { const e = L.indexOf(label); return e < 0 ? e : map(e); };
    const has = (pid: string) => t.some((x) => x?.pid === pid) || hs.some((h) => h.o.pid === pid);
    const put = (s: number, o: Occ) => { if (s >= 0 && !t[s] && !has(o.pid)) t[s] = o; };
    const lockOcc = (pid: string, name: string, score: number | null | undefined): Occ => ({ pid, name, kind: "lock", score, lockIf: cutoff.get(pid) ?? null });
    for (const x of pl.locks ?? []) put(at(x.slot), lockOcc(x.pid, x.player, x.score));
    for (const x of pl.playing ?? []) put(k > 0 && mine.has(x.pid) ? mine.get(x.pid)! : at(x.slot), { pid: x.pid, name: x.player, kind: "playing", end: x.end, lockIf: cutoff.get(x.pid) ?? null });
    const group = pl.starts.map((x) => ({ s: at(x.slot), o: { pid: x.pid, name: x.player, kind: (x.label && /free roll/.test(x.label) ? "freeRoll" : "start") as DoNowKind, proj: x.proj, lockIf: x.lockIf, label: x.label, playProb: x.playProb, end: x.end, opp: x.opp, tip: pl.tip } }))
      .filter((g) => g.s >= 0 && !t[g.s] && !has(g.o.pid));
    const keep = new Set([...pl.holds.map((h) => h.pid), ...(k === 0 ? a.decisions.map((d) => d.pid) : [])].filter((x) => !(k === 0 && dec.get(x)?.recommended === "BENCH")));
    const chosen = arrange(group, t, k > 0 && ref ? ref[k - 1] : cur, keep);
    chosen.forEach((s, gi) => { t[s] = group[gi].o; mine.set(group[gi].o.pid, s); });
    const eng = new Set(group.map((g) => g.s)); const ours = new Set(chosen);
    const myOnly = chosen.filter((x) => !eng.has(x));
    for (const e of [...eng].filter((x) => !ours.has(x))) {
      const m = myOnly.findIndex((x) => S[x].slot === S[e].slot);
      if (m >= 0) { swaps.push({ a: e, b: myOnly[m], pids: group.map((g) => g.o.pid) }); myOnly.splice(m, 1); }
    }
    for (const h of pl.holds) {
      const d = k === 0 ? dec.get(h.pid) : undefined;
      if (d?.recommended === "BENCH" || has(h.pid)) continue;
      if (d?.recommended === "LOCK") put(at(h.slot), lockOcc(h.pid, h.player, h.score));
      else hs.push({ o: { pid: h.pid, name: h.player, kind: "held", score: h.score, lockIf: d?.threshold ?? null }, slot: at(h.slot) });
    }
    if (k === 0) {
      // safety: a held score the advice keeps (HOLD / LOCK) is never dropped because the plan didn't place it
      for (const d of a.decisions) {
        if (d.recommended === "BENCH" || has(d.pid)) continue;
        const here = cur.findIndex((o) => o?.pid === d.pid);
        const s = [here, ...L.map((_, i) => i).filter((i) => S[i].slot === d.recommendedSlot)].find((i) => i >= 0 && !t[i]) ?? -1;
        if (d.recommended === "LOCK") put(s, lockOcc(d.pid, d.player, d.score));
        else hs.push({ o: { pid: d.pid, name: d.player, kind: "held", score: d.score, lockIf: d.threshold }, slot: s });
      }
    }
    // a lock in his own slot rather than an identical one (UTIL 1 / UTIL 2): no move needed
    t.forEach((o, s) => {
      if (o?.kind !== "lock") return;
      const here = k === 0 || !mine.has(o.pid) ? cur.findIndex((c) => c?.pid === o.pid) : mine.get(o.pid)!;
      if (here >= 0 && here !== s && !t[here] && S[here].slot === S[s].slot) { t[here] = o; t[s] = null; swaps.push({ a: s, b: here, pids: null }); }
    });
    R.push(t); H.push(hs); carry = t.map((o) => (o && (o.kind === "locked" || o.kind === "lock") ? { ...o, kind: "locked" } : null));
  });
  // a later starter today whose slot nobody uses before his game: set him now (one trip to Sleeper instead of two)
  for (let k = 1; k < plan.length; k++) {
    if (etDay(plan[k].tip) !== etDay(plan[0].tip)) break;
    R[k].forEach((q, s) => {
      if (!q || (q.kind !== "start" && q.kind !== "freeRoll") || q.tip !== plan[k].tip) return;
      if (cur.some((o) => o?.pid === q.pid && o.kind === "playing")) return;
      for (let j = 0; j < k; j++) if (R[j][s] || R[j].some((o) => o?.pid === q.pid) || H[j].some((h) => h.slot === s || h.o.pid === q.pid) || plan[j].benched.some((b) => (b.pid ?? pidOf(b.player)) === q.pid)) return;
      for (let j = 0; j < k; j++) R[j][s] = { ...q, early: true };
    });
  }

  // ---- final lineups: held scores stay put when they can; previous occupants the plan doesn't use stay where they
  // are when that's harmless ----
  const F: Lineup[] = [];
  let prev = cur;
  plan.forEach((_, k) => {
    const t = R[k].slice();
    placeHolds(H[k], t, prev);
    const must = benchedAt(k); if (k === 0) { forfeit0.forEach((p) => must.add(p)); a.decisions.filter((d) => d.recommended === "BENCH").forEach((d) => must.add(d.pid)); }
    prev.forEach((r, s) => {
      if (!r || r.kind === "locked" || r.kind === "lock" || t.some((x) => x?.pid === r.pid) || must.has(r.pid)) return;
      const keep: Occ = { ...r, kind: r.kind === "held" ? "held" : "idle", early: false };
      if (!t[s]) { t[s] = keep; return; }
      // displaced: take the slot the newcomer left (a single swap in Sleeper), or keep a held score in any free slot
      const from = prev.findIndex((o) => o?.pid === t[s]!.pid);
      const free = [from, ...(r.kind === "held" ? t.map((_, i) => i) : [])].find((i) => i >= 0 && !t[i] && fits(r.pid, i) === true);
      if (free !== undefined) t[free] = keep;
    });
    F.push(t); prev = t;
  });
  return F;
  };
  const F = build(build(null));

  // ---- diffs ----
  const benchWhy = (r: Occ, k: number) => {
    const inj = injury.get(r.pid);
    if (r.kind === "held" || (k === 0 && curHeld.has(r.pid))) return ` (lets go of his held ${f1(r.score ?? curHeld.get(r.pid))})`;
    const b = plan[k]?.benched.find((x) => (x.pid ?? pidOf(x.player)) === r.pid);
    if (inj && /^(out|doubtful|inactive|sus)/i.test(inj)) return ` (${inj} - ruled out)`;
    if (b) return b.label ? ` (${b.label.split(":")[0]})` : ` (sits ${dayClock(plan[k].tip)}, proj ${f1(b.proj)})`;
    const g = players.find((x) => x.pid === r.pid)?.games;
    if (g && plan[k] && !g.some((x) => x.tip >= plan[k].tip && etDay(x.tip) === etDay(plan[k].tip))) return " (no game today)";
    return "";
  };
  const diff = (p: Lineup, t: Lineup, k: number): Change[] => {
    const out: Change[] = [];
    t.forEach((q, s) => {
      if (!q) return;
      const r = p[s];
      if (r?.pid !== q.pid) {
        const from = p.findIndex((o) => o?.pid === q.pid);
        const gone = r && !t.some((x) => x?.pid === r.pid) ? [r.pid] : [];
        if (from >= 0 && r && t[from]?.pid === r.pid) { if (s < from) out.push({ kind: "swap", text: `swap ${q.name} (${L[from]}) ↔ ${r.name} (${L[s]})`, pids: [q.pid, r.pid], slots: [s, from], row: s, held: q.kind === "held" || r.kind === "held" }); }
        else if (from >= 0) out.push({ kind: "move", text: `move ${q.name} ${L[from]} → ${L[s]}${q.kind === "held" ? ` (held ${f1(q.score)} - keep him in a starting slot, never via the bench)` : ""}`, pids: [q.pid, ...gone], slots: [from, s], row: s, held: q.kind === "held" });
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

  // changes that wait for a game in progress: anything touching such a player or his slot (closed under "touches a
  // slot whose occupant has to wait")
  const split = (cs: Change[], p: Lineup, live: Map<string, number>) => {
    const wait = new Map(live); const dep = new Map<Change, number>(); let grew = true;
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
    cur.forEach((o) => { if (o?.kind === "playing" && !(plan[0].playing ?? []).some((x) => x.pid === o.pid)) live0.set(o.pid, o.end ?? plan[0].tip); });
    const c0 = diff(cur, F[0], 0);
    const sp = split(c0, cur, live0);
    nowChanges = order(sp.now);
    // the lineup to set now: the target, except slots still waiting for a game in progress
    const waitSlots = new Set(sp.later.flatMap((x) => x.c.slots));
    shown = F[0].map((o, s) => (waitSlots.has(s) ? cur[s] : o));
    for (const { c, end } of orderL(sp.later)) {
      const st = step(end, true, plan[0].tip); st.items.push(c.text);
      c.pids.concat(c.slots.map((s) => cur[s]?.pid ?? "")).forEach((x) => { if (live0.has(x) && live0.get(x) === end) st.after.add(nm(x)); });
      noteLater(c, `~${clock(r5(end))}`);
    }
    for (let k = 1; k < plan.length; k++) {
      const p = F[k - 1];
      const live = new Map<string, number>();
      p.forEach((o) => { if (o && (o.kind === "start" || o.kind === "freeRoll" || o.kind === "playing") && !o.early && o.end != null && !(plan[k].playing ?? []).some((x) => x.pid === o.pid)) live.set(o.pid, o.end); });
      const sp2 = split(diff(p, F[k], k), p, live);
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
    if (!o || (o.kind !== "start" && o.kind !== "freeRoll" && o.kind !== "playing") || o.end == null || o.lockIf == null) return;
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
      case "playing": return `in game now${o.end ? ` (ends ~${clock(r5(o.end))})` : ""}${lk(o.lockIf)}`;
      case "idle": return tip0 !== null ? `no game at ${tipTxt(tip0)} - can stay` : "no game left - can stay";
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
  const upToDate = nowChanges.length || locks.length ? null
    : !plan.length ? "Your lineup is already correct - no more games for your players this week."
    : `Your lineup is already correct - nothing to do until ${until[0] ?? `the ${plan[0].when} tip-off`}.`;
  const tag = (o: Occ) => (o.kind === "held" ? ` (held ${f1(o.score)})` : o.kind === "freeRoll" ? " (free roll)" : o.kind === "lock" ? ` (LOCK ${f1(o.score)})` : "");
  const gets = new Set(nowChanges.flatMap((c) => (c.kind === "bench" || c.kind === "lock" ? [] : c.kind === "swap" ? c.slots : [c.row]))); // slots getting a player
  const compact = rows.filter((r, s) => gets.has(s) && r.pid).map((r, _, __, s = L.indexOf(r.slot)) => `${r.slot} ${r.player}${tag(shown[s]!)}`).join(", ");
  return { tip: tip0, tipText: plan[0]?.when ?? null, rows, changes: nowChanges.map((c) => cap(c.text)), locks, then, bench, upToDate, compact };
}

// plain-text rendering of the card (live checks, logs)
export function doNowText(d: DoNow): string {
  const out: string[] = [];
  for (const l of d.locks) out.push(`🔒 ${l.text}`);
  out.push(`Set your lineup to${d.tipText ? ` (before the ${d.tipText} tip-off)` : ""}:`);
  for (const r of d.rows) out.push(`  ${r.change ? "*" : " "} ${r.slot.padEnd(6)} ${(r.player ?? "-").padEnd(24)} ${r.status}${r.change ? `\n             -> change: ${r.change}` : ""}${r.later ? `\n             -> later ${r.later}` : ""}`);
  out.push(d.upToDate ?? `Do now, in this order:\n${d.changes.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`);
  if (d.then.length) { out.push("Then:"); for (const s of d.then) out.push(`  ${s.title}${s.tentative ? " [tentative]" : ""}\n${s.items.map((i) => `     - ${i}`).join("\n")}`); }
  if (d.bench.length) out.push(`Bench: ${d.bench.join("; ")}`);
  return out.join("\n");
}
