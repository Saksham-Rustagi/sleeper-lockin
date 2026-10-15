// Native kernel benchmark (task C, part 2): lib/engine/lagrange.ts tables() + evaluate() for a week-start instance
// (every player free) and minimizeBound's Adam loop, ported line by line (same operation order, plain IEEE doubles,
// no -ffast-math). Rust would compile this to the same LLVM IR modulo bounds checks, so its speed is the estimate for a
// Rust (napi) port; a wasm build of the same code is timed separately if a wasm toolchain is available.
// usage: bound <instance.txt from `perfbench export`> <iters> [lr=0.3]
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static int nS, nP, B, nM, nG, W;
static int *eligN, **elig, *maskOf, *lp0, *gP, *gA, *gE, *glN, **gl;
static double p1, p0, *gMu, *gSd, *gFl, *gPp;
// workspaces
static double *Ps, *Pm, *mb, **C, **kap, **thr, *slotDiff, *maskDiff, *occ, *V;
static int *argm, **gSlot, **lSlot; static unsigned char **startA;
static double paid;

static double emax(double mu, double sd, double v) { // core.ts emax (one exp)
  double z = (mu - v) / sd, e = exp(-z * z / 2), t = 1 / (1 + 0.2316419 * fabs(z)), d = 0.3989422804014327 * e;
  double p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return v + (mu - v) * (z > 0 ? 1 - p : p) + sd * (e / 2.5066282746310002);
}
static double normCdf(double z) {
  double t = 1 / (1 + 0.2316419 * fabs(z)), d = 0.3989422804014327 * exp(-z * z / 2);
  double p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
static double eMaxDist(int g, double v) { return emax(gMu[g], gSd[g], v > gFl[g] ? v : gFl[g]); }
static double pAbove(int g, double v) { return v < gFl[g] ? 1 : 1 - normCdf((v - gMu[g]) / gSd[g]); }

static void tables(const double *mu) {
  for (int s = 0; s < nS; s++) { int o = s * W, om = s * B; double a = Ps[o]; for (int b = 0; b < B; b++) { a = a + mu[om + b]; Ps[o + b + 1] = a; } }
  for (int m = 0; m < nM; m++) {
    int o = m * W, oa = m * B;
    for (int b = 0; b < B; b++) { mb[b] = INFINITY; argm[oa + b] = -1; }
    for (int i = 0; i < eligN[m]; i++) { int s = elig[m][i], os = s * B; for (int b = 0; b < B; b++) { double x = mu[os + b]; if (x < mb[b]) { mb[b] = x; argm[oa + b] = s; } } }
    double a = Pm[o];
    for (int b = 0; b < B; b++) { a = a + (argm[oa + b] < 0 ? INFINITY : mb[b]); Pm[o + b + 1] = a; }
  }
  for (int p = 0; p < nP; p++) {
    int n = glN[p], m = maskOf[p], ne = eligN[m]; int *l = gl[p], *el = elig[m];
    if (!n || !ne) continue;
    double *Cp = C[p], *kp = kap[p], *th = thr[p]; int *gs = gSlot[p], *ls = lSlot[p]; unsigned char *st = startA[p];
    for (int k = n - 1; k >= 0; k--) {
      int g = l[k], ga = gA[g], ge = gE[g];
      double G = INFINITY; int gsl = -1;
      for (int i = 0; i < ne; i++) { int o = el[i] * W; double c = Ps[o + ge] - Ps[o + ga]; if (c < G) { G = c; gsl = el[i]; } }
      gs[k] = gsl;
      double kappa;
      if (k < n - 1) {
        int na = gA[l[k + 1]]; double H = Pm[m * W + na] - Pm[m * W + ge], L = INFINITY; int lsl = -1;
        for (int i = 0; i < ne; i++) { int o = el[i] * W; double c = Ps[o + B] - Ps[o + na]; if (c < L) { L = c; lsl = el[i]; } }
        ls[k] = lsl; kappa = H + L;
      } else kappa = Pm[m * W + B] - Pm[m * W + ge];
      kp[k] = kappa;
      double c1 = Cp[(k + 1) * 2 + 1], c0 = Cp[(k + 1) * 2];
      th[k] = c1 + kappa;
      double afterPlay = eMaxDist(g, th[k]) - kappa;
      for (int lp = 0; lp < 2; lp++) {
        double q = gPp[g] >= 0 ? gPp[g] : (lp ? p1 : p0);
        double bench = q * c1 + (1 - q) * c0, v = -G + q * afterPlay + (1 - q) * c0;
        if (v > bench) { Cp[k * 2 + lp] = v; st[k * 2 + lp] = 1; } else { Cp[k * 2 + lp] = bench; st[k * 2 + lp] = 0; }
      }
    }
  }
}
#define ADDSLOT(s, a, e, w) { slotDiff[(s) * W + (a)] += (w); slotDiff[(s) * W + (e)] -= (w); }
#define ADDMASK(m, a, e, w) { maskDiff[(m) * W + (a)] += (w); maskDiff[(m) * W + (e)] -= (w); }
static double evaluate(const double *mu) { // returns the bound; occ filled
  tables(mu);
  for (int i = 0; i < nS * W; i++) slotDiff[i] = 0;
  for (int i = 0; i < nM * W; i++) maskDiff[i] = 0;
  for (int p = 0; p < nP; p++) V[p] = 0;
  for (int p = 0; p < nP; p++) {
    int n = glN[p], m = maskOf[p]; int *l = gl[p]; if (!eligN[m]) continue;
    double *Cc = C[p], *th = thr[p]; unsigned char *st = startA[p]; int *gs = gSlot[p], *ls = lSlot[p];
    double r0 = 0, r1 = 0; int lp = lp0[p];
    V[p] = Cc[lp ? 1 : 0]; if (lp) r1 = 1; else r0 = 1;
    for (int k = 0; k < n; k++) {
      int g = l[k]; double n0 = 0, n1 = 0;
      for (int l2 = 0; l2 < 2; l2++) {
        double mass = l2 ? r1 : r0; if (mass <= 0) continue;
        double q = gPp[g] >= 0 ? gPp[g] : (l2 ? p1 : p0);
        if (!st[k * 2 + l2]) { n1 += mass * q; n0 += mass * (1 - q); continue; }
        ADDSLOT(gs[k], gA[g], gE[g], mass);
        double keep = mass * q * pAbove(g, th[k]);
        if (keep > 0) {
          if (k < n - 1) { int nx = l[k + 1]; ADDMASK(m, gE[g], gA[nx], keep); ADDSLOT(ls[k], gA[nx], B, keep); }
          else ADDMASK(m, gE[g], B, keep);
        }
        n1 += mass * q - keep; n0 += mass * (1 - q);
      }
      r0 = n0; r1 = n1;
    }
  }
  for (int s = 0; s < nS; s++) { double a = 0; for (int b = 0; b < B; b++) { a += slotDiff[s * W + b]; occ[s * B + b] = a; } }
  for (int m = 0; m < nM; m++) { double a = 0; for (int b = 0; b < B; b++) { a += maskDiff[m * W + b]; if (a > 1e-15) occ[argm[m * B + b] * B + b] += a; } }
  double sumMu = 0, sumV = 0;
  for (int i = 0; i < nS * B; i++) { sumMu += mu[i]; paid += mu[i] * occ[i]; } // (paid: the TS evaluate's reward)
  for (int p = 0; p < nP; p++) sumV += V[p];
  return sumV + sumMu;
}

static FILE *F; static double rd(void) { double x; if (fscanf(F, "%lf", &x) != 1) { fprintf(stderr, "bad input\n"); exit(1); } return x; }
static int ri(void) { return (int)rd(); }
static void *A(size_t n) { void *x = calloc(n ? n : 1, 1); if (!x) exit(2); return x; }

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: bound <instance.txt> <iters> [lr]\n"); return 1; }
  F = fopen(argv[1], "r"); if (!F) return 1;
  int iters = atoi(argv[2]); double lr0 = argc > 3 ? atof(argv[3]) : 0.3;
  nS = ri(); nP = ri(); B = ri(); nM = ri(); W = B + 1;
  eligN = A(nM * sizeof(int)); elig = A(nM * sizeof(int *));
  for (int m = 0; m < nM; m++) { eligN[m] = ri(); elig[m] = A(eligN[m] * sizeof(int)); for (int i = 0; i < eligN[m]; i++) elig[m][i] = ri(); }
  maskOf = A(nP * sizeof(int)); lp0 = A(nP * sizeof(int));
  for (int p = 0; p < nP; p++) maskOf[p] = ri();
  for (int p = 0; p < nP; p++) lp0[p] = ri();
  p1 = rd(); p0 = rd(); nG = ri();
  gP = A(nG * sizeof(int)); gA = A(nG * sizeof(int)); gE = A(nG * sizeof(int));
  gMu = A(nG * sizeof(double)); gSd = A(nG * sizeof(double)); gFl = A(nG * sizeof(double)); gPp = A(nG * sizeof(double));
  for (int g = 0; g < nG; g++) { gP[g] = ri(); gA[g] = ri(); gE[g] = ri(); gMu[g] = rd(); gSd[g] = rd(); gFl[g] = rd(); gPp[g] = rd(); }
  glN = A(nP * sizeof(int)); gl = A(nP * sizeof(int *));
  for (int p = 0; p < nP; p++) { glN[p] = ri(); gl[p] = A(glN[p] * sizeof(int)); for (int k = 0; k < glN[p]; k++) gl[p][k] = ri(); }
  Ps = A(nS * W * sizeof(double)); Pm = A(nM * W * sizeof(double)); mb = A(B * sizeof(double)); argm = A(nM * B * sizeof(int));
  C = A(nP * sizeof(double *)); kap = A(nP * sizeof(double *)); thr = A(nP * sizeof(double *));
  gSlot = A(nP * sizeof(int *)); lSlot = A(nP * sizeof(int *)); startA = A(nP * sizeof(unsigned char *));
  for (int p = 0; p < nP; p++) {
    int n = glN[p]; C[p] = A((n + 1) * 2 * sizeof(double)); kap[p] = A(n * sizeof(double)); thr[p] = A(n * sizeof(double));
    gSlot[p] = A(n * sizeof(int)); lSlot[p] = A(n * sizeof(int)); for (int k = 0; k < n; k++) lSlot[p][k] = -1; startA[p] = A(n * 2);
  }
  slotDiff = A(nS * W * sizeof(double)); maskDiff = A(nM * W * sizeof(double)); occ = A(nS * B * sizeof(double)); V = A(nP * sizeof(double));
  int n = nS * B;
  double *mu = A(n * sizeof(double)), *g = A(n * sizeof(double)), *m1 = A(n * sizeof(double)), *m2 = A(n * sizeof(double)), *bestMu = A(n * sizeof(double));
  struct timespec t0, t1; clock_gettime(CLOCK_MONOTONIC, &t0);
  double bound = evaluate(mu), best = bound; int it = 0;
  for (; it < iters; it++) {
    double gn = 0;
    for (int i = 0; i < n; i++) { double gi = 1 - occ[i]; if (mu[i] <= 0 && gi > 0) gi = 0; g[i] = gi; gn += gi * gi; }
    if (gn < 1e-18) break;
    double lr = lr0 / sqrt(1 + it / 100.0), b1 = 0.9, b2 = 0.999, c1 = 1 - pow(b1, it + 1), c2 = 1 - pow(b2, it + 1);
    for (int i = 0; i < n; i++) {
      double gi = g[i], a1 = b1 * m1[i] + (1 - b1) * gi, a2 = b2 * m2[i] + (1 - b2) * gi * gi; m1[i] = a1; m2[i] = a2;
      double v = mu[i] - lr * (a1 / c1) / (sqrt(a2 / c2) + 1e-8); mu[i] = v > 0 ? v : 0;
    }
    bound = evaluate(mu);
    if (bound < best - 1e-9) { best = bound; for (int i = 0; i < n; i++) bestMu[i] = mu[i]; }
  }
  clock_gettime(CLOCK_MONOTONIC, &t1);
  double ms = (t1.tv_sec - t0.tv_sec) * 1e3 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
  printf("{\"iters\":%d,\"bound\":%.17g,\"usPerEval\":%.4f,\"ms\":%.1f}\n", it, best, ms * 1000 / (it + 1), ms);
  return 0;
}
