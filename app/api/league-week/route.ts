import { NextRequest, NextResponse } from "next/server";
import { leagueWeek } from "@/lib/live/league";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league || !roster) return NextResponse.json({ error: "league and roster are required" }, { status: 400 });
  try {
    return NextResponse.json(await leagueWeek({ leagueId: league, rosterId: roster, week: q.get("week") ? Number(q.get("week")) : undefined }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
