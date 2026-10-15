// Task H part 2(c): how loose is the Lagrangian bound as contention grows? Exact optimum by brute force
// (research/bruteforce.ts) on random small weeks larger than lagtiny's: S slots, P players, 2-3 games each over 4 days,
// 3-valued discrete scores, DNP chain. Prints one JSON line per configuration.
// usage: node research/dist/h_lagmed.cjs <S> <P> <trials> [seed]
import * as E from "./engine";
import * as L from "../lib/engine/lagrange";
import { bruteForce, expectedHindsight } from "./bruteforce";
const [nS, nP, N, seed] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5] || 7)];
const H = 3600e3; const r = E.rng(seed * 1000 + nS * 10 + nP);
const SLOTS = ["UTIL", "G", "F", "C", "UTIL"]; const POS = [["C"], ["PG"], ["SF", "PF"], ["PG", "SG"], ["PF", "C"], ["SG", "SF"]];
function inst(): L.LInstance {
  const slots = SLOTS.slice(0, nS).map((s) => E.SLOT_MASK[s]);
  const pmask = Array.from({ length: nP }, () => E.posMask(POS[Math.floor(r() * POS.length)]));
  const games: L.LGame[] = [];
  for (let p = 0; p < nP; p++) {
    const nG = 2 + Math.floor(r() * 2);
    const days = [0, 1, 2, 3].sort(() => r() - 0.5).slice(0, nG).sort();
    for (const d of days) {
      const tip = d * 24 * H + [0, 1, 2.5][Math.floor(r() * 3)] * H;
      const x: number[] = [], w: number[] = [];
      for (let i = 0; i < 3; i++) { x.push(Math.round(r() * 40 - 3)); w.push(0.2 + r()); }
      const sw = w.reduce((a, b) => a + b); games.push({ p, tip, end: tip + 2.5 * H, dist: { kind: "discrete", x, w: w.map((v) => v / sw) } });
    }
  }
  games.sort((a, b) => a.tip - b.tip);
  return { slots, pmask, games, lastPlayed0: Array.from({ length: nP }, () => (r() < 0.8 ? 1 : 0)), dnp: { p1: 0.85, p0: 0.4 } };
}
const rows: number[][] = []; const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const I = inst(); const opt = bruteForce(I); const b = L.tightBound(I, 20000); const hs = expectedHindsight(I);
  rows.push([opt, b.bound, hs]);
}
const m = (k: number) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
const rel = rows.map((x) => (x[1] - x[0]) / Math.max(1e-9, x[0])).sort((a, b) => a - b);
console.log(JSON.stringify({ nS, nP, N, opt: m(0), bound: m(1), hs: m(2), gap: m(1) - m(0), relMean: rel.reduce((a, b) => a + b, 0) / N, relP50: rel[N >> 1], relP90: rel[Math.floor(0.9 * N)], hsMinusBound: m(2) - m(1), boundTighterThanHs: rows.filter((x) => x[1] < x[2]).length, ms: Date.now() - t0 }));
