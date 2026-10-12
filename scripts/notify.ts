// Background notifier: run every few minutes (launchd). Creates Apple Reminders (sync to iPhone via iCloud)
// for lineup changes before tip-off, lock/hold/bench calls after games end, and final-call deadlines.
// Config: ~/.sleeper-lockin/config.json  { "leagueId": "...", "rosterId": 8 }
// Env: DRY_RUN=1 prints instead of creating reminders; LOCKIN_TEST=1 sends one test reminder and exits.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { advise, type Advice } from "../lib/live/advise";

const DIR = path.join(os.homedir(), ".sleeper-lockin");
const CFG = path.join(DIR, "config.json");
const SENT = path.join(DIR, "sent.json");
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
export function messages(a: Advice, now: number): Msg[] {
  const out: Msg[] = [];
  for (const d of a.decisions) {
    const base = `${d.player} scored ${d.score.toFixed(1)}`;
    if (d.recommended === "LOCK") out.push({ key: `lock|${d.pid}|${d.score}`, title: `🔒 LOCK ${d.player} (${d.score.toFixed(1)}) at ${d.recommendedSlot}`, body: `${d.reason} Deadline: ${d.deadlineText}.` });
    else if (d.recommended === "BENCH") out.push({ key: `bench|${d.pid}|${d.score}`, title: `↔️ PASS on ${d.player} (${d.score.toFixed(1)}) — bench him`, body: `${d.reason} Do it ${d.deadlineText}.` });
    else if (d.deadline) {
      out.push({ key: `hold|${d.pid}|${d.score}`, title: `⏳ HOLD ${d.player} (${d.score.toFixed(1)}) — keep him in a starting slot`, body: `${base}. ${d.reason} Cut-off to lock: ${d.threshold ?? "?"}.` });
      if (d.deadline - now < 75 * 60e3) out.push({ key: `final|${d.pid}|${d.deadline}`, title: `⏰ Final call on ${d.player} (${d.score.toFixed(1)}) before ${fmt(d.deadline)}`, body: `Recommendation now: ${d.recommended}. Lock if ≥ ${d.threshold ?? "?"}; otherwise his next game replaces this one.` });
    }
  }
  const next = a.plan[0];
  if (next && next.tip - now < 75 * 60e3 && next.tip > now) {
    const current = new Set(a.me.slots.map((s) => s.pid).filter(Boolean) as string[]);
    const moves = next.starts.filter((s) => !current.has(s.pid));
    const cut = next.starts.filter((s) => s.lockIf !== null).map((s) => `${s.player} ≥ ${s.lockIf}`).join(", ");
    if (moves.length) out.push({ key: `lineup|${next.tip}|${moves.map((m) => m.pid + m.slot).join(",")}`, title: `🏀 Set lineup before ${next.when}: start ${moves.map((m) => `${m.player} (${m.slot})`).join(", ")}`, body: `Lock cut-offs tonight: ${cut || "–"}. Bench: ${next.benched.map((b) => b.player).join(", ") || "–"}.` });
    else if (cut) out.push({ key: `cutoffs|${next.tip}`, title: `🏀 ${next.when} tip-off — lineup is set`, body: `Lock if: ${cut}.` });
  }
  return out;
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (process.env.LOCKIN_TEST) { remind("✅ Sleeper Lock-In reminders are working", "You can delete this test reminder."); return; }
  if (!fs.existsSync(CFG)) { log("no config at", CFG); return; }
  const cfg = JSON.parse(fs.readFileSync(CFG, "utf8"));
  const now = Date.now();
  const h = etHour(now);
  if (!process.env.FORCE && h >= 3 && h < 11) { log("quiet hours"); return; }
  const a = await advise({ leagueId: cfg.leagueId, rosterId: cfg.rosterId, K: Number(process.env.K || 250) });
  const sent: Record<string, number> = fs.existsSync(SENT) ? JSON.parse(fs.readFileSync(SENT, "utf8")) : {};
  const msgs = messages(a, now);
  let n = 0;
  for (const m of msgs) {
    if (sent[m.key]) continue;
    remind(m.title, m.body); sent[m.key] = now; n++;
  }
  for (const [k, t] of Object.entries(sent)) if (now - t > 10 * 86400e3) delete sent[k];
  if (!process.env.DRY_RUN) fs.writeFileSync(SENT, JSON.stringify(sent));
  log(`week ${a.week}: ${a.decisions.length} decisions, ${a.plan.length} tip-offs planned, win ${a.outlook.winProb === null ? "–" : Math.round(a.outlook.winProb * 100) + "%"}, ${n} new reminders`);
}
if (/notify\.(c?js|ts)$/.test(process.argv[1] || "")) main().catch((e) => { log("ERROR", e?.stack || e); process.exitCode = 1; });
