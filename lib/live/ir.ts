// IR helper: uses the league's IR eligibility rules, ESPN expected return dates and the Lock-In simulation to
//  1) put Out/Suspended active players on IR when a slot is free (opens a roster spot),
//  2) fix an IR player who is no longer IR-eligible (Sleeper blocks moves until he's activated):
//     swap with another Out player if possible, otherwise activate him and drop the least valuable player,
//  3) warn ahead of time when an IR player is about to return, with the drop already worked out.
import { sleeper, type League } from "./sources";
import { buildWeek, resolveWeek } from "./week";
import { weekValues } from "./waivers";
import { cachedCompute, fingerprint } from "./cache";

export interface IrPlayer { pid: string; name: string; status: string | null; eligible: boolean; returnDate: string | null; comment: string | null }
export interface DropOption { pid: string; name: string; pos: string; loss: number; protected: boolean; reason: string | null; dynastyAdp: number | null }
export interface IrAction { kind: "move_to_ir" | "swap" | "activate_drop" | "prepare" | "reorder"; urgent: boolean; key: string; title: string; detail: string; dropOptions?: DropOption[] }
export interface IrAdvice { generatedAt: number; capacity: number; onIr: IrPlayer[]; activeOut: IrPlayer[]; rules: string; actions: IrAction[]; cached?: boolean; checkedAt?: number }

export function irEligible(status: string | null | undefined, s: Record<string, number>): boolean {
  const k = (status || "").toLowerCase();
  if (!k) return false;
  if (k === "out" || k === "ir" || k === "inactive") return !!s.reserve_allow_out;
  if (k === "sus" || k === "suspended") return !!s.reserve_allow_sus;
  if (k === "dnr") return !!s.reserve_allow_dnr;
  if (k === "doubtful") return !!s.reserve_allow_doubtful;
  if (k === "dtd" || k === "gtd" || k === "questionable") return !!s.reserve_allow_dtd;
  if (k === "na") return !!s.reserve_allow_na;
  if (k === "cov") return !!s.reserve_allow_cov;
  return false;
}

const norm = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
async function espnReturns(): Promise<Map<string, { date: string | null; comment: string | null }>> {
  const m = new Map<string, { date: string | null; comment: string | null }>();
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", { cache: "no-store" });
    const j = await r.json();
    for (const t of j.injuries || []) for (const i of t.injuries || []) {
      const name = i.athlete?.displayName; if (!name) continue;
      m.set(norm(name), { date: i.details?.returnDate ?? null, comment: i.shortComment ?? null });
    }
  } catch { /* ESPN optional */ }
  return m;
}

const fmtDate = (d: string | null) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "unknown");

