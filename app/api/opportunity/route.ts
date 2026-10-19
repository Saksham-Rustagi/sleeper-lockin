import { NextRequest, NextResponse } from "next/server";
import { opportunityScan } from "@/lib/live/oppscan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Opportunity scan (task O): rotation players out -> teammates who should absorb the minutes, minutes surges, the
// minutes-based projection overrides (applied only with "minutesOverride": true) and the alert texts.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league) return NextResponse.json({ error: "league required" }, { status: 400 });
  try {
    return NextResponse.json(await opportunityScan({ leagueId: league, rosterId: Number.isFinite(roster) && roster > 0 ? roster : undefined }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
