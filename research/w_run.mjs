// Task W runner (research/waivers_bt.ts, bundled to research/dist/waivers_bt.cjs).
//   node research/w_run.mjs one <2025|2024> <bundle args ...> [KEY=VAL ...]   one foreground run (timing)
//   node research/w_run.mjs decide <prefix> <2025|2024> [KEY=VAL ...]        decisions per (week, league), weeks 1-22
//   node research/w_run.mjs score <prefix> <2025|2024> [DEC=p1,p2] [KEY=VAL]  real-outcome P8 totals of every roster the
//        evaluation needs: each team-week's real roster, and for every acted pick the edited roster in weeks w..23 while
//        the pickup is "kept" (real roster still has the dropped player and still lacks the added one)
// Outputs research/out/w/<prefix>_d_<w>_<league>.json, <prefix>_jobs.json, <prefix>_s_<i>.json (resumable). PAR (12).
import { spawn } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const [cmd, ...rest] = process.argv.slice(2);
const kvs = rest.filter((x) => /^[A-Z0-9_]+=/.test(x)); const pos = rest.filter((x) => !/^[A-Z0-9_]+=/.test(x));
const seasonEnv = (y) => y === "2024" ? { SEASON: path.resolve("research/data/season2024.json"), WALL: path.resolve("research/data/w/all2024.json") }
  : { SEASON: path.resolve("research/data/season.json"), WALL: path.resolve("research/data/w/all2025.json") };
const BUNDLE = "research/dist/waivers_bt.cjs";
const mkEnv = (y) => { const env = { ...process.env, ...seasonEnv(y) }; for (const x of kvs) { const i = x.indexOf("="); env[x.slice(0, i)] = x.slice(i + 1); } return env; };
const OUT = "research/out/w"; fs.mkdirSync(OUT, { recursive: true });

async function runAll(tasks, env, PAR) {
  let running = 0, done = 0, failed = 0; const t0 = Date.now(); const total = tasks.length;
  await new Promise((resolve) => {
    if (!tasks.length) return resolve();
    const next = () => {
      while (running < PAR && tasks.length) {
        const t = tasks.shift(); running++;
        const p = spawn(process.execPath, ["--max-old-space-size=3000", BUNDLE, ...t.args], { env: t.env ? { ...env, ...t.env } : env, stdio: ["ignore", "ignore", "pipe"] });
        let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 6000) err = err.slice(-6000); });
        p.on("exit", (code) => {
          running--; done++;
          if (code) { failed++; console.error(`${t.args.join(" ")} FAILED (${code}): ${err.slice(-1500)}`); }
          else if (t.log) fs.writeFileSync(t.log, err);
          console.log(`${done}/${total} done, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
          if (!tasks.length && !running) resolve(); else next();
        });
      }
    };
    next();
  });
}

if (cmd === "one") {
  const [y, ...args] = pos;
  const p = spawn(process.execPath, [BUNDLE, ...args], { env: mkEnv(y), stdio: "inherit" });
  await new Promise((r) => p.on("exit", r));
} else if (cmd === "decide") {
  const [prefix, y] = pos; const env = mkEnv(y); const S = JSON.parse(fs.readFileSync(env.SEASON, "utf8"));
  const A = JSON.parse(fs.readFileSync(env.WALL, "utf8"));
  const [a, b] = (env.WEEKS || "1-22").split("-").map(Number);
  const leagues = [...new Set(Object.values(A.leagueOf))].sort().filter((l) => !env.LEAGUES || env.LEAGUES.split(",").includes(l));
  const tasks = [];
  // SPLIT=team: one process per team-week (expensive methods), else one per (week, league)
  for (let w = a; w <= (b ?? a); w++) for (const lg of leagues) {
    const rids = env.SPLIT === "team" ? Object.keys(A.leagueOf).filter((r) => A.leagueOf[r] === lg) : [null];
    for (const rid of rids) {
      const out = `${OUT}/${prefix}_d_${w}_${lg}${rid ? "_" + rid : ""}.json`; if (fs.existsSync(out)) continue;
      tasks.push({ args: ["decide", String(w), lg, out], log: out.replace(/\.json$/, ".log"), env: rid ? { TEAMS: rid } : undefined });
    }
  }
  // longest first (later weeks have the same cost; mixing leagues keeps memory even)
  await runAll(tasks, env, Number(env.PAR || 12));
} else if (cmd === "score") {
  const [prefix, y] = pos; const env = mkEnv(y); const S = JSON.parse(fs.readFileSync(env.SEASON, "utf8"));
  const LAST = Math.max(...S.weeks.map((W) => W.week));
  const roster = (w, rid) => S.weeks.find((W) => W.week === w)?.teams[rid]?.players;
  const jobs = new Map(); const keyOf = (w, rid, pids) => `${w}|${rid}|${[...pids].sort().join(",")}`;
  const need = (w, rid, pids) => { const k = keyOf(w, rid, pids); if (!jobs.has(k)) jobs.set(k, { w, rid, pids, k }); return k; };
  for (const W of S.weeks) for (const rid of Object.keys(W.teams)) need(W.week, rid, W.teams[rid].players);
  const decs = (env.DEC || prefix).split(",");
  const files = fs.readdirSync(OUT).filter((f) => decs.some((d) => f.startsWith(d + "_d_")) && f.endsWith(".json"));
  for (const f of files) for (const row of JSON.parse(fs.readFileSync(`${OUT}/${f}`, "utf8"))) {
    for (const m of Object.values(row.methods)) {
      const p = m.pick; if (!p) continue;
      for (let w = row.week; w <= LAST; w++) {
        const r = roster(w, row.rid); if (!r || r.includes(p.add) || (p.drop && !r.includes(p.drop))) break;
        need(w, row.rid, r.filter((x) => x !== p.drop).concat([p.add]));
      }
    }
  }
  // already scored (any earlier round of this prefix) -> skip; new jobs go to a new round of chunk files
  const done = new Set(); let round = 0;
  for (const f of fs.readdirSync(OUT)) {
    const m = f.match(new RegExp(`^${prefix}_s(\\d+)_\\d+\\.json$`)); if (!m) continue;
    round = Math.max(round, Number(m[1]) + 1); for (const k of Object.keys(JSON.parse(fs.readFileSync(`${OUT}/${f}`, "utf8")).res)) done.add(k);
  }
  const all = [...jobs.values()].filter((j) => !done.has(j.k)); fs.writeFileSync(`${OUT}/${prefix}_jobs${round}.json`, JSON.stringify(all.map((j) => j.k)));
  const CH = Number(env.CHUNK || 60); const tasks = [];
  // spread weeks over chunks (cost varies by week)
  all.sort((p, q) => p.k < q.k ? -1 : 1);
  const nCh = Math.ceil(all.length / CH);
  for (let i = 0; i < nCh; i++) {
    const out = `${OUT}/${prefix}_s${round}_${i}.json`;
    const mine = all.filter((_, j) => j % nCh === i); const jf = `${OUT}/${prefix}_sj${round}_${i}.json`;
    fs.writeFileSync(jf, JSON.stringify(mine)); tasks.push({ args: ["score", jf, out] });
  }
  console.log(`${jobs.size} roster-weeks needed, ${done.size} already scored; round ${round}: ${all.length} in ${nCh} chunks`);
  await runAll(tasks, env, Number(env.PAR || 12));
}