export async function irAdvice(o: { leagueId: string; rosterId: number; protect?: string[]; N?: number; asOf?: number; statusOverride?: Record<string, string | null> }): Promise<IrAdvice> {
  const asOf = o.asOf ?? Date.now(); const N = o.N ?? 200;
  const league: League = await sleeper.league(o.leagueId);
  const S = league.settings; const capacity = S.reserve_slots ?? 0;
  const [rosters, players, returns, sproj] = await Promise.all([
    sleeper.rosters(o.leagueId), sleeper.players(30 * 60e3), espnReturns(),
    sleeper.seasonProjections(league.season).catch(() => ({} as Record<string, Record<string, number>>)),
  ]);
  const me = rosters.find((r) => r.roster_id === o.rosterId)!;
  const reserve = me.reserve || []; const taxi = me.taxi || [];
  const active = (me.players || []).filter((p) => !reserve.includes(p) && !taxi.includes(p));
  const info = (pid: string): IrPlayer => {
    const p = players[pid]; const name = p?.full_name || pid; const ret = returns.get(norm(name));
    const status = o.statusOverride && pid in o.statusOverride ? o.statusOverride[pid] : p?.injury_status ?? null;
    return { pid, name, status, eligible: irEligible(status, S), returnDate: ret?.date ?? null, comment: ret?.comment ?? null };
  };
  const onIr = reserve.map(info);
  const activeOut = active.map(info).filter((x) => x.eligible).sort((a, b) => (b.returnDate || "9999").localeCompare(a.returnDate || "9999"));
  const allowed = ["out", "sus", "dnr", "doubtful", "dtd", "na"].filter((k) => irEligible(k, S)).map((k) => k.toUpperCase()).join(", ");
  const rules = `IR slots: ${capacity}. IR-eligible statuses in this league: ${allowed || "none"}. If an IR player stops being eligible, Sleeper blocks adds/drops/trades until he's activated.`;

  const fp = fingerprint({ v: 5, N, capacity, reserve, active, override: o.statusOverride ?? null, statuses: [...reserve, ...active].map((p) => [p, players[p]?.injury_status ?? null, returns.get(norm(players[p]?.full_name || ""))?.date ?? null]), protect: [...(o.protect || [])].sort(), day: new Date(asOf).toISOString().slice(0, 10) }, "sim");
  const res = await cachedCompute(`ir-${o.leagueId}-${o.rosterId}`, fp, async (): Promise<IrAdvice> => {
    const actions: IrAction[] = [];
    // drop options when someone must be activated: simulate this week + next with him back
    // `prior` = earlier returners already activated (and their planned drops), so plans don't double-count a drop.
    const dropOptionsFor = async (returning: string, fromDate: string | null, prior: { add: string[]; drop: string[] } = { add: [], drop: [] }): Promise<DropOption[]> => {
      const from = fromDate ? Math.max(asOf, Date.parse(fromDate + "T12:00:00Z")) : asOf;
      const week = await resolveWeek(league.season, from);
      const sched = await sleeper.schedule(league.season); const weeks = [week, ...(sched.some((g) => g.week === week + 1) ? [week + 1] : [])];
      const vals = async (edit?: { add?: string[]; drop?: string[] }) => { const out: number[] = []; for (const w of weeks) { const c = await buildWeek({ leagueId: o.leagueId, rosterId: o.rosterId, week: w, asOf, rosterEdit: edit, skipOpp: true }); out.push(...Array.from(weekValues(c.me, N, w * 7919, asOf))); } return out; };
      const base = await vals({ add: [...prior.add, returning], drop: prior.drop });
      const cands = active.filter((p) => p !== returning && !prior.drop.includes(p));
      const opts: DropOption[] = [];
      for (const pid of cands) {
        const v = await vals({ add: [...prior.add, returning], drop: [...prior.drop, pid] });
        const loss = (base.reduce((a, b) => a + b, 0) - v.reduce((a, b) => a + b, 0)) / base.length * weeks.length; // pts over the horizon
        const p = players[pid] as any; const adp = sproj[pid]?.adp_dynasty;
        const young = (p?.age ?? 99) <= 23 || (adp ?? 999) <= 120; const prot = (o.protect || []).includes(pid);
        opts.push({ pid, dynastyAdp: adp ?? null, name: p?.full_name || pid, pos: (p?.fantasy_positions || []).join("/"), loss: Math.max(0, loss), protected: young || prot, reason: prot ? "protected by you" : young ? `dynasty asset (age ${p?.age ?? "?"}${adp ? `, ADP ${Math.round(adp)}` : ""})` : null });
      }
      // effectively-tied losses (within 0.5 pts) -> drop the weakest dynasty asset first
      const bucket = (x: number) => Math.round(x * 2) / 2;
      return opts.sort((a, b) => Number(a.protected) - Number(b.protected) || bucket(a.loss) - bucket(b.loss) || (b.dynastyAdp ?? 999) - (a.dynastyAdp ?? 999)).slice(0, 5);
    };

    // 1) IR player no longer eligible -> must be activated
    for (const x of onIr.filter((x) => !x.eligible)) {
      const swap = activeOut[0];
      if (swap) {
        actions.push({ kind: "swap", urgent: true, key: `swap|${x.pid}|${swap.pid}`, title: `Move ${swap.name} (${swap.status}) to IR and activate ${x.name} — no drop needed`,
          detail: `${x.name} is ${x.status || "healthy"} and no longer IR-eligible, so Sleeper blocks roster moves until he's activated. ${swap.name} is ${swap.status} (back ~${fmtDate(swap.returnDate)}) and can take his IR spot.` });
      } else {
        const dropOptions = await dropOptionsFor(x.pid, null);
        const best = dropOptions.find((d) => !d.protected) ?? dropOptions[0];
        actions.push({ kind: "activate_drop", urgent: true, key: `activate|${x.pid}|${best?.pid}`, title: `Activate ${x.name} and drop ${best?.name ?? "?"}`,
          detail: `${x.name} is ${x.status || "healthy"} — no longer IR-eligible, so Sleeper blocks adds/drops/trades until he's activated, and your active roster is full. Dropping ${best?.name} costs ${best ? best.loss.toFixed(1) : "?"} pts over the next two weeks (least of anyone not protected).`, dropOptions });
      }
    }
    // 2) free IR slot + Out player on the active roster -> move him (opens a roster spot)
    const free = capacity - reserve.length;
    activeOut.slice(0, Math.max(0, free)).forEach((x) => actions.push({ kind: "move_to_ir", urgent: false, key: `toir|${x.pid}`, title: `Move ${x.name} (${x.status}) to IR`,
      detail: `Frees an active roster spot (expected back ~${fmtDate(x.returnDate)}). Check the Waivers tab for the best add into that spot.` }));
    // 3) IR full, someone active is out longer than an IR player -> put the long-term injury on IR
    if (free <= 0 && activeOut.length) {
      const soonest = [...onIr].filter((x) => x.eligible).sort((a, b) => (a.returnDate || "9999").localeCompare(b.returnDate || "9999"))[0];
      const longest = activeOut[0];
      if (soonest && longest && (longest.returnDate || "9999") > (soonest.returnDate || "9999"))
        actions.push({ kind: "reorder", urgent: false, key: `reorder|${soonest.pid}|${longest.pid}`, title: `Swap IR: put ${longest.name} on IR, activate ${soonest.name}`,
          detail: `${longest.name} is out longer (~${fmtDate(longest.returnDate)}) than ${soonest.name} (~${fmtDate(soonest.returnDate)}). Same roster count, but when ${soonest.name} returns he's already active — no forced drop.` });
    }
    // 4) every IR player: the plan for when he comes back (who to drop), ready in advance
    const prior = { add: [] as string[], drop: [] as string[] };
    // already-activated returners (from step 1) count as prior
    for (const a of actions) if (a.kind === "activate_drop" && a.dropOptions?.length) { const b = a.dropOptions.find((d) => !d.protected) ?? a.dropOptions[0]; const ret = onIr.find((x) => a.key.includes(x.pid)); if (ret) prior.add.push(ret.pid); prior.drop.push(b.pid); }
    const byReturn = onIr.filter((x) => x.eligible).sort((a, b) => (a.returnDate || "9999").localeCompare(b.returnDate || "9999"));
    for (const x of byReturn) {
      if (actions.some((a) => a.key.includes(x.pid))) continue;
      const days = x.returnDate ? (Date.parse(x.returnDate + "T12:00:00Z") - asOf) / 86400e3 : Infinity;
      const dropOptions = activeOut.length ? undefined : await dropOptionsFor(x.pid, x.returnDate, { add: [...prior.add], drop: [...prior.drop] });
      const best = dropOptions?.find((d) => !d.protected);
      if (best) { prior.add.push(x.pid); prior.drop.push(best.pid); }
      actions.push({ kind: "prepare", urgent: days <= 2, key: `prep|${x.pid}|${best?.pid ?? "swap"}`, title: `When ${x.name} comes back (ESPN: ~${fmtDate(x.returnDate)}): ${activeOut.length ? `swap ${activeOut[0].name} onto IR` : `drop ${best?.name ?? "?"}`}`,
        detail: activeOut.length ? `${activeOut[0].name} (${activeOut[0].status}) can take his IR spot — no drop needed.` : `As soon as Sleeper lists him as anything but ${allowed || "OUT"}, roster moves are blocked until he's activated. Dropping ${best?.name ?? "?"} then costs ${best ? (best.loss < 0.5 ? "≈0" : best.loss.toFixed(1)) : "?"} pts over his first two weeks back${prior.drop.length > 1 ? ` (assumes the earlier return's drop already happened)` : ""} — the least of anyone you'd keep for dynasty.`, dropOptions });
    }
    return { generatedAt: Date.now(), capacity, onIr, activeOut, rules, actions };
  });
  return { ...res.value, cached: res.cached, checkedAt: Date.now() };
}
