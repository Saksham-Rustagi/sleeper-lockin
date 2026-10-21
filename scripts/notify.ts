// Background notifier: run every few minutes (launchd). Creates Apple Reminders (sync to iPhone via iCloud)
// for lineup changes before tip-off, lock/hold/bench calls after games end, and final-call deadlines.
// Config: ~/.sleeper-lockin/config.json  { "leagueId": "...", "rosterId": 8 }
// Env: DRY_RUN=1 prints instead of creating reminders; LOCKIN_TEST=1 sends one test reminder and exits.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { advise, replay, type Advice } from "../lib/live/advise";
import { doNow } from "../lib/live/donow";
import { engineName, replayIsSlow } from "../lib/live/engine";
import { sleeper } from "../lib/live/sources";
import { resolveWeek } from "../lib/live/week";
import { collect, logAdvice } from "../lib/live/collector";
import { waiverAdvice } from "../lib/live/waivers";
import { irAdvice, type IrAction } from "../lib/live/ir";
import { opportunityScan, reportAlerts } from "../lib/live/oppscan";
import { updateSince, isFresh, newAlerts, type SinceState } from "../lib/live/opportunity";
import { optionOn } from "../lib/live/override";

const DIR = path.join(os.homedir(), ".sleeper-lockin");
const CFG = path.join(DIR, "config.json");
const SENT = path.join(DIR, "sent.json");
const DATA = path.join(DIR, "data");
const LIST = "Sleeper Lock-In";
process.env.LOCKIN_CACHE_DIR ??= path.join(DIR, "cache");

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const fmt = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
const etHour = (ms: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(ms)) % 24;

const APPLESCRIPT = `
on run argv
  set theTitle to item 1 of argv
  set theBody to item 2 of argv
  tell application "Reminders"
    if not (exists list "${LIST}") then make new list with properties {name:"${LIST}"}
    tell list "${LIST}"
      make new reminder with properties {name:theTitle, body:theBody, due date:((current date) + 60), remind me date:((current date) + 5)}
    end tell
  end tell
end run`;

export function remind(title: string, body: string) {
  if (process.env.DRY_RUN) { log("[dry-run] REMINDER:", title, "|", body); return; }
  execFileSync("/usr/bin/osascript", ["-e", APPLESCRIPT, title, body], { timeout: 30000 });
  log("reminder sent:", title);
}

