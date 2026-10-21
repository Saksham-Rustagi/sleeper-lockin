"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Advice, Replay } from "@/lib/live/advise";
import type { DoNow } from "@/lib/live/donow";
import type { WaiverAdvice, WaiverPlayer } from "@/lib/live/waivers";
import type { IrAdvice } from "@/lib/live/ir";
import type { LeagueWeek, LeagueTeam } from "@/lib/live/league";
import type { OppReport } from "@/lib/live/oppscan";

type LeagueOpt = { league_id: string; name: string; season: string; status: string; roster_id: number | null };
const CFG_KEY = "lockin-live-config";
const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "–" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${Math.round(n * 100)}%`);
const tipTime = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);

export default function LivePage() {
  return <Suspense fallback={<div className="p-8">Loading…</div>}><Live /></Suspense>;
}

function Live() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [leagues, setLeagues] = useState<LeagueOpt[]>([]);
  const [leagueId, setLeagueId] = useState<string>("");
  const [rosterId, setRosterId] = useState<number | null>(null);
  const [tab, setTab] = useState(params.get("tab") || "week");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    const urlUser = params.get("user");
    if (urlUser && urlUser.toLowerCase() !== (c.username || "").toLowerCase()) { setUsername(urlUser); connectAs(urlUser); return; }
    if (c.username) setUsername(c.username);
    if (c.leagues) setLeagues(c.leagues);
    if (c.leagueId) setLeagueId(c.leagueId);
    if (c.rosterId) setRosterId(c.rosterId);
  }, []);
  const save = (patch: Record<string, unknown>) => {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    localStorage.setItem(CFG_KEY, JSON.stringify({ ...c, ...patch }));
  };

  const connect = () => connectAs(username);
  async function connectAs(u: string) {
    setErr(null);
    const r = await fetch(`/api/connect?username=${encodeURIComponent(u)}`);
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    setLeagues(j.leagues);
    const cur = j.leagues.find((l: LeagueOpt) => l.roster_id) || j.leagues[0];
    if (cur) { setLeagueId(cur.league_id); setRosterId(cur.roster_id); }
    save({ username: u, leagues: j.leagues, leagueId: cur?.league_id, rosterId: cur?.roster_id });
  }
  const league = leagues.find((l) => l.league_id === leagueId);
  const pastLeagues = leagues.filter((l) => l.roster_id);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="border-b bg-white dark:bg-gray-800">
        <div className="container mx-auto px-4 py-4 flex flex-wrap gap-4 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Lock-In Live</h1>
            <p className="text-sm text-gray-500">Live Sleeper data · Monte-Carlo lock decisions · win probability</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Input className="w-40" placeholder="Sleeper username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} />
            <Button variant="outline" onClick={connect}>Connect</Button>
            {leagues.length > 0 && (
              <select className="border rounded px-2 py-2 text-sm bg-white dark:bg-gray-800" value={leagueId}
                onChange={(e) => { const l = leagues.find((x) => x.league_id === e.target.value)!; setLeagueId(l.league_id); setRosterId(l.roster_id); save({ leagueId: l.league_id, rosterId: l.roster_id }); }}>
                {leagues.map((l) => <option key={l.league_id} value={l.league_id}>{l.name} · {l.season} ({l.status})</option>)}
              </select>
            )}
            <Link href="/" className="text-sm underline text-gray-500">Manual mode</Link>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-6">
        {err && <div className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm">{err}</div>}
        {!leagueId || !rosterId ? (
          <Card><CardContent className="py-10 text-center text-gray-500">Enter your Sleeper username and press Connect.</CardContent></Card>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-full max-w-3xl overflow-x-auto justify-start md:grid md:grid-cols-5">
              <TabsTrigger value="week">This week</TabsTrigger>
              <TabsTrigger value="matchups">Matchups</TabsTrigger>
              <TabsTrigger value="waivers">Waivers</TabsTrigger>
              <TabsTrigger value="replay">Replay a week</TabsTrigger>
              <TabsTrigger value="how">How it decides</TabsTrigger>
            </TabsList>
            <TabsContent value="week" className="mt-6"><WeekView leagueId={leagueId} rosterId={rosterId} season={league?.season} /></TabsContent>
            <TabsContent value="matchups" className="mt-6"><MatchupsView leagueId={leagueId} rosterId={rosterId} /></TabsContent>
            <TabsContent value="waivers" className="mt-6"><WaiversView leagueId={leagueId} rosterId={rosterId} /></TabsContent>
            <TabsContent value="replay" className="mt-6"><ReplayView leagues={pastLeagues} initialLeague={params.get("league") || pastLeagues.find((l) => l.status === "complete")?.league_id || leagueId} initialWeek={Number(params.get("week") || 23)} /></TabsContent>
            <TabsContent value="how" className="mt-6"><HowItWorks /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function WeekView({ leagueId, rosterId, season }: { leagueId: string; rosterId: number; season?: string }) {
  const [a, setA] = useState<Advice | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locks, setLocks] = useState<Record<number, string | null>>({});
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const q = new URLSearchParams({ league: leagueId, roster: String(rosterId) });
      if (Object.keys(locks).length) q.set("locks", JSON.stringify(locks));
      const r = await fetch(`/api/advise?${q}`); const j = await r.json();
      if (!r.ok) throw new Error(j.error); setA(j);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [leagueId, rosterId, locks]);
  useEffect(() => { load(); const id = setInterval(() => document.visibilityState === "visible" && load(), 120000); return () => clearInterval(id); }, [load]);

  if (err) return <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{err}</div>;
  if (!a) return <div className="text-gray-500">Simulating your week… {loading && "(fetching Sleeper + ESPN)"}</div>;
  const o = a.outlook;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4">
        <Stat label={`Week ${a.week} · ${a.season}`} value={`${a.dates[0]?.slice(5)} → ${a.dates[a.dates.length - 1]?.slice(5)}`} sub={a.league} />
        <Stat label="Your locked points" value={fmt(a.me.lockedTotal)} sub={`${a.me.slots.filter((s) => s.locked).length}/${a.me.slots.length} slots locked`} />
        <Stat label="Your projected total" value={fmt(o.myMean, 0)} sub={`80% range ${fmt(o.myP10, 0)}–${fmt(o.myP90, 0)}`} />
        <Stat label={a.opp ? `${a.opp.name} projected` : "Opponent"} value={a.opp ? fmt(o.oppMean, 0) : "–"} sub={a.opp ? `locked ${fmt(a.opp.lockedTotal)}` : "no matchup"} />
        <Stat label="Win probability" value={pct(o.winProb)} sub={`${o.sims} simulated weeks`} highlight />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Do now</CardTitle><CardDescription>{a.cached ? `Nothing changed since ${tipTime(a.generatedAt)} — reusing that result` : `Recalculated ${tipTime(a.generatedAt)}`} · checks for changes every 2 min</CardDescription></div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "Simulating…" : "Refresh"}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {a.doNow && <DoNowView d={a.doNow} />}
          <details open={!a.doNow}>
            <summary className="text-sm text-gray-500 cursor-pointer">Details: the engine&apos;s calls in words</summary>
            {a.actions.length ? <ol className="list-decimal pl-5 space-y-1 mt-2 text-sm">{a.actions.map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="text-gray-500">Nothing to do right now.</p>}
          </details>
          {a.notes.map((n, i) => <p key={i} className="text-xs text-gray-500 mt-2">{n}</p>)}
        </CardContent>
      </Card>

      {a.decisions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Lock decisions</CardTitle><CardDescription>Each option simulated over the rest of the week for both teams (same random outcomes for every option).</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {a.decisions.map((d) => (
              <div key={d.pid} className="border rounded-lg p-3">
                <div className="flex justify-between flex-wrap gap-2">
                  <div className="font-semibold">{d.player} · <span className="text-green-600">{fmt(d.score)}</span></div>
                  <div className="text-sm text-gray-500">deadline {d.deadlineText} · lock cut-off {fmt(d.threshold)}</div>
                </div>
                <table className="w-full text-sm mt-2">
                  <thead><tr className="text-left text-gray-500"><th>Option</th><th>Exp. week total</th><th>Win prob</th></tr></thead>
                  <tbody>{d.options.map((op, i) => {
                    const rec = op.action === d.recommended && op.slot === d.recommendedSlot;
                    return <tr key={i} className={rec ? "font-semibold text-blue-700 dark:text-blue-300" : ""}><td>{op.action}{op.slot ? ` → ${op.slot}` : ""}{rec ? "  ✓" : ""}</td><td>{fmt(op.expPoints)}</td><td>{pct(op.winProb)}</td></tr>;
                  })}</tbody>
                </table>
                <p className="text-sm mt-2">{d.reason}</p>
                {d.moves?.length > 0 && <ol className="text-sm mt-1 list-decimal pl-5 text-blue-800 dark:text-blue-300">{d.moves.map((m, i) => <li key={i}>{m}</li>)}</ol>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Lineup plan ({a.plan.length && a.plan[0].tip - Date.now() > 30 * 3600e3 ? `next game day: ${a.plan[0].when}` : "next 30 hours"})</CardTitle><CardDescription>Who to start at each tip-off, and the score at which each starter is worth locking. Later tip-offs assume earlier games go to projection.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {a.plan.length === 0 && <p className="text-gray-500">No more games for your players this week.</p>}
          {a.plan.length > 0 && a.plan[0].tip - Date.now() > 30 * 3600e3 && <p className="text-xs text-gray-500 mb-2">No regular-season games for your players in the next 30 hours (NBA preseason games don't count in Sleeper), so this is the plan for the next game day.</p>}
          {a.plan.map((p) => (
            <div key={p.tip} className="border-l-4 border-blue-500 pl-3">
              <div className="font-semibold">{p.when} {p.tentative && <Badge variant="outline">tentative</Badge>}</div>
              <table className="w-full text-sm mt-1"><tbody>
                {p.starts.map((s) => <tr key={s.pid}><td className="w-16 font-mono">{s.slot}</td><td>{s.player}</td><td>proj {fmt(s.proj)}{s.label && <div className="text-[11px] text-amber-700">{s.label}</div>}</td><td>lock if ≥ <b>{fmt(s.lockIf)}</b></td></tr>)}
              </tbody></table>
              {p.holds?.length > 0 && <div className="text-sm mt-1 text-purple-700 dark:text-purple-300">Holding (keep in a starting slot, never the bench): {p.holds.map((h) => `${h.player} ${fmt(h.score)} in ${h.slot}${h.move ? ` (move from ${h.from ?? "?"})` : ""}`).join("; ")}</div>}
              {p.forfeits?.length > 0 && <div className="text-xs text-orange-600 mt-1">Let go to free a slot: {p.forfeits.map((f) => `${f.player} (${fmt(f.score)})`).join(", ")}</div>}
              {p.benched.length > 0 && <div className="text-xs text-gray-500 mt-1">Bench: {p.benched.map((b) => `${b.player} (${fmt(b.proj)}${b.label ? `; ${b.label}` : ""})`).join(", ")}</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <SlotsCard title="Your lineup (from Sleeper)" team={a.me} onToggle={(i, pid) => setLocks({ ...locks, [i]: pid })} />
        {a.opp && <SlotsCard title={`${a.opp.name}`} team={a.opp} />}
      </div>

      <Card>
        <CardHeader><CardTitle>Week board</CardTitle><CardDescription>Projection (league scoring) or actual for each game. Grey = final, blue = live.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="text-left text-gray-500"><th>Player</th>{a.dates.map((d) => <th key={d} className="px-2">{d.slice(5)}</th>)}</tr></thead>
            <tbody>{a.me.players.map((p) => (
              <tr key={p.pid} className={p.locked ? "bg-purple-50 dark:bg-purple-900/20" : ""}>
                <td className="py-1 pr-2 whitespace-nowrap">{p.name} <span className="text-xs text-gray-500">{p.pos}</span> {p.injury && <Badge variant="outline" className="text-xs">{p.injury}</Badge>}{p.projOverride && <Badge variant="outline" className="text-xs ml-1 border-amber-500 text-amber-700" title={p.projOverride}>minutes override</Badge>}{p.rosterNote && <Badge variant="outline" className="text-xs ml-1 border-red-500 text-red-700" title={p.rosterNote}>{p.rosterNote.startsWith("not on") ? "not on roster" : "new team"}</Badge>}</td>
                {a.dates.map((d) => { const g = p.games.find((x) => x.date === d); return (
                  <td key={d} className={`px-2 ${g?.status === "post" ? "text-gray-500" : g?.status === "in" ? "text-blue-600 font-semibold" : ""}`} title={g?.projOverride}>
                    {g ? (g.actual !== null ? fmt(g.actual) : fmt(g.proj)) : ""}{g?.projOverride && g.actual === null ? <span className="text-amber-600">*</span> : null}<div className="text-[10px] text-gray-400">{g ? `${g.opp} ${tipTime(g.tip).split(" ").slice(1).join(" ")}` : ""}</div>
                  </td>); })}
              </tr>))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// task U: the lineup to set in Sleeper before the next tip-off (rows needing a change highlighted), LOCK banners,
// then the later changes today and the bench (lib/live/donow.ts)
function DoNowView({ d }: { d: DoNow }) {
  const kindCls: Record<string, string> = { locked: "text-purple-700 dark:text-purple-300", lock: "text-purple-700 dark:text-purple-300 font-semibold", held: "text-amber-700 dark:text-amber-300", freeRoll: "text-orange-600", playing: "text-blue-600" };
  return (
    <div className="space-y-4">
      {d.locks.map((l) => (
        <div key={l.pid} className="rounded-lg border-2 border-purple-500 bg-purple-50 dark:bg-purple-900/30 p-3">
          <div className="text-lg font-bold text-purple-800 dark:text-purple-200">🔒 LOCK {l.player} ({fmt(l.score)}) in {l.slot}</div>
          <div className="text-sm text-purple-800 dark:text-purple-200">Do it {l.by} - his next game replaces the score otherwise.</div>
        </div>
      ))}
      <div>
        <div className="font-semibold mb-1">Set your lineup to{d.tipText ? ` (before the ${d.tipText} tip-off)` : ""}</div>
        <div className="divide-y rounded-lg border">
          {d.rows.map((r) => (
            <div key={r.slot} className={`flex gap-2 px-2 py-1.5 text-sm ${r.change ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}`}>
              <div className="w-14 shrink-0 font-mono text-xs pt-0.5 text-gray-500">{r.slot}</div>
              <div className="min-w-0 flex-1">
                <div><span className="font-medium">{r.player ?? <span className="text-gray-400">empty</span>}</span> <span className={`text-xs ${kindCls[r.kind] ?? "text-gray-500"}`}>{r.status}</span></div>
                {r.change && <div className="text-xs font-semibold text-yellow-800 dark:text-yellow-300">change: {r.change}</div>}
                {r.later && <div className="text-[11px] text-gray-500">later {r.later}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {d.upToDate
        ? <div className="rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 p-3 font-medium">✅ {d.upToDate}</div>
        : <div><div className="font-semibold">Do now, in this order</div><ol className="list-decimal pl-5 text-sm space-y-0.5">{d.changes.map((c, i) => <li key={i}>{c}</li>)}</ol>
            <div className="text-[11px] text-gray-500 mt-1">Held players move only between starting slots - moving one to the bench forfeits his score.</div></div>}
      {d.then.length > 0 && (
        <div>
          <div className="font-semibold">Then</div>
          <div className="space-y-2 mt-1">{d.then.map((s, i) => (
            <div key={i} className="border-l-4 border-blue-400 pl-2 text-sm">
              <div className="font-medium">{s.title}{s.tentative && <span className="text-[11px] text-gray-500"> · tentative (assumes projections; the plan is redone as games finish)</span>}</div>
              <ul className="list-disc pl-5 text-xs space-y-0.5">{s.items.map((x, j) => <li key={j} className={/^LOCK /.test(x) ? "font-semibold text-purple-700" : ""}>{x}</li>)}</ul>
            </div>))}
          </div>
        </div>
      )}
      {d.bench.length > 0 && <div className="text-xs text-gray-600 dark:text-gray-300"><span className="font-semibold">Bench:</span> {d.bench.join(" · ")}</div>}
    </div>
  );
}

function SlotsCard({ title, team, onToggle }: { title: string; team: Advice["me"]; onToggle?: (slotIdx: number, pid: string | null) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{title}</CardTitle><CardDescription>Locked {fmt(team.lockedTotal)}{team.slots.some((s) => s.state === "held") ? ` · held ${fmt(team.slots.reduce((a, s) => a + (s.state === "held" ? s.points ?? 0 : 0), 0))} (not locked: lock or let go before the next tip-off)` : ""}</CardDescription></CardHeader>
      <CardContent>
        <table className="w-full text-sm"><tbody>
          {team.slots.map((s, i) => (
            <tr key={i} className={s.locked ? "bg-purple-50 dark:bg-purple-900/20" : ""}>
              <td className="font-mono w-14">{s.slot}</td><td>{s.player || <span className="text-gray-400">empty</span>}</td>
              <td><Badge variant={s.locked ? "default" : "outline"} className={s.state === "held" ? "border-amber-500 text-amber-700" : ""}>{s.stateText ?? s.state}</Badge></td><td>{s.points !== null ? fmt(s.points) : ""}</td>
              {onToggle && <td className="text-right">{s.pid && <button className="text-xs underline text-gray-500" onClick={() => onToggle(i, s.locked ? null : s.pid)}>{s.locked ? "mark unlocked" : "mark locked"}</button>}</td>}
            </tr>))}
        </tbody></table>
      </CardContent>
    </Card>
  );
}

function ReplayView({ leagues, initialLeague, initialWeek }: { leagues: LeagueOpt[]; initialLeague: string; initialWeek: number }) {
  const [lid, setLid] = useState(initialLeague);
  const [week, setWeek] = useState(initialWeek);
  const [r, setR] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const l = leagues.find((x) => x.league_id === lid);
  const run = useCallback(async () => {
    if (!l?.roster_id) return;
    setLoading(true); setErr(null); setR(null);
    try { const res = await fetch(`/api/replay?league=${lid}&roster=${l.roster_id}&week=${week}`); const j = await res.json(); if (!res.ok) throw new Error(j.error); setR(j); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [lid, week, l?.roster_id]);
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => { const m = new Map<string, Replay["log"]>(); r?.log.forEach((x) => { const k = x.when.split(" ")[0]; m.set(k, [...(m.get(k) || []), x]); }); return m; }, [r]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Replay a finished week</CardTitle><CardDescription>Runs the full strategy through the week with the real results, using only information available at each moment. Compare it with what you actually scored. Historical injury reports aren&apos;t available, so a replay may &quot;start&quot; a player who was ruled out; live mode uses Sleeper&apos;s injury status.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <select className="border rounded px-2 py-2 text-sm bg-white dark:bg-gray-800" value={lid} onChange={(e) => setLid(e.target.value)}>
            {leagues.map((x) => <option key={x.league_id} value={x.league_id}>{x.name} · {x.season}</option>)}
          </select>
          <Input type="number" className="w-24" min={1} max={25} value={week} onChange={(e) => setWeek(Number(e.target.value))} />
          <Button onClick={run} disabled={loading}>{loading ? "Replaying… (~10s)" : "Replay"}</Button>
        </CardContent>
      </Card>
      {err && <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{err}</div>}
      {r && (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            <Stat label={`${r.league} ${r.season} · week ${r.week}`} value={`${r.dates[0]?.slice(5)} → ${r.dates[r.dates.length - 1]?.slice(5)}`} sub={r.team} />
            <Stat label="App strategy would have scored" value={fmt(r.appTotal)} highlight />
            <Stat label="You actually scored" value={fmt(r.humanTotal)} sub={r.humanTotal !== null ? `${r.appTotal - r.humanTotal >= 0 ? "+" : ""}${fmt(r.appTotal - r.humanTotal)} for the app` : ""} />
            <Stat label="Perfect hindsight (impossible)" value={fmt(r.hindsight)} sub={r.oppName ? `opponent ${r.oppName}: ${fmt(r.oppHuman)}` : ""} />
          </div>
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader><CardTitle className="text-lg">Final locked lineup</CardTitle></CardHeader>
              <CardContent><table className="w-full text-sm"><tbody>{r.lineupBySlot.map((s, i) => <tr key={i}><td className="font-mono w-14">{s.slot}</td><td>{s.player || "–"}</td><td className="text-right">{fmt(s.points)}</td></tr>)}</tbody></table></CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-lg">What the app would have told you</CardTitle></CardHeader>
              <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
                {[...byDay.entries()].map(([day, items]) => (
                  <div key={day}><div className="font-semibold text-sm">{day}</div>
                    <ul className="text-sm">{items.map((x, i) => <li key={i} className={x.kind === "lock" ? "text-purple-700 dark:text-purple-300 font-medium" : x.kind === "pass" ? "text-orange-600" : x.kind === "auto" ? "text-green-700" : "text-gray-600 dark:text-gray-300"}>{x.when.split(" ").slice(1).join(" ")} — {x.text}</li>)}</ul>
                  </div>))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function WaiversView({ leagueId, rosterId }: { leagueId: string; rosterId: number }) {
  const KEY = `lockin-protect-${leagueId}`;
  const [w, setW] = useState<WaiverAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [protect, setProtect] = useState<string[]>([]);
  useEffect(() => { setProtect(JSON.parse(localStorage.getItem(KEY) || "[]")); }, [KEY]);
  const load = useCallback(async (fresh = false) => {
    setLoading(true); setErr(null);
    try {
      const q = new URLSearchParams({ league: leagueId, roster: String(rosterId), protect: protect.join(",") }); if (fresh) q.set("fresh", "1");
      const r = await fetch(`/api/waivers?${q}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); setW(j);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [leagueId, rosterId, protect]);
  useEffect(() => { load(); }, [load]);
  const toggle = (pid: string) => { const n = protect.includes(pid) ? protect.filter((x) => x !== pid) : [...protect, pid]; setProtect(n); localStorage.setItem(KEY, JSON.stringify(n)); };
  const pl = (p: WaiverPlayer) => `${p.name} (${p.pos}${p.team ? " " + p.team : ""})`;
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
  if (err) return <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{err}</div>;
  if (!w) return <div className="space-y-6"><IrCard leagueId={leagueId} rosterId={rosterId} protect={protect} /><div className="text-gray-500">Simulating every add/drop over this week and next… (~20-40 s)</div></div>;
  return (
    <div className="space-y-6">
      <IrCard leagueId={leagueId} rosterId={rosterId} protect={protect} />
      <OpportunityCard leagueId={leagueId} rosterId={rosterId} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Best waiver moves</CardTitle><CardDescription>Week {w.week}{w.nextWeek ? ` + week ${w.nextWeek}` : ""} · {w.rosterFull ? "roster full: each add needs a drop" : `${w.openSpots} open spot(s)`} · {w.cached ? `no changes since ${tipTime(w.generatedAt)}` : `recalculated ${tipTime(w.generatedAt)}`}</CardDescription></div>
          <Button size="sm" variant="outline" onClick={() => load(false)} disabled={loading}>{loading ? "Checking…" : "Refresh"}</Button>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500"><th>Add</th><th>Drop</th><th>Games (this/next)</th><th>This wk</th><th>Next wk</th><th>Total</th><th></th></tr></thead>
            <tbody>{w.moves.map((m, i) => (
              <tr key={i} className={m.confident ? "font-semibold" : "text-gray-500"}>
                <td>{pl(m.add)}{m.add.injury && <Badge variant="outline" className="ml-1 text-xs">{m.add.injury}</Badge>}<div className="text-[11px] font-normal text-gray-500">{m.add.projPerGame ?? "–"} pts/g · {m.add.note}</div>{m.add.projOverride && <div className="text-[11px] font-normal text-amber-700">{m.add.projOverride}</div>}</td>
                <td>{m.drop ? pl(m.drop) : "—"}</td><td>{m.add.gamesThisWeek}/{m.add.gamesNextWeek}</td>
                <td>{sign(m.gainThisWeek)}</td><td>{sign(m.gainNextWeek)}</td><td>{sign(m.total)} <span className="text-xs font-normal">±{(2 * m.se).toFixed(1)}</span></td>
                <td>{m.confident ? <Badge>worth it</Badge> : <span className="text-xs">within noise</span>}</td>
              </tr>))}</tbody>
          </table>
          {w.notes.map((n, i) => <p key={i} className="text-xs text-gray-500 mt-2">{n}</p>)}
          <ul className="text-xs text-gray-500 mt-2 list-disc pl-5">{w.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </CardContent>
      </Card>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">Your droppable players</CardTitle><CardDescription>Points over this week + next if you drop each (2,000 simulated weeks, ± = 95% range). ≈0 = doesn&apos;t matter. A real positive number means the simulation&apos;s lineup rule handles him badly. Tick to protect.</CardDescription></CardHeader>
          <CardContent><table className="w-full text-sm"><tbody>{w.droppable.map((d) => (
            <tr key={d.pid}><td><input type="checkbox" checked={protect.includes(d.pid)} onChange={() => toggle(d.pid)} /></td><td>{pl(d)}</td><td className="tabular-nums">{Math.abs(d.loss) < 2 * (d.se ?? 0) ? <span className="text-gray-500">≈0 <span className="text-xs">(±{fmt(2 * (d.se ?? 0))})</span></span> : <>{sign(-d.loss)} <span className="text-xs text-gray-500">±{fmt(2 * (d.se ?? 0))}</span></>}</td><td className="text-xs text-gray-500">{d.reason || ""}</td></tr>))}</tbody></table></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">Top free agents</CardTitle><CardDescription>Value if added without dropping anyone.</CardDescription></CardHeader>
          <CardContent><table className="w-full text-sm"><tbody>{w.candidates.map((c) => (
            <tr key={c.pid}><td>{pl(c)}</td><td>{c.gamesThisWeek}/{c.gamesNextWeek} g</td><td title={c.projOverride}>{c.projPerGame ?? "–"}/g{c.projOverride && <span className="text-amber-600">*</span>}</td><td>{sign(c.gainNoDrop)}</td><td className="text-xs text-gray-500">{c.age ? `age ${c.age}` : ""}{c.dynastyAdp ? ` · ADP ${Math.round(c.dynastyAdp)}` : ""}</td></tr>))}</tbody></table></CardContent>
        </Card>
      </div>
    </div>
  );
}

