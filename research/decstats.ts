// Decision statistics of policies on one team-week's real outcome (where do their points come from?).
// usage: node research/dist/decstats.cjs <week> <rid> <out.json>   env POLS=a;b (default P2LAH_LheldTie;P7H_LheldTie;P8)
import fs from "fs";
import * as E from "./engine";
import { fitModel, teamWeek } from "./btcommon";
import * as PL from "./policies";

const [week, rid, out] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const { tw, real } = teamWeek(week, rid, fitModel(week)); const seed = week * 1000 + Number(rid);
const row: any = { week, rid, pols: {} };
for (const pn of (process.env.POLS || "P2LAH_LheldTie;P7H_LheldTie;P8").split(";")) {
  const ru = PL.runner(pn, tw, seed, real); const st = E.initState(tw);
  const s: any = { starts: 0, startMu: 0, dnpStarts: 0, locks: 0, lockPts: 0, lockFinal: 0, lockEarly: 0, letGo: 0, letGoPts: 0, deadlineLetGo: 0, tipSlotsFree: 0, tipsSat: 0, satPts: 0 };
  for (let i = 0; i < ru.events.length; i++) {
    const e = ru.events[i]; const before = E.cloneState(st);
    E.simulate(tw, ru.pol, ru.events.slice(0, i + 1), real.actual, real.played, st, i, ru.hooks);
    for (let q = 0; q < tw.slots.length; q++) if (before.lockedBy[q] < 0 && st.lockedBy[q] >= 0) {
      const p = st.lockedBy[q]; s.locks++; s.lockPts += st.lockedPts[q];
      const last = tw.byPlayer[p][tw.byPlayer[p].length - 1]; if (tw.games[last].end <= e.t) s.lockFinal++; else if (e.kind === 2 && !e.group!.some((g) => tw.games[g].p === p)) s.lockEarly++;
    }
    for (let p = 0; p < tw.pmask.length; p++) if (!Number.isNaN(before.pendingX[p]) && Number.isNaN(st.pendingX[p]) && !st.isLocked[p]) {
      s.letGo++; s.letGoPts += before.pendingX[p]; if (e.kind !== 0 && e.group?.some((g) => tw.games[g].p === p) || e.kind === 1) s.deadlineLetGo++;
    }
    if (e.kind === 2) {
      for (const g of e.group!) {
        if (st.isLocked[tw.games[g].p]) continue;
        if (st.started[g]) { s.starts++; s.startMu += tw.games[g].mu; if (!real.played[g]) s.dnpStarts++; }
        else { s.tipsSat++; s.satPts += real.played[g] ? real.actual[g] : 0; }
      }
      let free = 0; for (let q = 0; q < tw.slots.length; q++) if (st.lockedBy[q] < 0 && st.pinned[q] < 0) free++;
      s.tipSlotsFree += free; // slots neither locked nor in use right after the tip-off (held scores sit in some of them)
    }
  }
  const res = E.simulate(tw, ru.pol, ru.events, real.actual, real.played, st, ru.events.length);
  let heldEnd = 0, heldPts = 0; for (let p = 0; p < tw.pmask.length; p++) if (!Number.isNaN(st.pendingX[p]) && !st.isLocked[p] && st.pendingX[p] > 0) { heldEnd++; heldPts += st.pendingX[p]; }
  let lockedSlots = 0; for (let q = 0; q < tw.slots.length; q++) if (st.lockedBy[q] >= 0) lockedSlots++;
  s.total = res.total; s.heldEnd = heldEnd; s.heldEndPts = heldPts; s.emptyEnd = tw.slots.length - lockedSlots - heldEnd;
  row.pols[pn] = s;
}
fs.writeFileSync(out, JSON.stringify(row));
