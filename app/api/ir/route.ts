import { NextRequest, NextResponse } from "next/server";
import { irAdvice } from "@/lib/live/ir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league || !roster) return NextResponse.json({ error: "league and roster are required" }, { status: 400 });
  try {
    const protect = (q.get("protect") || "").split(",").filter(Boolean);
    const whatIf = q.get("whatif") ? (JSON.parse(q.get("whatif")!) as Record<string, string | null>) : undefined;
    return NextResponse.json(await irAdvice({ leagueId: league, rosterId: roster, protect, statusOverride: whatIf }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