interface Msg { key: string; title: string; body: string }
// IR reminders: urgent fixes (IR player no longer eligible), free IR slot moves, smarter IR swaps, and imminent returns.
export function irMessages(actions: IrAction[]): Msg[] {
  return actions.filter((a) => a.urgent || a.kind === "move_to_ir" || a.kind === "reorder").map((a) => ({
    key: `ir|${a.key}`, title: `${a.urgent ? "⚠️ " : "🏥 "}${a.title}`,
    body: `${a.detail}${a.dropOptions?.length ? ` Other drop options: ${a.dropOptions.slice(1, 4).map((d) => `${d.name}${d.protected ? " (dynasty)" : ""}`).join(", ")}.` : ""}`,
  }));
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export function messages(a: Advice, now: number): Msg[] {
  const out: Msg[] = [];
  const dn = a.doNow ?? doNow(a);
  for (const d of a.decisions) {
    const base = `${d.player} scored ${d.score.toFixed(1)}`;
    if (d.recommended === "LOCK") out.push({ key: `lock|${d.pid}|${d.score}`, title: `🔒 LOCK ${d.player} (${d.score.toFixed(1)}) at ${dn.locks.find((l) => l.pid === d.pid)?.slot ?? d.recommendedSlot}`, body: `${(d.moves || []).join(" ")} ${d.reason} Deadline: ${d.deadlineText}.` });
    else if (d.recommended === "BENCH") out.push({ key: `bench|${d.pid}|${d.score}`, title: `↔️ PASS on ${d.player} (${d.score.toFixed(1)}) — bench him`, body: `${d.reason} Do it ${d.deadlineText}.` });
    else if (d.deadline) {
      out.push({ key: `hold|${d.pid}|${d.score}`, title: `⏳ HOLD ${d.player} (${d.score.toFixed(1)}) — keep him in a starting slot`, body: `${base}. ${d.reason} Cut-off to lock: ${d.threshold ?? "?"}.` });
      if (d.deadline - now < 75 * 60e3) out.push({ key: `final|${d.pid}|${d.deadline}`, title: `⏰ Final call on ${d.player} (${d.score.toFixed(1)}) before ${fmt(d.deadline)}`, body: `Recommendation now: ${d.recommended}. Lock if ≥ ${d.threshold ?? "?"}; otherwise his next game replaces this one.` });
    }
  }
  const next = a.plan[0];
  if (next && next.tip - now < 75 * 60e3 && next.tip > now) {
    const cut = next.starts.filter((s) => s.lockIf !== null).map((s) => `${s.player} ≥ ${s.lockIf}`).join(", ");
    const startingIds = new Set(next.starts.map((s) => s.pid));
    const scratched = a.me.slots.filter((s) => s.pid && !s.locked && /^(out|doubtful|inactive|sus)/i.test(s.injury || "") && !startingIds.has(s.pid));
    const why = scratched.length ? `⚠️ ${scratched.map((s) => `${s.player} ${String(s.injury).toUpperCase()}`).join(", ")} → ` : "🏀 ";
    // the concrete diff vs the Sleeper lineup (lib/live/donow.ts); locks have their own reminder above
    const ch = dn.changes.filter((c) => !/^LOCK /.test(c));
    const later = dn.then.find((s) => s.items.some((i) => !/lock him if/.test(i)));
    if (ch.length) out.push({ key: `lineup|${next.tip}|${dn.rows.filter((r) => r.change && !/^LOCK /.test(r.change)).map((r) => `${r.pid ?? "-"}${r.slot}`).join(",")}`,
      title: clip(`${why}Before ${next.when}: ${dn.compact || ch.join(", ")}`, 150),
      body: clip(`${ch.join("; ")}.${later ? ` Then ${later.when}: ${later.items.filter((i) => !/lock him if/.test(i)).join("; ")}.` : ""} Lock if: ${cut || "–"}.`, 400) });
    else if (cut) out.push({ key: `cutoffs|${next.tip}`, title: `🏀 ${next.when} tip-off — lineup is set`, body: `Lock if: ${cut}.` });
  }
  return out;
}

// The race engines (p10b) replay a finished week in ~3-5 min (p7h: seconds): precompute last week's replay once, in
// quiet hours, so the Replay tab answers from the shared disk cache. One attempt per week (marker file), so a replay
// that hit the watchdog is not retried every run.
async function warmReplay(cfg: { leagueId: string; rosterId: number }) {
  if (!replayIsSlow()) return;
  try {
    const league = await sleeper.league(cfg.leagueId);
    const week = (await resolveWeek(league.season, Date.now())) - 1; if (week < 1) return;
    const mark = path.join(DIR, `replay-warm-${cfg.leagueId}-${cfg.rosterId}-${week}-${engineName()}`);
    if (fs.existsSync(mark)) return;
    if (!process.env.DRY_RUN) fs.writeFileSync(mark, new Date().toISOString());
    const t0 = Date.now(); await replay({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, week });
    log(`replay of week ${week} ready (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e: any) { log("replay warm ERROR", e?.message || e); }
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (process.env.LOCKIN_TEST) { remind("✅ Sleeper Lock-In reminders are working", "You can delete this test reminder."); return; }
  if (!fs.existsSync(CFG)) { log("no config at", CFG); return; }
  const cfg = JSON.parse(fs.readFileSync(CFG, "utf8"));
  const now = Date.now();
  // 1) data logger runs every time (projections move overnight/mornings too)
  if (!process.env.NO_COLLECT) {
    try {
      const c = await collect({ leagueId: cfg.leagueId, baseDir: DATA, now });
      log(`collected week ${c.week}:`, JSON.stringify(c.written));
    } catch (e: any) { log("collector ERROR", e?.message || e); }
  }
  const h = etHour(now);
  if (!process.env.FORCE && h >= 3 && h < 11) { await warmReplay(cfg); log("quiet hours"); return; }
  const a = await advise({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, K: Number(process.env.K || 250) });
  log(`engine ${engineName()}: advice ${a.cached ? "cached" : "computed"} in ${((Date.now() - now) / 1000).toFixed(0)} s since start`);
  if (!process.env.DRY_RUN) logAdvice(DATA, a.season, a);
  const sent: Record<string, number> = fs.existsSync(SENT) ? JSON.parse(fs.readFileSync(SENT, "utf8")) : {};
  const msgs = messages(a, now);
  let n = 0;
  for (const m of msgs) {
    if (sent[m.key]) continue;
    remind(m.title, m.body); sent[m.key] = now; n++;
  }
  // waiver check: once a day around noon ET, and right away when one of your players is newly ruled out
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const injuredNow = a.me.players.filter((p) => /^(out|doubtful|sus)/i.test(p.injury || "")).map((p) => p.pid).sort().join(",");
  const injKey = `injset|${injuredNow}`;
  const newInjury = injuredNow !== "" && !sent[injKey];
  if ((h >= 12 && !sent[`waiverday|${today}`]) || newInjury || process.env.WAIVERS) {
    try {
      const w = await waiverAdvice({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, protect: cfg.protect || [] });
      const best = w.moves.find((m) => m.confident && m.total >= 3);
      if (best) {
        const key = `waiver|${w.week}|${best.add.pid}|${best.drop?.pid ?? "-"}`;
        if (!sent[key]) {
          remind(`💡 Waiver: add ${best.add.name}${best.drop ? `, drop ${best.drop.name}` : ""} (+${best.total.toFixed(1)} pts)`,
            `${best.add.pos} ${best.add.team}, ${best.add.gamesThisWeek} games this week / ${best.add.gamesNextWeek} next, ${best.add.projPerGame ?? "?"} pts/g. +${best.gainThisWeek.toFixed(1)} this week, +${best.gainNextWeek.toFixed(1)} next. ${best.add.note ?? ""}`);
          sent[key] = now; n++;
        }
      }
      log(`waivers: best ${best ? `${best.add.name} for ${best.drop?.name ?? "-"} +${best.total.toFixed(1)}` : "none worth it"}`);
    } catch (e: any) { log("waivers ERROR", e?.message || e); }

    sent[`waiverday|${today}`] = now; if (injuredNow) sent[injKey] = now;
  }
  // IR check every run: an IR player turning healthy blocks roster moves, so it's urgent. Cached by fingerprint,
  // so it only re-simulates when a status / return date / roster actually changes.
  try {
    const ir = await irAdvice({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, protect: cfg.protect || [] });
    for (const m of irMessages(ir.actions)) if (!sent[m.key]) { remind(m.title, m.body); sent[m.key] = now; n++; }
    log(`IR: ${ir.actions.map((x) => (x.urgent ? "URGENT " : "") + x.kind).join(", ") || "nothing to do"}${ir.cached ? " (cached)" : ""}`);
  } catch (e: any) { log("IR ERROR", e?.message || e); }
  // opportunity alerts ("opportunityAlerts": true in config.json; default off): a rotation player newly ruled out ->
  // the free agents (and my players) who should absorb his minutes; minutes surges. Deduped by the sent-log.
  if (optionOn("opportunityAlerts")) {
    try {
      const OPPST = path.join(DIR, "opportunity-state.json"); const first = !fs.existsSync(OPPST);
      const prev: SinceState = first ? {} : JSON.parse(fs.readFileSync(OPPST, "utf8"));
      const r = await opportunityScan({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, since: Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v.since])) });
      const st = updateSince(prev, r.absences.map((a) => a.pid), now, first);
      r.absences.forEach((a) => (a.since = st[a.pid]?.since ?? null));
      const fresh = newAlerts(reportAlerts(r, (a) => isFresh(a.since, now)), sent);
      for (const m of fresh) { remind(m.title, m.body); sent[m.key] = now; n++; }
      if (!process.env.DRY_RUN) fs.writeFileSync(OPPST, JSON.stringify(st));
      log(`opportunity: ${r.absences.length} rotation players out, ${r.surges.length} surges, ${fresh.length} new alerts${first ? " (first run: current absences marked as old)" : ""}; box scores ${r.box.games} (+${r.box.fetched})`);
    } catch (e: any) { log("opportunity ERROR", e?.message || e); }
  }
  for (const [k, t] of Object.entries(sent)) if (now - t > 10 * 86400e3) delete sent[k];
  if (!process.env.DRY_RUN) fs.writeFileSync(SENT, JSON.stringify(sent));
  log(`week ${a.week}: ${a.decisions.length} decisions, ${a.plan.length} tip-offs planned, win ${a.outlook.winProb === null ? "–" : Math.round(a.outlook.winProb * 100) + "%"}, ${n} new reminders`);
}
if (/notify\.(c?js|ts)$/.test(process.argv[1] || "")) {
  // Exit explicitly: background simulation workers / open handles must never keep a finished run alive (launchd
  // won't start the next run while this one exists). Watchdog: a stuck run is killed after 9 minutes.
  setTimeout(() => { log("watchdog: run exceeded 9 min, exiting"); process.exit(2); }, 9 * 60e3).unref();
  main().then(() => process.exit(0), (e) => { log("ERROR", e?.stack || e); process.exit(1); });
}
