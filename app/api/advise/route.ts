import { NextRequest, NextResponse } from "next/server";
import { advise } from "@/lib/live/advise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league || !roster) return NextResponse.json({ error: "league and roster are required" }, { status: 400 });
  try {
    const locks = q.get("locks") ? (JSON.parse(q.get("locks")!) as Record<number, string | null>) : undefined;
    const a = await advise({
      leagueId: league, rosterId: roster, week: q.get("week") ? Number(q.get("week")) : undefined,
      asOf: q.get("asOf") ? Number(q.get("asOf")) : undefined, lockOverrides: locks, K: q.get("K") ? Number(q.get("K")) : 300,
    });
    return NextResponse.json(a);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
