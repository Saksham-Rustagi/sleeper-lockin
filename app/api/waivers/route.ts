import { NextRequest, NextResponse } from "next/server";
import { waiverAdvice, type WaiverAdvice } from "@/lib/live/waivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const cache = new Map<string, { t: number; v: WaiverAdvice }>();

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const league = q.get("league"); const roster = Number(q.get("roster"));
  if (!league || !roster) return NextResponse.json({ error: "league and roster are required" }, { status: 400 });
  const protect = (q.get("protect") || "").split(",").filter(Boolean);
  const key = `${league}|${roster}|${protect.sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3 && q.get("fresh") !== "1") return NextResponse.json(hit.v);
  try {
    const v = await waiverAdvice({ leagueId: league, rosterId: roster, protect, N: q.get("N") ? Number(q.get("N")) : undefined });
    cache.set(key, { t: Date.now(), v });
    return NextResponse.json(v);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
