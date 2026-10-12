import { NextRequest, NextResponse } from "next/server";
import { waiverAdvice } from "@/lib/live/waivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league || !roster) return NextResponse.json({ error: "league and roster are required" }, { status: 400 });
  const protect = (q.get("protect") || "").split(",").filter(Boolean);
  try {
    // recomputes only when an input changed (fingerprint cache); fresh=1 forces a recompute
    const v = await waiverAdvice({ leagueId: league, rosterId: roster, protect, N: q.get("N") ? Number(q.get("N")) : undefined, force: q.get("fresh") === "1" });
    return NextResponse.json(v);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