function IrCard({ leagueId, rosterId, protect }: { leagueId: string; rosterId: number; protect: string[] }) {
  const [a, setA] = useState<IrAdvice | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const r = await fetch(`/api/ir?league=${leagueId}&roster=${rosterId}&protect=${protect.join(",")}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); setA(j); } catch (e: any) { setErr(e.message); } })(); }, [leagueId, rosterId, protect]);
  if (err) return <div className="p-3 rounded bg-red-50 text-red-700 text-sm">IR: {err}</div>;
  if (!a) return <Card><CardContent className="py-4 text-gray-500 text-sm">Checking IR…</CardContent></Card>;
  return (
    <Card className={a.actions.some((x) => x.urgent) ? "border-red-400" : ""}>
      <CardHeader><CardTitle className="text-lg">IR &amp; roster health</CardTitle><CardDescription>{a.rules}</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div><b>On IR ({a.onIr.length}/{a.capacity}):</b> {a.onIr.map((x) => `${x.name} [${x.status ?? "healthy"}${x.eligible ? "" : " — NOT eligible"}], back ~${x.returnDate ?? "?"}`).join("; ") || "empty"}</div>
        <div><b>Out on your active roster:</b> {a.activeOut.map((x) => `${x.name} [${x.status}], back ~${x.returnDate ?? "?"}`).join("; ") || "none"}</div>
        {a.actions.map((x) => (
          <div key={x.key} className={`border rounded p-2 ${x.urgent ? "border-red-400 bg-red-50 dark:bg-red-900/20" : ""}`}>
            <div className="font-semibold">{x.urgent ? "⚠️ " : ""}{x.title}</div><div className="text-gray-600 dark:text-gray-300">{x.detail}</div>
            {x.dropOptions && <div className="text-xs text-gray-500 mt-1">Drop options (points lost over two weeks): {x.dropOptions.map((d) => `${d.name} ${d.loss < 0.5 ? "≈0" : "−" + d.loss.toFixed(1)}${d.protected ? ` (${d.reason})` : ""}`).join(" · ")}</div>}
          </div>))}
      </CardContent>
    </Card>
  );
}

// task O: rotation players out -> who absorbs the minutes; minutes surges (lib/live/oppscan.ts)
function OpportunityCard({ leagueId, rosterId }: { leagueId: string; rosterId: number }) {
  const [r, setR] = useState<OppReport | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const x = await fetch(`/api/opportunity?league=${leagueId}&roster=${rosterId}`); const j = await x.json(); if (!x.ok) throw new Error(j.error); setR(j); } catch (e: any) { setErr(e.message); } })(); }, [leagueId, rosterId]);
  if (err) return <div className="p-3 rounded bg-red-50 text-red-700 text-sm">Opportunities: {err}</div>;
  if (!r) return <Card><CardContent className="py-4 text-gray-500 text-sm">Checking minutes (box scores)…</CardContent></Card>;
  const tag = (s: string) => s === "fa" ? <Badge className="text-xs">free agent</Badge> : s === "mine" ? <Badge variant="outline" className="text-xs">yours</Badge> : null;
  const abs = r.absences.filter((a) => a.candidates.some((c) => c.gain >= 4 && c.status !== "rostered"));
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Opportunities (minutes)</CardTitle><CardDescription>Rotation players ruled out and the teammates expected to absorb their minutes; free agents whose recent minutes run well above their projection. Estimates = shrunk recent fp/min × expected minutes. Backtest: the minutes calls are right (top pick +8 min on average), but adding these free agents gained ≈0 real points in our league. Minutes override in simulations: {r.enabled.minutesOverride ? "on" : "off"}.</CardDescription></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {abs.length === 0 && r.surges.length === 0 && <div className="text-gray-500">Nothing notable right now.</div>}
        {abs.slice(0, 8).map((a) => (
          <div key={a.pid}><b>{a.name}</b> ({a.team}, {a.mpg} mpg) {a.injury}: {a.candidates.filter((c) => c.gain >= 4).slice(0, 3).map((c) => (
            <span key={c.pid} className="mr-3" title={c.why}>{c.name} {tag(c.status)} {c.expMin} min (+{c.gain}), ~{c.est} fp/g{c.sleeperProj !== null ? ` (Sleeper ${fmt(c.sleeperProj)})` : " (Sleeper: none)"}</span>))}</div>))}
        {r.surges.filter((s) => s.status !== "rostered").map((s) => <div key={s.pid}><b>{s.name}</b> {tag(s.status)} minutes surge: {s.why}</div>)}
        <div className="text-xs text-gray-500">{r.box.games} box scores ({r.box.preseasonGames} preseason){r.notes.length ? ` · ${r.notes.join(" · ")}` : ""}</div>
      </CardContent>
    </Card>
  );
}

function MatchupsView({ leagueId, rosterId }: { leagueId: string; rosterId: number }) {
  const [w, setW] = useState<LeagueWeek | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await fetch(`/api/league-week?league=${leagueId}&roster=${rosterId}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); setW(j); }
    catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [leagueId, rosterId]);
  useEffect(() => { load(); const id = setInterval(() => document.visibilityState === "visible" && load(), 120000); return () => clearInterval(id); }, [load]);
  if (err) return <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{err}</div>;
  if (!w) return <div className="text-gray-500">Simulating all 10 teams' weeks… (~10 s)</div>;
  const ranked = w.matchups.flatMap((m) => [m.a, ...(m.b ? [m.b] : [])]).sort((x, y) => y.mean - x.mean);
  const rank = (t: LeagueTeam) => ranked.findIndex((x) => x.rosterId === t.rosterId) + 1;
  const Side = ({ t, win, right }: { t: LeagueTeam; win: number | null; right?: boolean }) => (
    <div className={`flex-1 ${right ? "text-right" : ""}`}>
      <div className={`font-semibold ${t.mine ? "text-blue-600 dark:text-blue-400" : ""}`}>{t.name}{t.mine ? " (you)" : ""}</div>
      <div className="text-3xl font-bold tabular-nums">{fmt(t.mean, 0)}</div>
      <div className="text-xs text-gray-500">80% range {fmt(t.p10, 0)}–{fmt(t.p90, 0)} · #{rank(t)} of {ranked.length}</div>
      <div className="text-xs text-gray-500">{t.current ? `Now ${fmt(t.current)} (locked ${fmt(t.locked)}) · ` : ""}{t.gamesLeft}/{t.playerGames} player-games left</div>
      <div className="text-xs text-gray-500 mt-1">Top: {t.top.map((p) => `${p.name} ${p.games}×${fmt(p.proj, 0)}`).join(", ")}</div>
      {t.out.length > 0 && <div className="text-xs text-orange-600">Out/doubtful: {t.out.join(", ")}</div>}
      {win !== null && <div className={`mt-1 text-sm font-semibold ${win >= 0.5 ? "text-green-600" : "text-red-600"}`}>{pct(win)} to win</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><div className="text-lg font-semibold">Week {w.week} matchups · {w.dates[0]?.slice(5)} → {w.dates[w.dates.length - 1]?.slice(5)}</div>
          <div className="text-xs text-gray-500">Projected Lock-In totals: {w.sims} simulated weeks per team, assuming each team locks well from its real current locks and scores (future locks use the fast rule; the full per-decision simulation adds about +3 pts to every team on average, which cancels out in win %). Teams that don't play Lock-In well will score below this. {w.cached ? "Nothing changed — reusing the last result." : "Just recalculated."}</div></div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "Simulating…" : "Refresh"}</Button>
      </div>
      {w.matchups.map((m) => (
        <Card key={m.id} className={m.mine ? "border-blue-400" : ""}>
          <CardContent className="py-4">
            <div className="flex gap-4 items-start">
              <Side t={m.a} win={m.winA} />
              <div className="self-center text-gray-400 text-sm">vs</div>
              {m.b ? <Side t={m.b} win={m.winA === null ? null : 1 - m.winA} right /> : <div className="flex-1 text-right text-gray-500">bye</div>}
            </div>
            {m.winA !== null && <div className="mt-3 h-2 rounded bg-red-200 dark:bg-red-900 overflow-hidden"><div className="h-2 bg-green-500" style={{ width: `${(100 * m.winA).toFixed(0)}%` }} /></div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HowItWorks() {
  return (
    <Card><CardContent className="prose dark:prose-invert max-w-none py-6 text-sm space-y-2">
      <p><b>Rules (Sleeper Lock-In):</b> a game is lockable only if the player started it; lock any time before his next tip-off as long as he never touches the bench; locked = fixed for the week; an unlocked starter&apos;s final game counts automatically; a slot can be reused the same night once a player&apos;s game ends.</p>
      <p><b>Model:</b> per-game Sleeper projections converted to your league scoring, corrected with last season&apos;s real results (actual ≈ 0.90×proj − 0.8, spread grows with the projection), sit-out odds from the injury report and whether he played his last game.</p>
      <p><b>Decisions:</b> close lock calls are settled by simulating the rest of the week a few hundred times for you and your opponent and comparing lock / hold / bench. Lineups use exact slot matching and the &quot;option value&quot; of each game.</p>
      <p><b>Backtest (2025-26, all 10 teams, 23 weeks):</b> this strategy averaged 274.6 pts/week vs 262.5 for the old app logic and 232.5 for the real managers, and beat opponents&apos; actual scores 60% of the time.</p>
    </CardContent></Card>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-blue-400" : ""}>
      <CardContent className="py-4"><div className="text-xs text-gray-500">{label}</div><div className={`text-2xl font-bold ${highlight ? "text-blue-600" : ""}`}>{value}</div>{sub && <div className="text-xs text-gray-500">{sub}</div>}</CardContent>
    </Card>
  );
}
