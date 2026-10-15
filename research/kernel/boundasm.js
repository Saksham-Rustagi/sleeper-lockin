// asm.js port of the Lagrangian bound kernel (lib/engine/lagrange.ts tables() + evaluate() for a week-start instance,
// every player free, and minimizeBound's Adam loop), same operation order. V8 validates "use asm" modules and compiles
// them with its WebAssembly pipeline, so this measures what a wasm port of the kernel buys over the optimised TS
// without any wasm toolchain. Not bundled (esbuild would print 0.0 as 0 and break asm.js typing).
// Layout (set by research/kernel/asmbench.js): ints I[0..63] = header, doubles D[32..47] = header, then data.
"use strict";
function BoundAsm(stdlib, foreign, heap) {
  "use asm";
  var exp = stdlib.Math.exp, sqrt = stdlib.Math.sqrt, abs = stdlib.Math.abs, pow = stdlib.Math.pow, imul = stdlib.Math.imul;
  var INF = stdlib.Infinity;
  var I = new stdlib.Int32Array(heap), D = new stdlib.Float64Array(heap);
  var nS = 0, nP = 0, B = 0, nM = 0, nG = 0, W = 0;
  var oEligN = 0, oEligOff = 0, oElig = 0, oMaskOf = 0, oLp0 = 0, oGlN = 0, oGlOff = 0, oGl = 0, oGA = 0, oGE = 0, oGSlot = 0, oLSlot = 0, oStart = 0, oArgm = 0;
  var dMu = 0, dSd = 0, dFl = 0, dPp = 0, dPs = 0, dPm = 0, dMb = 0, dC = 0, dKap = 0, dThr = 0, dSlotDiff = 0, dMaskDiff = 0, dOcc = 0, dV = 0, dX = 0, dG = 0, dM1 = 0, dM2 = 0;
  var p1 = 0.0, p0 = 0.0;

  function init() {
    nS = I[0] | 0; nP = I[4 >> 2] | 0; B = I[8 >> 2] | 0; nM = I[12 >> 2] | 0; nG = I[16 >> 2] | 0; W = (B + 1) | 0;
    oEligN = I[20 >> 2] | 0; oEligOff = I[24 >> 2] | 0; oElig = I[28 >> 2] | 0; oMaskOf = I[32 >> 2] | 0; oLp0 = I[36 >> 2] | 0;
    oGlN = I[40 >> 2] | 0; oGlOff = I[44 >> 2] | 0; oGl = I[48 >> 2] | 0; oGA = I[52 >> 2] | 0; oGE = I[56 >> 2] | 0;
    oGSlot = I[60 >> 2] | 0; oLSlot = I[64 >> 2] | 0; oStart = I[68 >> 2] | 0; oArgm = I[72 >> 2] | 0;
    dMu = I[76 >> 2] | 0; dSd = I[80 >> 2] | 0; dFl = I[84 >> 2] | 0; dPp = I[88 >> 2] | 0; dPs = I[92 >> 2] | 0; dPm = I[96 >> 2] | 0;
    dMb = I[100 >> 2] | 0; dC = I[104 >> 2] | 0; dKap = I[108 >> 2] | 0; dThr = I[112 >> 2] | 0; dSlotDiff = I[116 >> 2] | 0;
    dMaskDiff = I[120 >> 2] | 0; dOcc = I[124 >> 2] | 0; dV = I[128 >> 2] | 0; dX = I[132 >> 2] | 0; dG = I[136 >> 2] | 0;
    dM1 = I[140 >> 2] | 0; dM2 = I[144 >> 2] | 0;
    p1 = +D[256 >> 3]; p0 = +D[264 >> 3];
  }
  function geti(o) { o = o | 0; return I[o << 2 >> 2] | 0; }
  function seti(o, v) { o = o | 0; v = v | 0; I[o << 2 >> 2] = v; }
  function getd(o) { o = o | 0; return +D[o << 3 >> 3]; }
  function setd(o, v) { o = o | 0; v = +v; D[o << 3 >> 3] = v; }

  function emax(mu, sd, v) {
    mu = +mu; sd = +sd; v = +v;
    var z = 0.0, e = 0.0, t = 0.0, d = 0.0, p = 0.0;
    z = (mu - v) / sd;
    e = +exp(-z * z / 2.0);
    t = 1.0 / (1.0 + 0.2316419 * +abs(z));
    d = 0.3989422804014327 * e;
    p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return +(v + (mu - v) * (z > 0.0 ? 1.0 - p : p) + sd * (e / 2.5066282746310002));
  }
  function normCdf(z) {
    z = +z;
    var t = 0.0, d = 0.0, p = 0.0;
    t = 1.0 / (1.0 + 0.2316419 * +abs(z));
    d = 0.3989422804014327 * +exp(-z * z / 2.0);
    p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return +(z > 0.0 ? 1.0 - p : p);
  }
  function eMaxDist(g, v) {
    g = g | 0; v = +v;
    var fl = 0.0;
    fl = +getd((dFl + g) | 0);
    return +emax(+getd((dMu + g) | 0), +getd((dSd + g) | 0), v > fl ? v : fl);
  }
  function pAbove(g, v) {
    g = g | 0; v = +v;
    if (v < +getd((dFl + g) | 0)) return 1.0;
    return +(1.0 - +normCdf((v - +getd((dMu + g) | 0)) / +getd((dSd + g) | 0)));
  }
  function playQ(g, lp) {
    g = g | 0; lp = lp | 0;
    var pp = 0.0;
    pp = +getd((dPp + g) | 0);
    if (pp >= 0.0) return +pp;
    return +(lp ? p1 : p0);
  }

  function tables(mu) {
    mu = mu | 0; // double offset of mu
    var s = 0, b = 0, o = 0, om = 0, m = 0, oa = 0, i = 0, ne = 0, eo = 0, os = 0, p = 0, n = 0, go = 0, k = 0, g = 0, ga = 0, ge = 0, gsl = 0, na = 0, lsl = 0, lp = 0, co = 0, ko = 0;
    var a = 0.0, x = 0.0, G = 0.0, c = 0.0, H = 0.0, L = 0.0, kappa = 0.0, c1 = 0.0, c0 = 0.0, th = 0.0, after = 0.0, q = 0.0, bench = 0.0, v = 0.0;
    for (s = 0; (s | 0) < (nS | 0); s = (s + 1) | 0) {
      o = (dPs + (imul(s, W) | 0)) | 0; om = (mu + (imul(s, B) | 0)) | 0; a = +getd(o);
      for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) { a = a + +getd((om + b) | 0); setd((o + b + 1) | 0, a); }
    }
    for (m = 0; (m | 0) < (nM | 0); m = (m + 1) | 0) {
      o = (dPm + (imul(m, W) | 0)) | 0; oa = (oArgm + (imul(m, B) | 0)) | 0;
      for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) { setd((dMb + b) | 0, INF); seti((oa + b) | 0, -1); }
      ne = geti((oEligN + m) | 0) | 0; eo = (oElig + (geti((oEligOff + m) | 0) | 0)) | 0;
      for (i = 0; (i | 0) < (ne | 0); i = (i + 1) | 0) {
        s = geti((eo + i) | 0) | 0; os = (mu + (imul(s, B) | 0)) | 0;
        for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) { x = +getd((os + b) | 0); if (x < +getd((dMb + b) | 0)) { setd((dMb + b) | 0, x); seti((oa + b) | 0, s); } }
      }
      a = +getd(o);
      for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) { a = a + ((geti((oa + b) | 0) | 0) < 0 ? INF : +getd((dMb + b) | 0)); setd((o + b + 1) | 0, a); }
    }
    for (p = 0; (p | 0) < (nP | 0); p = (p + 1) | 0) {
      n = geti((oGlN + p) | 0) | 0; m = geti((oMaskOf + p) | 0) | 0; ne = geti((oEligN + m) | 0) | 0;
      if (!n) continue; if (!ne) continue;
      eo = (oElig + (geti((oEligOff + m) | 0) | 0)) | 0; go = geti((oGlOff + p) | 0) | 0; // games of p at gl[go .. go+n), per-k arrays too
      co = (dC + (((go + p) | 0) << 1)) | 0; // C of p: (n+1)*2 entries
      for (k = (n - 1) | 0; (k | 0) >= 0; k = (k - 1) | 0) {
        g = geti((oGl + go + k) | 0) | 0; ga = geti((oGA + g) | 0) | 0; ge = geti((oGE + g) | 0) | 0;
        G = INF; gsl = -1;
        for (i = 0; (i | 0) < (ne | 0); i = (i + 1) | 0) { s = geti((eo + i) | 0) | 0; o = (dPs + (imul(s, W) | 0)) | 0; c = +getd((o + ge) | 0) - +getd((o + ga) | 0); if (c < G) { G = c; gsl = s; } }
        seti((oGSlot + go + k) | 0, gsl);
        if ((k | 0) < ((n - 1) | 0)) {
          na = geti((oGA + (geti((oGl + go + k + 1) | 0) | 0)) | 0) | 0;
          H = +getd((dPm + (imul(m, W) | 0) + na) | 0) - +getd((dPm + (imul(m, W) | 0) + ge) | 0);
          L = INF; lsl = -1;
          for (i = 0; (i | 0) < (ne | 0); i = (i + 1) | 0) { s = geti((eo + i) | 0) | 0; o = (dPs + (imul(s, W) | 0)) | 0; c = +getd((o + B) | 0) - +getd((o + na) | 0); if (c < L) { L = c; lsl = s; } }
          seti((oLSlot + go + k) | 0, lsl); kappa = H + L;
        } else kappa = +getd((dPm + (imul(m, W) | 0) + B) | 0) - +getd((dPm + (imul(m, W) | 0) + ge) | 0);
        setd((dKap + go + k) | 0, kappa);
        c1 = +getd((co + (((k + 1) | 0) << 1) + 1) | 0); c0 = +getd((co + (((k + 1) | 0) << 1)) | 0);
        th = c1 + kappa; setd((dThr + go + k) | 0, th);
        after = +eMaxDist(g, th) - kappa;
        for (lp = 0; (lp | 0) < 2; lp = (lp + 1) | 0) {
          q = +playQ(g, lp);
          bench = q * c1 + (1.0 - q) * c0;
          v = -G + q * after + (1.0 - q) * c0;
          if (v > bench) { setd((co + (k << 1) + lp) | 0, v); seti((oStart + ((go + k) << 1) + lp) | 0, 1); }
          else { setd((co + (k << 1) + lp) | 0, bench); seti((oStart + ((go + k) << 1) + lp) | 0, 0); }
        }
      }
    }
  }
  function addSlot(s, a, e, w) { s = s | 0; a = a | 0; e = e | 0; w = +w; var o = 0; o = (dSlotDiff + (imul(s, W) | 0)) | 0; setd((o + a) | 0, +getd((o + a) | 0) + w); setd((o + e) | 0, +getd((o + e) | 0) - w); }
  function addMask(m, a, e, w) { m = m | 0; a = a | 0; e = e | 0; w = +w; var o = 0; o = (dMaskDiff + (imul(m, W) | 0)) | 0; setd((o + a) | 0, +getd((o + a) | 0) + w); setd((o + e) | 0, +getd((o + e) | 0) - w); }

  function evaluate(mu) {
    mu = mu | 0;
    var i = 0, p = 0, m = 0, n = 0, go = 0, co = 0, lp = 0, k = 0, g = 0, l2 = 0, nx = 0, s = 0, b = 0, o = 0;
    var r0 = 0.0, r1 = 0.0, n0 = 0.0, n1 = 0.0, mass = 0.0, q = 0.0, keep = 0.0, a = 0.0, sumMu = 0.0, paid = 0.0, sumV = 0.0, x = 0.0;
    tables(mu);
    for (i = 0; (i | 0) < (imul(nS, W) | 0); i = (i + 1) | 0) setd((dSlotDiff + i) | 0, 0.0);
    for (i = 0; (i | 0) < (imul(nM, W) | 0); i = (i + 1) | 0) setd((dMaskDiff + i) | 0, 0.0);
    for (p = 0; (p | 0) < (nP | 0); p = (p + 1) | 0) setd((dV + p) | 0, 0.0);
    for (p = 0; (p | 0) < (nP | 0); p = (p + 1) | 0) {
      n = geti((oGlN + p) | 0) | 0; m = geti((oMaskOf + p) | 0) | 0;
      if (!(geti((oEligN + m) | 0) | 0)) continue;
      go = geti((oGlOff + p) | 0) | 0; co = (dC + (((go + p) | 0) << 1)) | 0;
      lp = geti((oLp0 + p) | 0) | 0; r0 = 0.0; r1 = 0.0;
      setd((dV + p) | 0, +getd((co + (lp ? 1 : 0)) | 0)); if (lp) r1 = 1.0; else r0 = 1.0;
      for (k = 0; (k | 0) < (n | 0); k = (k + 1) | 0) {
        g = geti((oGl + go + k) | 0) | 0; n0 = 0.0; n1 = 0.0;
        for (l2 = 0; (l2 | 0) < 2; l2 = (l2 + 1) | 0) {
          mass = l2 ? r1 : r0; if (mass <= 0.0) continue;
          q = +playQ(g, l2);
          if (!(geti((oStart + ((go + k) << 1) + l2) | 0) | 0)) { n1 = n1 + mass * q; n0 = n0 + mass * (1.0 - q); continue; }
          addSlot(geti((oGSlot + go + k) | 0) | 0, geti((oGA + g) | 0) | 0, geti((oGE + g) | 0) | 0, mass);
          keep = mass * q * +pAbove(g, +getd((dThr + go + k) | 0));
          if (keep > 0.0) {
            if ((k | 0) < ((n - 1) | 0)) {
              nx = geti((oGl + go + k + 1) | 0) | 0;
              addMask(m, geti((oGE + g) | 0) | 0, geti((oGA + nx) | 0) | 0, keep);
              addSlot(geti((oLSlot + go + k) | 0) | 0, geti((oGA + nx) | 0) | 0, B, keep);
            } else addMask(m, geti((oGE + g) | 0) | 0, B, keep);
          }
          n1 = n1 + (mass * q - keep); n0 = n0 + mass * (1.0 - q);
        }
        r0 = n0; r1 = n1;
      }
    }
    for (s = 0; (s | 0) < (nS | 0); s = (s + 1) | 0) { a = 0.0; for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) { a = a + +getd((dSlotDiff + (imul(s, W) | 0) + b) | 0); setd((dOcc + (imul(s, B) | 0) + b) | 0, a); } }
    for (m = 0; (m | 0) < (nM | 0); m = (m + 1) | 0) {
      a = 0.0;
      for (b = 0; (b | 0) < (B | 0); b = (b + 1) | 0) {
        a = a + +getd((dMaskDiff + (imul(m, W) | 0) + b) | 0);
        if (a > 1e-15) { o = (dOcc + (imul(geti((oArgm + (imul(m, B) | 0) + b) | 0) | 0, B) | 0) + b) | 0; setd(o, +getd(o) + a); }
      }
    }
    for (i = 0; (i | 0) < (imul(nS, B) | 0); i = (i + 1) | 0) { x = +getd((mu + i) | 0); sumMu = sumMu + x; paid = paid + x * +getd((dOcc + i) | 0); }
    for (p = 0; (p | 0) < (nP | 0); p = (p + 1) | 0) sumV = sumV + +getd((dV + p) | 0);
    return +(sumV + sumMu + 0.0);
  }

  // minimizeBound(adam): returns the best bound after `iters` iterations from mu = 0 (mu in dX)
  function run(iters, lr0) {
    iters = iters | 0; lr0 = +lr0;
    var it = 0, i = 0, n = 0;
    var bound = 0.0, best = 0.0, gn = 0.0, gi = 0.0, lr = 0.0, c1 = 0.0, c2 = 0.0, a1 = 0.0, a2 = 0.0, v = 0.0;
    n = imul(nS, B) | 0;
    bound = +evaluate(dX); best = bound;
    for (it = 0; (it | 0) < (iters | 0); it = (it + 1) | 0) {
      gn = 0.0;
      for (i = 0; (i | 0) < (n | 0); i = (i + 1) | 0) {
        gi = 1.0 - +getd((dOcc + i) | 0); if (+getd((dX + i) | 0) <= 0.0) { if (gi > 0.0) gi = 0.0; }
        setd((dG + i) | 0, gi); gn = gn + gi * gi;
      }
      if (gn < 1e-18) break;
      lr = lr0 / +sqrt(1.0 + +(it | 0) / 100.0);
      c1 = 1.0 - +pow(0.9, +((it + 1) | 0)); c2 = 1.0 - +pow(0.999, +((it + 1) | 0));
      for (i = 0; (i | 0) < (n | 0); i = (i + 1) | 0) {
        gi = +getd((dG + i) | 0);
        a1 = 0.9 * +getd((dM1 + i) | 0) + (1.0 - 0.9) * gi; a2 = 0.999 * +getd((dM2 + i) | 0) + (1.0 - 0.999) * gi * gi;
        setd((dM1 + i) | 0, a1); setd((dM2 + i) | 0, a2);
        v = +getd((dX + i) | 0) - lr * (a1 / c1) / (+sqrt(a2 / c2) + 1e-8); setd((dX + i) | 0, v > 0.0 ? v : 0.0);
      }
      bound = +evaluate(dX);
      if (bound < best - 1e-9) best = bound;
    }
    I[152 >> 2] = it;
    return +best;
  }
  return { init: init, run: run, evaluate: evaluate };
}
module.exports = { BoundAsm };
