// Lineup reminders without flip-flops (task S). Pure: the notifier passes the advice, its "Do now" card and the memo
// it kept for this tip-off on its last run; it gets back the reminder to send (or none) and the memo to keep.
//  - materiality: the card (lib/live/donow.ts) only proposes slot moves that are needed (placement is sticky to the
//    Sleeper lineup), so a change list is a change in who starts / holds / sits or a move a later planned move needs
//  - hysteresis: a swap of who starts between players whose expected points tonight differ by < HYSTERESIS (Monte-Carlo
//    noise) is not a reason to change: the previously recommended starters (first run: the ones in Sleeper) are kept
//  - after a reminder ("set your lineup to" or "lineup is set") for this tip-off, a new change is only sent with a
//    named reason: an injury tag changed, a game ended, a projection moved, or the Sleeper lineup changed
import type { Advice } from "./advise";
import type { DoNow } from "./donow";

export const HYSTERESIS = 0.5; // pts of expected points tonight (start races resolve to ~0.5: P10b's minGain)

export interface TipMemo {
  tip: number; at: number;
  starters: string[];               // recommended starters at this tip-off (start / free roll), sorted pids
  vals: Record<string, number>;     // expected points of this tip-off's game per player who has one
  inj: Record<string, string>;      // injury tag per player ("" = none)
  scores: Record<string, number>;   // finished-game scores (held / locked): a new one = a game ended
  lineup: string;                   // the Sleeper lineup ("PG:pid,SG:pid,...")
  sent: "changes" | "set" | null; key: string | null;
}
export type LineupState = Record<string, TipMemo>;
export interface LineupMsg { key: string; title: string; body: string }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const f1 = (x: number) => x.toFixed(1);

