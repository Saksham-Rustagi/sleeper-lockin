import { NextRequest, NextResponse } from "next/server";
import { sleeper } from "@/lib/live/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// username -> NBA leagues (current + previous seasons, following previous_league_id) with the user's roster id in each
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });
  try {
    const user = await sleeper.user(username);
    if (!user?.user_id) return NextResponse.json({ error: `Sleeper user '${username}' not found` }, { status: 404 });
    const state = await sleeper.state();
    const seasons = [state.league_season, state.previous_season].filter(Boolean);
    const out: any[] = []; const seen = new Set<string>();
    for (const s of seasons) {
      for (const l of await sleeper.leagues(user.user_id, s).catch(() => [])) {
        let cur: any = l;
        while (cur && !seen.has(cur.league_id)) {
          seen.add(cur.league_id);
          const rosters = await sleeper.rosters(cur.league_id).catch(() => []);
          const mine = rosters.find((r: any) => r.owner_id === user.user_id || (r.co_owners || []).includes(user.user_id));
          out.push({ league_id: cur.league_id, name: cur.name, season: cur.season, status: cur.status, roster_id: mine?.roster_id ?? null, total_rosters: cur.total_rosters });
          cur = cur.previous_league_id && cur.previous_league_id !== "0" ? await sleeper.league(cur.previous_league_id).catch(() => null) : null;
        }
      }
    }
    out.sort((a, b) => Number(b.season) - Number(a.season));
    return NextResponse.json({ user: { user_id: user.user_id, username: user.username, display_name: user.display_name }, leagues: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
