// Reference solvers for tiny Lock-In weeks (used by tests/lagrange.test.ts and research/lagtiny.ts).
import * as E from "../lib/engine/core";
import type * as L from "../lib/engine/lagrange";

const H = 3600e3;

// Exact optimum of a tiny Lock-In week by expectimax over the true rules: decisions at every tip-off (start/bench with
// a slot; each held score keep / lock into an open eligible unpinned slot / let go; a held player whose own game tips
// must lock or let go), held players move freely between unpinned open slots they're eligible for (feasible matching),
// in-game players pinned, scores and play/DNP revealed at game end, held final-game scores count at week end (or are
// benched if negative). Deferring locks/releases to the next tip-off is without loss: nothing needs a slot in between.
export function bruteForce(inst: L.LInstance): number {
  const nS = inst.slots.length, nP = inst.pmask.length; const G = inst.games;
  type Ev = { t: number; kind: 0 | 1; gs: number[] };
  const evs: Ev[] = [];
  G.forEach((g, i) => evs.push({ t: g.end, kind: 0, gs: [i] }));
  const tips = new Map<number, number[]>(); G.forEach((g, i) => { if (!tips.has(g.tip)) tips.set(g.tip, []); tips.get(g.tip)!.push(i); });
  for (const [t, gs] of tips) evs.push({ t, kind: 1, gs });
  evs.sort((a, b) => a.t - b.t || a.kind - b.kind);
  // status 0 free / 1 in game gOf[p] / 2 held x[p] / 3 locked; lp last played; pin[s] player in game; lk locked-slot mask
  type St = { status: number[]; x: number[]; lp: number[]; gOf: number[]; pin: number[]; lk: number };
  const clone = (s: St): St => ({ status: s.status.slice(), x: s.x.slice(), lp: s.lp.slice(), gOf: s.gOf.slice(), pin: s.pin.slice(), lk: s.lk });
  const memo = new Map<string, number>();
  const canPlace = (players: number[], open: number): boolean => {
    const match = new Array(nS).fill(-1);
    const aug = (p: number, seen: boolean[]): boolean => {
      for (let s = 0; s < nS; s++) if ((open >> s) & 1 && inst.slots[s] & inst.pmask[p] && !seen[s]) { seen[s] = true; if (match[s] < 0 || aug(match[s], seen)) { match[s] = p; return true; } }
      return false;
    };
    return players.every((p) => aug(p, new Array(nS).fill(false)));
  };
  // value of the rest of the week (points already locked are added by the caller)
  const rec = (ei: number, st: St): number => {
    if (ei === evs.length) { let v = 0; for (let p = 0; p < nP; p++) if (st.status[p] === 2) v += Math.max(0, st.x[p]); return v; }
    const key = ei + "|" + st.status.join(",") + "|" + st.x.join(",") + "|" + st.lp.join(",") + "|" + st.gOf.join(",") + "|" + st.pin.join(",") + "|" + st.lk;
    const hit = memo.get(key); if (hit !== undefined) return hit;
    const e = evs[ei]; let val: number;
    if (e.kind === 0) {
      const gi = e.gs[0]; const g = G[gi]; const p = g.p;
      const started = st.status[p] === 1 && st.gOf[p] === gi;
      const q = g.pPlay ?? (st.lp[p] ? inst.dnp.p1 : inst.dnp.p0);
      const next = (played: number, x: number) => {
        const s2 = clone(st); s2.lp[p] = played;
        if (started) { s2.status[p] = 2; s2.x[p] = x; s2.pin[s2.pin.indexOf(p)] = -1; s2.gOf[p] = -1; }
        return rec(ei + 1, s2);
      };
      if (st.status[p] === 3) val = next(st.lp[p], 0);
      else {
        val = q < 1 ? (1 - q) * next(0, 0) : 0;
        if (q > 0) {
          const d = g.dist as { x: number[]; w: number[] };
          if (started) for (let i = 0; i < d.x.length; i++) val += q * d.w[i] * next(1, d.x[i]);
          else val += q * next(1, 0);
        }
      }
    } else {
      const tipping = e.gs.filter((gi) => st.status[G[gi].p] !== 3);
      const tipP = new Set(tipping.map((gi) => G[gi].p));
      const held = st.status.map((s, p) => (s === 2 ? p : -1)).filter((p) => p >= 0);
      const pinned = st.pin.reduce((m, p, s) => (p >= 0 ? m | (1 << s) : m), 0);
      let best = -Infinity;
      const hd: number[] = new Array(held.length); // 0 keep, 1 let go, 2+s lock into s
      const sl: number[] = new Array(tipping.length);
      const recStart = (j: number, lkNew: number, used: number, gain: number) => {
        if (j === tipping.length) {
          const kept = held.filter((_, i) => hd[i] === 0);
          if (!canPlace(kept, ((1 << nS) - 1) & ~(st.lk | lkNew | pinned | used))) return;
          const s2 = clone(st); s2.lk |= lkNew;
          held.forEach((p, i) => { if (hd[i] === 1) { s2.status[p] = 0; s2.x[p] = 0; } else if (hd[i] >= 2) { s2.status[p] = 3; s2.x[p] = 0; } });
          tipping.forEach((gi, k) => { if (sl[k] >= 0) { const p = G[gi].p; s2.status[p] = 1; s2.pin[sl[k]] = p; s2.gOf[p] = gi; } });
          best = Math.max(best, gain + rec(ei + 1, s2));
          return;
        }
        const p = G[tipping[j]].p; const hi = held.indexOf(p);
        sl[j] = -1; recStart(j + 1, lkNew, used, gain);
        if (hi >= 0 && hd[hi] >= 2) return; // locked just now: he can't play
        for (let s = 0; s < nS; s++) if (!(((st.lk | lkNew | pinned | used) >> s) & 1) && inst.slots[s] & inst.pmask[p]) { sl[j] = s; recStart(j + 1, lkNew, used | (1 << s), gain); }
        sl[j] = -1;
      };
      const recHeld = (i: number, lkNew: number, gain: number) => {
        if (i === held.length) { recStart(0, lkNew, 0, gain); return; }
        const p = held[i];
        if (!tipP.has(p)) { hd[i] = 0; recHeld(i + 1, lkNew, gain); } // his own tip-off forces lock-or-let-go
        hd[i] = 1; recHeld(i + 1, lkNew, gain);
        for (let s = 0; s < nS; s++) if (!(((st.lk | lkNew | pinned) >> s) & 1) && inst.slots[s] & inst.pmask[p]) { hd[i] = 2 + s; recHeld(i + 1, lkNew | (1 << s), gain + st.x[p]); }
      };
      recHeld(0, 0, 0);
      val = best;
    }
    memo.set(key, val);
    return val;
  };
  return rec(0, { status: new Array(nP).fill(0), x: new Array(nP).fill(0), lp: inst.lastPlayed0.slice(), gOf: new Array(nP).fill(-1), pin: new Array(nS).fill(-1), lk: 0 });
}