export function lineupMessage(a: Pick<Advice, "plan" | "me" | "decisions">, dn: DoNow, now: number, prev?: TipMemo): { msg: LineupMsg | null; memo: TipMemo; note: string } {
  const next = a.plan[0];
  const name = new Map<string, string>();
  for (const p of a.me.players ?? []) name.set(p.pid, p.name);
  for (const s of a.me.slots) if (s.pid && s.player) name.set(s.pid, s.player);
  for (const t of dn.target) name.set(t.pid, t.name);
  const nm = (pid: string) => name.get(pid) ?? pid;
  // expected points tonight: the plan's (projection x play probability), else the player's game projection
  const vals: Record<string, number> = {};
  for (const p of a.me.players ?? []) { const g = p.games?.find((x) => x.tip === next.tip); if (g) vals[p.pid] = g.proj; }
  for (const x of next.starts) vals[x.pid] = x.proj * (x.playProb ?? 1);
  for (const b of next.benched) if (b.pid) vals[b.pid] = b.expected ?? b.proj * (b.playProb ?? 1);
  const inj: Record<string, string> = {};
  for (const p of a.me.players ?? []) inj[p.pid] = p.injury ?? "";
  for (const s of a.me.slots) if (s.pid && s.injury !== undefined) inj[s.pid] = s.injury ?? "";
  const scores: Record<string, number> = {};
  for (const s of a.me.slots) if (s.pid && (s.state === "held" || s.state === "locked" || s.locked) && s.points != null) scores[s.pid] = s.points;
  for (const d of a.decisions) scores[d.pid] = d.score;
  const lineup = a.me.slots.map((s) => `${s.slot}:${s.pid ?? "-"}`).join(",");
  const starters = [...new Set(dn.target.filter((t) => (t.kind === "start" || t.kind === "freeRoll") && t.tip === next.tip && !t.early).map((t) => t.pid))].sort();

  // what changed since the last run (the reasons a reminder may give)
  // (pid: the player it concerns; null: everyone - a game ended, the Sleeper lineup changed)
  const events: { pid: string | null; text: string }[] = [];
  if (prev) {
    for (const [pid, v] of Object.entries(inj)) if (pid in prev.inj && prev.inj[pid] !== v) events.push({ pid, text: `${nm(pid)} ${(prev.inj[pid] || "healthy").toLowerCase()} → ${(v || "healthy").toLowerCase()}` });
    for (const [pid, v] of Object.entries(scores)) if (prev.scores[pid] !== v) events.push({ pid: null, text: `${nm(pid)}'s game ended (${f1(v)})` });
    for (const pid of new Set([...Object.keys(vals), ...Object.keys(prev.vals)])) {
      const o = prev.vals[pid]; const v = vals[pid];
      if (o !== undefined && v !== undefined && Math.abs(v - o) >= HYSTERESIS) events.push({ pid, text: `${nm(pid)} proj ${f1(o)} → ${f1(v)}` });
    }
    if (prev.lineup !== lineup) events.push({ pid: null, text: "your Sleeper lineup changed" });
  }
  const why = events.map((e) => e.text);
  const memo: TipMemo = { tip: next.tip, at: now, starters, vals, inj, scores, lineup, sent: prev?.sent ?? null, key: prev?.key ?? null };

  // hysteresis on who starts: reference = the last recommendation, first run = who is in Sleeper with a game tonight
  const ref = prev?.starters ?? [...new Set(a.me.slots.filter((s) => s.pid && !s.locked && s.state !== "locked" && s.state !== "held" && vals[s.pid] !== undefined).map((s) => s.pid!))].sort();
  const added = starters.filter((p) => !ref.includes(p)); const removed = ref.filter((p) => !starters.includes(p) && vals[p] !== undefined);
  if (added.length && added.length === removed.length && !events.some((e) => e.pid === null || added.includes(e.pid) || removed.includes(e.pid))) {
    const left = removed.slice(); const pairs: string[] = [];
    const noise = added.every((p) => {
      const i = left.findIndex((q) => Math.abs((vals[p] ?? 0) - (vals[q] ?? 0)) < HYSTERESIS); if (i < 0) return false;
      pairs.push(`${nm(left[i])} (${f1(vals[left[i]] ?? 0)}) over ${nm(p)} (${f1(vals[p] ?? 0)})`); left.splice(i, 1); return true;
    });
    if (noise) return { msg: null, memo: { ...memo, starters: ref }, note: `hysteresis: kept ${pairs.join(", ")} (< ${HYSTERESIS} pts apart, nothing about them changed)` };
  }

  const ch = dn.changes.filter((c) => !/^LOCK /.test(c));
  const cut = next.starts.filter((s) => s.lockIf !== null).map((s) => `${s.player} ≥ ${s.lockIf}`).join(", ");
  if (!ch.length) {
    if (!cut) return { msg: null, memo, note: "lineup is set (no cut-offs)" };
    const key = `cutoffs|${next.tip}`;
    if (prev?.key === key) return { msg: null, memo, note: "lineup is set (already said)" };
    return { msg: { key, title: `🏀 ${next.when} tip-off — lineup is set`, body: `Lock if: ${cut}.` }, memo: { ...memo, sent: "set", key }, note: "lineup is set" };
  }
  // the changes, keyed by what they do (who goes where), not by their wording
  const key = `lineup|${next.tip}|${dn.rows.filter((r) => r.change && !/^LOCK /.test(r.change)).map((r) => `${r.pid ?? "-"}${r.slot}`).join(",")}`;
  if (prev?.key === key) return { msg: null, memo, note: "same changes as the last reminder" };
  if (prev?.sent && !why.length) return { msg: null, memo, note: `changes without a material reason after "${prev.sent === "set" ? "lineup is set" : "set your lineup"}": not sent (${ch.join("; ")})` };
  const startingIds = new Set(next.starts.map((s) => s.pid));
  const scratched = a.me.slots.filter((s) => s.pid && !s.locked && /^(out|doubtful|inactive|sus)/i.test(s.injury || "") && !startingIds.has(s.pid));
  const pre = scratched.length ? `⚠️ ${scratched.map((s) => `${s.player} ${String(s.injury).toUpperCase()}`).join(", ")} → ` : prev?.sent ? "🔄 " : "🏀 ";
  const later = dn.then.find((s) => s.items.some((i) => !/lock him if/.test(i)));
  const because = prev?.sent && why.length ? `Changed because: ${why.join("; ")}. ` : "";
  return {
    msg: {
      key, title: clip(`${pre}Before ${next.when}: ${dn.compact || ch.join(", ")}`, 150),
      body: clip(`${because}${ch.join("; ")}.${later ? ` Then ${later.when}: ${later.items.filter((i) => !/lock him if/.test(i)).join("; ")}.` : ""} Lock if: ${cut || "–"}.`, 400),
    },
    memo: { ...memo, sent: "changes", key }, note: because ? because.trim() : "first lineup reminder",
  };
}
