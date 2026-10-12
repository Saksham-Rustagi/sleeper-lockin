// Predictive check of the per-game score model on held-out weeks (walk-forward): RMSE and Normal log-likelihood.
import { S, fitModel, projPre, muOf, sdOf } from "./btcommon";
let n = 0, se = 0, ll = 0;
for (let w = 3; w <= 23; w++) {
  const m = fitModel(w);
  for (const g of S.games[String(w)] as any[]) { if (!g.played) continue; const pr = projPre({ ...g, week: w }); const mu = muOf(m, g.pid, g.tip, pr), sd = sdOf(m, g.pid, g.tip, mu);
    n++; se += (g.actual - mu) ** 2; ll += -Math.log(sd) - 0.5 * ((g.actual - mu) / sd) ** 2; }
}
console.log(`FORM=${process.env.FORM ? 1 : 0} VOL=${process.env.VOL ? 1 : 0}: games ${n}, RMSE ${Math.sqrt(se / n).toFixed(3)}, mean log-lik ${(ll / n).toFixed(4)}  f=${fitModel(23).f.toFixed(3)}`);
