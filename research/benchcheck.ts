// When start/sit simulation overrides the rule, what does it do? In particular: does it ever sit a player while his
// slot then stays EMPTY for his whole game (nobody else could use it)?
import * as E from "./engine";
import { S, fitModel, teamWeek } from "./btcommon";
const [wFrom, wTo] = (process.env.WEEKS || "1-23").split("-").map(Number); const K = Number(process.env.KS || 200);
const base: E.Policy = { name: "P2LA", matching: "exact", value: "stop", defer: true, reserve: true, chain: true, lockAware: true };
const c = { tipoffs: 0, overrides: 0, startExtra: 0, swap: 0, sitEmptyIdle: 0, sitSlotReused: 0, sitAndLater: 0 };
const ex: string[] = [];
for (let week = wFrom; week <= wTo; week++) {
  const W = S.weeks.find((x: any) => x.week === week); if (!W) continue; const model = fitModel(week);
  for (const rid of Object.keys(W.teams)) {
    const { tw, real } = teamWeek(week, rid, model); const evs = E.buildEvents(tw, true);
    const h = E.startRolloutHooks(tw, base, evs, K, week * 1000 + Number(rid), real);
    const hooks: E.Hooks = { decideStarts: (st, t, evIdx, tipping, pending, gameOf, slotOf, free) => {
      c.tipoffs++;
      const alt = h.decideStarts!(st, t, evIdx, tipping, pending, gameOf, slotOf, free);
      if (!alt) return alt; c.overrides++;
      const sat = tipping.filter((p) => slotOf.has(p) && !alt.has(p)), added = tipping.filter((p) => !slotOf.has(p) && alt.has(p));
      if (added.length && sat.length) c.swap++; else if (added.length) c.startExtra++;
      for (const p of sat) {
        if (added.length) continue;
        const s = slotOf.get(p)!; const g = tw.games[gameOf.get(p)!];
        // will anyone tip while his game would have been running, who could use that slot?
        const later = tw.games.some((q) => q.tip > t && q.tip < g.end && !st.isLocked[q.p] && (tw.slots[s] & tw.pmask[q.p]));
        if (later) c.sitSlotReused++; else { c.sitEmptyIdle++; if (ex.length < 6) ex.push(`w${week} r${rid}: sat ${tw.names[p]} (proj ${g.mu.toFixed(0)}) - slot ${tw.slotNames[s]} idle during his game; he actually scored ${real.played[gameOf.get(p)!] ? real.actual[gameOf.get(p)!].toFixed(1) : "DNP"}`); }
      }
      return alt;
    } };
    E.simulate(tw, base, evs, real.actual, real.played, E.initState(tw), 0, hooks);
  }
}
console.log(JSON.stringify(c)); console.log(ex.join("\n"));
