import { NextRequest, NextResponse } from "next/server";
import { replay } from "@/lib/live/advise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster")); const week = Number(q.get("week"));
  if (!league || !roster || !week) return NextResponse.json({ error: "league, roster and week are required" }, { status: 400 });
  try {
    return NextResponse.json(await replay({ leagueId: league, rosterId: roster, week, K: q.get("K") ? Number(q.get("K")) : 150 }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
