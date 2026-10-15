// Task C timings, run sequentially on an otherwise idle machine (one process at a time): baseline engine (commit 99f1a40,
// bundles *_base.cjs) vs the optimised one (*_new.cjs), and the solver kernel in TS vs asm.js->wasm.
// usage: node research/perftimes.mjs <out.json>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const out = process.argv[2] || "research/out/perftimes.json";
const run = (args, env = {}) => JSON.parse(execFileSync(process.execPath, args, { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n").pop());
const rows = [];
const rec = (r) => { rows.push(r); fs.writeFileSync(out, JSON.stringify(rows, null, 1)); console.log(JSON.stringify(r)); };
// 1. solver kernel: µs per bound evaluation (best of 3)
for (const tw of ["5_1", "9_3", "14_4", "20_5"]) {
  const inst = `research/kernel/inst_${tw}.txt`; const wr = tw.replace("_", ":");
  const best = (f) => { let b = null; for (let i = 0; i < 3; i++) { const r = f(); if (!b || r.usPerEval < b.usPerEval) b = r; } return b; };
  const base = best(() => run(["research/dist/perfbench_base.cjs", "adam", wr, "20000"]));
  const ts = best(() => run(["research/dist/perfbench_new.cjs", "adam", wr, "20000"]));
  const wasm = best(() => run(["--allow-natives-syntax", "research/kernel/asmbench.js", inst, "20000"]));
  const wasmCalls = best(() => run(["--allow-natives-syntax", "research/kernel/asmbench.js", inst, "20000"], { INLINE: "0" }));
  rec({ kind: "kernel", tw, base: base.usPerEval, ts: ts.usPerEval, wasm: wasm.usPerEval, wasmCalls: wasmCalls.usPerEval, validated: wasm.validatedAsWasm,
    identical: base.bound === ts.bound && ts.bound === wasm.bound && wasm.bound === wasmCalls.bound, bound: ts.bound });
}
// 2. policies on one team-week (perfprof: week rid policy nsc days real)
const cfgs = [
  ["P7H_LheldTie real week", ["5", "1", "P7H_LheldTie", "0", "0", "1"], "msReal"],
  ["P7H_LheldTie real week", ["14", "4", "P7H_LheldTie", "0", "0", "1"], "msReal"],
  ["P2LAH_LheldTie model week (x200)", ["5", "1", "P2LAH_LheldTie", "200", "0", "0"], "msWeek"],
  ["P8 real week (incl. week-start price solve)", ["5", "1", "P8", "0", "0", "1"], "msReal"],
  ["P8 model week (x20, after the price solve)", ["5", "1", "P8", "20", "0", "1"], "msWeek"],
  ["P8f model week (x300, after the price solve)", ["5", "1", "P8f", "300", "0", "1"], "msWeek"],
  ["P10 real, first day", ["5", "1", "P10", "0", "1", "1"], "msReal"],
  ["P10b real, first day", ["5", "1", "P10b", "0", "1", "1"], "msReal"],
];
for (const [name, args, key] of cfgs) {
  const b = run(["research/dist/perfprof_base.cjs", ...args]); const n = run(["research/dist/perfprof_new.cjs", ...args]);
  rec({ kind: "policy", name, tw: `${args[0]}:${args[1]}`, base: b[key], new: n[key], speedup: b[key] / n[key],
    identical: b.real === n.real && b.scHash === n.scHash });
}
