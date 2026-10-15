// Run the asm.js (V8 -> WebAssembly) bound kernel on an instance exported by `perfbench export`.
// usage: node --allow-natives-syntax research/kernel/asmbench.js <instance.txt> <iters> [lr=0.3]
// Prints the best bound (full precision), µs per evaluation, and whether V8 compiled the module as asm.js/wasm.
"use strict";
const fs = require("fs");
// Inline the heap accessors (wasm does not inline small asm.js functions): getd(x) -> D[(x) << 3 >> 3], etc.
// INLINE=0 keeps the calls (to measure both).
function inline(src) {
  const defs = /function (getd|geti|setd|seti)\([^)]*\) \{[^}]*\}\n?/g; src = src.replace(defs, "");
  const rep = { getd: (a) => `D[(${a[0]}) << 3 >> 3]`, geti: (a) => `I[(${a[0]}) << 2 >> 2]`, setd: (a) => `D[(${a[0]}) << 3 >> 3] = ${a[1]}`, seti: (a) => `I[(${a[0]}) << 2 >> 2] = ${a[1]}` };
  for (;;) {
    const m = /\b(getd|geti|setd|seti)\(/.exec(src); if (!m) return src;
    let i = m.index + m[0].length, depth = 1; const args = [""];
    for (; depth > 0; i++) { const c = src[i]; if (c === "(") depth++; else if (c === ")") { depth--; if (!depth) break; } if (c === "," && depth === 1) args.push(""); else args[args.length - 1] += c; }
    let out = rep[m[1]](args.map((x) => x.trim()));
    if (m[1] === "getd" || m[1] === "geti") out = `(${out})`;
    src = src.slice(0, m.index) + out + src.slice(i + 1);
  }
}
const raw = fs.readFileSync(require("path").join(__dirname, "boundasm.js"), "utf8").replace(/^module\.exports.*$/m, "").replace(/^"use strict";/m, "");
const BoundAsm = new Function(`${process.env.INLINE === "0" ? raw : inline(raw)}\nreturn BoundAsm;`)();
const [file, itersArg, lrArg] = process.argv.slice(2);
const iters = Number(itersArg), lr = Number(lrArg || 0.3);
const tok = fs.readFileSync(file, "utf8").trim().split(/\s+/).map(Number); let ti = 0; const nx = () => tok[ti++];
const nS = nx(), nP = nx(), B = nx(), nM = nx(); const W = B + 1;
const elig = []; for (let m = 0; m < nM; m++) { const n = nx(); const e = []; for (let i = 0; i < n; i++) e.push(nx()); elig.push(e); }
const maskOf = Array.from({ length: nP }, nx), lp0 = Array.from({ length: nP }, nx);
const p1 = nx(), p0 = nx(), nG = nx();
const games = Array.from({ length: nG }, () => ({ p: nx(), a: nx(), e: nx(), mu: nx(), sd: nx(), fl: nx(), pp: nx() }));
const gl = Array.from({ length: nP }, () => { const n = nx(); return Array.from({ length: n }, nx); });

// layout: ints after the 64-int header, doubles after the 16-double header at D[32..47]
const HEAP = new ArrayBuffer(1 << 22); const I = new Int32Array(HEAP), D = new Float64Array(HEAP);
let io = 96; /* bytes 0..255 int header, 256..383 double header */ const ialloc = (n) => { const o = io; io += n; return o; };
const oEligN = ialloc(nM), oEligOff = ialloc(nM), oElig = ialloc(elig.reduce((s, e) => s + e.length, 0)), oMaskOf = ialloc(nP), oLp0 = ialloc(nP);
const oGlN = ialloc(nP), oGlOff = ialloc(nP), oGl = ialloc(nG), oGA = ialloc(nG), oGE = ialloc(nG), oGSlot = ialloc(nG), oLSlot = ialloc(nG), oStart = ialloc(2 * nG), oArgm = ialloc(nM * B);
let dd = Math.ceil((io * 4) / 8) + 48; const dalloc = (n) => { const o = dd; dd += n; return o; };
const dMu = dalloc(nG), dSd = dalloc(nG), dFl = dalloc(nG), dPp = dalloc(nG), dPs = dalloc(nS * W), dPm = dalloc(nM * W), dMb = dalloc(B);
const dC = dalloc(2 * (nG + nP)), dKap = dalloc(nG), dThr = dalloc(nG), dSlotDiff = dalloc(nS * W), dMaskDiff = dalloc(nM * W), dOcc = dalloc(nS * B), dV = dalloc(nP);
const dX = dalloc(nS * B), dG = dalloc(nS * B), dM1 = dalloc(nS * B), dM2 = dalloc(nS * B);
if (dd * 8 > HEAP.byteLength) throw new Error("heap too small");
let off = 0; elig.forEach((e, m) => { I[oEligN + m] = e.length; I[oEligOff + m] = off; e.forEach((s, i) => (I[oElig + off + i] = s)); off += e.length; });
maskOf.forEach((x, p) => (I[oMaskOf + p] = x)); lp0.forEach((x, p) => (I[oLp0 + p] = x));
off = 0; gl.forEach((l, p) => { I[oGlN + p] = l.length; I[oGlOff + p] = off; l.forEach((g, k) => { I[oGl + off + k] = g; I[oLSlot + off + k] = -1; }); off += l.length; });
games.forEach((g, i) => { I[oGA + i] = g.a; I[oGE + i] = g.e; D[dMu + i] = g.mu; D[dSd + i] = g.sd; D[dFl + i] = g.fl; D[dPp + i] = g.pp; });
[nS, nP, B, nM, nG, oEligN, oEligOff, oElig, oMaskOf, oLp0, oGlN, oGlOff, oGl, oGA, oGE, oGSlot, oLSlot, oStart, oArgm,
  dMu, dSd, dFl, dPp, dPs, dPm, dMb, dC, dKap, dThr, dSlotDiff, dMaskDiff, dOcc, dV, dX, dG, dM1, dM2].forEach((x, i) => (I[i] = x));
D[32] = p1; D[33] = p0;

let isAsm = "unknown";
try { isAsm = new Function("f", "return %IsAsmWasmCode(f)")(BoundAsm); } catch { /* needs --allow-natives-syntax */ }
const mod = BoundAsm(globalThis, {}, HEAP);
try { if (isAsm !== "unknown") isAsm = new Function("f", "return %IsAsmWasmCode(f)")(BoundAsm); } catch { /* */ }
mod.init();
const t0 = performance.now(); const bound = mod.run(iters, lr); const ms = performance.now() - t0; const it = I[38];
console.log(JSON.stringify({ engine: "asm.js->wasm", validatedAsWasm: isAsm, iters: it, bound, usPerEval: (ms * 1000) / (it + 1), ms }));
