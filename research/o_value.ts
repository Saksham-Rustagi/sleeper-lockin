// Task O (c): real-points value of the opportunity alerts with the task-W waiver backtest (research/WAIVERS_W.md), and
// the score jobs for the minutes-override calibration of the Waivers page.
//   build <alerts.json> <prefix>      decisions: at each week start with a free-agent alert, every team of our league adds
//                                     the top alert (highest estimate) and drops the Waivers page's cheapest unprotected
//                                     player (task-W decide rows, method policy: lowest simulated loss); writes
//                                     research/out/o/<prefix>_dec.json + score jobs for H2 (weeks w, w+1 while kept)
//   moves <decPrefix> <prefix>        score jobs for a task-W decide run (research/out/w/<decPrefix>_d_*): H2 roster-weeks
//                                     of the picks (P8 + hindsight) and of every evaluated move (18 per team-week;
//                                     hindsight / POLICY only), for the calibration
// Jobs skip roster-weeks already scored by task W (research/out/w/w25_s*, w25_h*) or by an earlier round here.
// The jobs run with research/dist/waivers_bt.cjs score (P8, and EVAL=hp: hindsight + POLICY) via research/o_run.mjs.
import fs from "fs";
import * as W from "./wcommon";

const [mode, a1, prefix] = process.argv.slice(2);
const OUTW = "research/out/w", OUTO = "research/out/o";
const roster = (w: number, rid: string): string[] | undefined => W.S.weeks.find((x: any) => x.week === w)?.teams[rid]?.players;
const key = (w: number, rid: string, pids: string[]) => `${w}|${rid}|${[...pids].sort().join(",")}`;
const known = (re: RegExp, dir: string) => { const s = new Set<string>(); for (const f of fs.readdirSync(dir)) if (re.test(f)) for (const k of Object.keys(JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")).res)) s.add(k); return s; };
const decRows = (pref: string) => fs.readdirSync(OUTW).filter((f) => f.startsWith(pref + "_d_") && f.endsWith(".json")).flatMap((f) => JSON.parse(fs.readFileSync(`${OUTW}/${f}`, "utf8")));

// H2 roster-weeks of a move (task W's "kept" rule: stop once the real roster has the add or lacks the drop)
function h2Keys(w: number, rid: string, add: string, drop: string | null): { w: number; rid: string; pids: string[]; k: string }[] {
  const out = [];
  for (let x = w; x <= Math.min(w + 1, W.LAST_WEEK); x++) {
    const r = roster(x, rid); if (!r || r.includes(add) || (drop && !r.includes(drop))) break;
    const e = r.filter((p) => p !== drop).concat([add]);
    out.push({ w: x, rid, pids: e, k: key(x, rid, e) }, { w: x, rid, pids: r, k: key(x, rid, r) });
  }
  return out;
}
function writeJobs(jobs: Map<string, any>, pref: string, hpJobs: Map<string, any> = jobs) {
  const p8 = new Set([...known(/^w25_s\d+_\d+\.json$/, OUTW), ...known(new RegExp(`^${pref}_s\\d+_\\d+\\.json$`), OUTO)]);
  const hp = new Set([...known(/^w25_h_\d+\.json$/, OUTW), ...known(new RegExp(`^${pref}_h\\d+_\\d+\\.json$`), OUTO)]);
  let round = 0; while (fs.existsSync(`${OUTO}/${pref}_sj${round}_0.json`) || fs.existsSync(`${OUTO}/${pref}_hj${round}_0.json`)) round++;
  const sorted = (m: Map<string, any>) => [...m.values()].sort((x, y) => (x.k < y.k ? -1 : 1));
  const all = sorted(jobs), allH = sorted(hpJobs);
  const need8 = all.filter((j) => !p8.has(j.k)), needH = allH.filter((j) => !hp.has(j.k));
  const runs: any[] = [];
  const chunk = (list: any[], tag: string, n: number, env?: any) => {
    const nCh = Math.max(1, Math.ceil(list.length / n)); if (!list.length) return;
    for (let i = 0; i < nCh; i++) {
      const jf = `${OUTO}/${pref}_${tag}j${round}_${i}.json`; fs.writeFileSync(jf, JSON.stringify(list.filter((_, j) => j % nCh === i)));
      runs.push({ bundle: "research/dist/waivers_bt.cjs", args: ["score", jf, `${OUTO}/${pref}_${tag}${round}_${i}.json`], env: { SEASON: "research/data/season.json", WALL: "research/data/w/all2025.json", ...env } });
    }
  };
  chunk(need8, "s", 30); chunk(needH, "h", 4000, { EVAL: "hp" });
  fs.writeFileSync(`${OUTO}/${pref}_runs${round}.json`, JSON.stringify(runs));
  console.log(`${all.length} (P8) / ${allH.length} (hindsight) roster-weeks; to score: P8 ${need8.length}, hindsight/POLICY ${needH.length} -> ${OUTO}/${pref}_runs${round}.json`);
}

if (mode === "build") {
  const AL = JSON.parse(fs.readFileSync(a1, "utf8"));
  const dec = new Map<string, any>(decRows("w25").map((r: any) => [`${r.week}|${r.rid}`, r]));
  const out: any[] = []; const jobs = new Map<string, any>();
  for (const wk of AL.weeks) {
    const top = wk.alerts[0]; if (!top) continue;
    for (const rid of Object.keys(W.S.weeks.find((x: any) => x.week === wk.week).teams)) {
      const d = dec.get(`${wk.week}|${rid}`); if (!d) continue;
      // the page's cheapest unprotected drop (lowest simulated loss = highest dropGain)
      const cands = (d.methods.policy.dropGains as [string, number, number][]).filter(([p]) => !W.isProtected(p, wk.week)).sort((x, y) => y[1] - x[1]);
      const drop = d.openSpots > 0 ? null : cands[0]?.[0] ?? null; if (d.openSpots === 0 && !drop) continue;
      out.push({ week: wk.week, rid, add: top.pid, drop, est: top.est, source: top.source, absent: top.absent ?? null, page: d.methods.policy.pick ? { add: d.methods.policy.pick.add, drop: d.methods.policy.pick.drop, total: d.methods.policy.pick.total } : null });
      for (const j of h2Keys(wk.week, rid, top.pid, drop)) jobs.set(j.k, j);
    }
  }
  fs.writeFileSync(`${OUTO}/${prefix}_dec.json`, JSON.stringify(out));
  console.log(`${out.length} alert decisions in ${new Set(out.map((x) => x.week)).size} weeks`);
  writeJobs(jobs, prefix);
} else if (mode === "moves") {
  // P8 for the picks, hindsight / POLICY for every evaluated move
  const jobs = new Map<string, any>(), hpJobs = new Map<string, any>(); let n = 0;
  for (const r of decRows(a1)) {
    const pk = r.methods.policy.pick; if (pk) for (const j of h2Keys(r.week, r.rid, pk.add, pk.drop)) { jobs.set(j.k, j); hpJobs.set(j.k, j); }
    for (const m of r.methods.policy.moves as [string, string | null, number, number][]) { n++; for (const j of h2Keys(r.week, r.rid, m[0], m[1])) hpJobs.set(j.k, j); }
  }
  console.log(`${n} moves`);
  writeJobs(jobs, prefix, hpJobs);
}