export function randInst(r: () => number): L.LInstance {
  const SL = [["UTIL"], ["C"], ["G"], ["F"], ["UTIL", "C"], ["G", "UTIL"]];
  const POS = [["C"], ["PG"], ["SF", "PF"], ["PG", "SG"], ["PF", "C"]];
  const slots = SL[Math.floor(r() * SL.length)].map((s) => E.SLOT_MASK[s]);
  const nP = 2 + Math.floor(r() * 2);
  const pmask = Array.from({ length: nP }, () => E.posMask(POS[Math.floor(r() * POS.length)]));
  const games: L.LGame[] = [];
  for (let p = 0; p < nP; p++) {
    const nG = 2 + Math.floor(r() * 2);
    const days = [0, 1, 2, 3].sort(() => r() - 0.5).slice(0, nG).sort();
    for (const d of days) {
      const tip = d * 24 * H + [0, 1, 2.5, 3][Math.floor(r() * 4)] * H;
      const nv = 2 + Math.floor(r() * 2); const x: number[] = [], w: number[] = [];
      for (let i = 0; i < nv; i++) { x.push(Math.round(r() * 40 - 3)); w.push(0.2 + r()); }
      const sw = w.reduce((a, b) => a + b); games.push({ p, tip, end: tip + 2.5 * H, dist: { kind: "discrete", x, w: w.map((v) => v / sw) } });
    }
  }
  games.sort((a, b) => a.tip - b.tip);
  return { slots, pmask, games, lastPlayed0: Array.from({ length: nP }, () => (r() < 0.8 ? 1 : 0)), dnp: { p1: 0.85, p0: 0.4 } };
}


// Exact expected perfect-hindsight value: enumerate every outcome (play/DNP chain x discrete score) and take the best
// assignment of players (each counting his best game, >= 0) to distinct eligible slots.
export function expectedHindsight(inst: L.LInstance): number {
  const nP = inst.pmask.length; const byP: number[][] = Array.from({ length: nP }, () => []);
  inst.games.forEach((g, i) => byP[g.p].push(i));
  for (const l of byP) l.sort((a, b) => inst.games[a].tip - inst.games[b].tip);
  // per player: distribution of his best game score (enumerate his own games)
  const best: Map<number, number>[] = byP.map((l, p) => {
    const out = new Map<number, number>();
    const rec = (k: number, lp: number, m: number, pr: number) => {
      if (pr === 0) return;
      if (k === l.length) { out.set(m, (out.get(m) ?? 0) + pr); return; }
      const g = inst.games[l[k]]; const q = g.pPlay ?? (lp ? inst.dnp.p1 : inst.dnp.p0);
      rec(k + 1, 0, m, pr * (1 - q));
      const d = g.dist as { x: number[]; w: number[] };
      for (let i = 0; i < d.x.length; i++) rec(k + 1, 1, Math.max(m, d.x[i]), pr * q * d.w[i]);
    };
    rec(0, inst.lastPlayed0[p], 0, 1);
    return out;
  });
  let ev = 0;
  const vals = best.map((m) => [...m.entries()]);
  const w = new Float64Array(nP);
  const rec = (p: number, pr: number) => {
    if (p === nP) { const ps = [...Array(nP).keys()].filter((q) => w[q] > 0); ev += pr * E.assignExact(inst.slots, (1 << inst.slots.length) - 1, ps, inst.pmask, w).total; return; }
    for (const [v, q] of vals[p]) { w[p] = v; rec(p + 1, pr * q); }
  };
  rec(0, 1);
  return ev;
}
