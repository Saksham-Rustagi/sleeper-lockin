// Tightness of the Lagrangian bound on tiny random weeks where the exact optimum is brute-forced.
// usage: npx tsx research/lagtiny.ts [trials]
import * as E from "./engine";
import * as L from "../lib/engine/lagrange";
import { bruteForce, randInst, expectedHindsight } from "./bruteforce";
const N = Number(process.argv[2] || 300); const r = E.rng(2024);
const rows: { opt: number; bound: number; hs: number; free: number; nS: number; nP: number }[] = [];
for (let i = 0; i < N; i++) {
  const inst = randInst(r); const opt = bruteForce(inst); const b = L.tightBound(inst, 20000);
  rows.push({ opt, bound: b.bound, hs: expectedHindsight(inst), free: b.free, nS: inst.slots.length, nP: inst.pmask.length });
}
const m = (f: (x: typeof rows[0]) => number) => rows.reduce((s, x) => s + f(x), 0) / rows.length;
const rel = rows.map((x) => (x.bound - x.opt) / Math.max(1e-9, x.opt)).sort((a, b) => a - b);
console.log(`${N} tiny weeks (1-2 slots, 2-3 players, 2-3 games each, discrete scores, DNP chain)`);
console.log(`E[optimum] ${m((x) => x.opt).toFixed(3)}  bound ${m((x) => x.bound).toFixed(3)}  no-slot-limit ${m((x) => x.free).toFixed(3)}  E[hindsight] ${m((x) => x.hs).toFixed(3)}`);
console.log(`bound - optimum: mean ${m((x) => x.bound - x.opt).toFixed(3)} pts; relative median ${(100 * rel[N >> 1]).toFixed(2)}%  p90 ${(100 * rel[Math.floor(0.9 * N)]).toFixed(2)}%  max ${(100 * rel[N - 1]).toFixed(2)}%`);
console.log(`exact (gap < 0.01): ${rows.filter((x) => x.bound - x.opt < 0.01).length}/${N}; bound < optimum: ${rows.filter((x) => x.bound < x.opt - 1e-6).length}; bound > E[hindsight]: ${rows.filter((x) => x.bound > x.hs + 1e-6).length}`);
