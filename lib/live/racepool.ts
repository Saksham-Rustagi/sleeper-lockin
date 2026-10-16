// P10 / P10b races on worker threads (REPORT "P10b on worker threads"). The race and every simulate() / hook API stay
// synchronous: per racing round the main thread posts the round to the workers, plays continuations itself too, and
// blocks (Atomics.wait) until all of the round's results are in a SharedArrayBuffer. Continuations are claimed one at a
// time from a shared counter and written at their own index (candidate-major), so the results, and therefore the
// race's eliminations, stopping and decision, are exactly the single-thread ones whatever the number of workers or
// who computed what: each continuation is a pure function of (team-week, base policy, state, candidate, scenario, the
// real decision's prices), the scenarios are drawn on the main thread from the race's own stream, and the workers
// rebuild the real decision's price view exactly (lib/engine/p8.ts exportPrices / importPrices). (Claims: one at a time by
// default, env LOCKIN_RACE_CHUNK; larger chunks measured no faster.)
// Fallback (identical results, this thread): no worker bundle (or one built before this protocol), browser,
// LOCKIN_NO_WORKERS, LOCKIN_RACE_WORKERS=0, or any failure (a worker error, no progress for STALL_MS): the round is
// played here and the pool is switched off.
// Workers: the app's worker bundle (scripts/simworker.ts -> scripts/dist/simworker.cjs, `npm run build:notify`), in
// their own pool (not the projections' pool: a round must not queue behind a 20k-week projection chunk).
import { Worker } from "worker_threads";
import fs from "fs";
import os from "os";
import path from "path";
import * as E from "../engine/core";
import { importPrices, resetPrices, setMemoMax, type PriceSnap } from "../engine/p8";
import { continuation, type RaceCtx, type RacePool, type Scen } from "../engine/p10";

export const RACE_PROTOCOL = "lockin-race-v1"; // the worker bundle must contain this string (stale bundles are skipped)
const STALL_MS = Number(process.env.LOCKIN_RACE_STALL_MS || 60000);
const HELLO_MS = 20000;
const IDLE_MS = Number(process.env.LOCKIN_RACE_IDLE_MS || 10 * 60e3); // the app's pool is stopped after this long unused
const TW_KEEP = 2; // team-weeks a worker keeps (the main thread mirrors the workers' list: same messages, same order)
const WORKER_MEMO = 100; // P8 re-solve memo per team-week in a worker (1000 views x 12 workers = ~3 GB; results identical)

// Continuations are claimed `chunk` at a time from ctrl[0] (index i = candidate j * n + scenario k: consecutive scenarios
// of one candidate share the re-solve memo); ctrl[1] counts the results written, ctrl[2] flags a failure.
function claim(ctrl: Int32Array, out: Float64Array, total: number, n: number, chunk: number, f: (j: number, k: number) => number, notify: boolean) {
  for (;;) {
    const i0 = Atomics.add(ctrl, 0, chunk); if (i0 >= total) break;
    for (let i = i0, i1 = Math.min(total, i0 + chunk); i < i1; i++) {
      const j = (i / n) | 0; out[i] = f(j, i - j * n);
      Atomics.add(ctrl, 1, 1); if (notify) Atomics.notify(ctrl, 1);
    }
  }
}
const CHUNK = Math.max(1, Number(process.env.LOCKIN_RACE_CHUNK || 1));

// ---------------- main thread ----------------
export interface RaceWorkerPool extends RacePool { size: number; close(): Promise<void>; alive(): boolean; heap(): Promise<{ used: number; total: number }[]> }
export function createRacePool(file: string, size: number, log: (s: string) => void = () => {}): RaceWorkerPool | null {
  try {
    if (!fs.readFileSync(file, "utf8").includes(RACE_PROTOCOL)) { log(`[racepool] ${file} predates the race protocol (rebuild: npm run build:notify): racing on one thread`); return null; }
  } catch { return null; }
  let workers: Worker[] = Array.from({ length: size }, () => { const w = new Worker(file); w.unref(); w.on("error", (e) => log(`[racepool] worker error: ${e}`)); return w; });
  // handshake: every worker answers (the bundle loads and speaks the protocol)
  const hello = new Int32Array(new SharedArrayBuffer(4));
  workers.forEach((w) => w.postMessage({ kind: "race-hello", sab: hello.buffer }));
  const t0 = Date.now();
  for (let d = Atomics.load(hello, 0); d < size; d = Atomics.load(hello, 0)) {
    if (Date.now() - t0 > HELLO_MS) { log(`[racepool] workers did not start (${d}/${size} in ${HELLO_MS} ms): racing on one thread`); workers.forEach((w) => w.terminate()); return null; }
    Atomics.wait(hello, 0, d, 200);
  }
  log(`[racepool] ${size} race workers from ${file} (${Date.now() - t0} ms)`);
  // team-weeks are sent once per worker (keyed by identity of what the engine reads; built once, never edited in place)
  type TwRef = { key: number; refs: unknown[] };
  const twKeys = new WeakMap<E.TeamWeek, TwRef>(); let nextKey = 0; const sent: number[] = [];
  const refsOf = (tw: E.TeamWeek, ev: E.Ev[]) => [ev, tw.games, tw.byPlayer, tw.slots, tw.pmask, tw.dnp, tw.pNext, tw.nextGameIdx, tw.resid, tw.lastPlayed0, tw.avail, tw.gone];
  const twKey = (tw: E.TeamWeek, ev: E.Ev[]) => {
    const refs = refsOf(tw, ev); let k = twKeys.get(tw);
    if (!k || k.refs.some((x, i) => x !== refs[i])) { k = { key: ++nextKey, refs }; twKeys.set(tw, k); }
    return k.key;
  };
  const cids = new WeakMap<RaceCtx, number>(); let nextCid = 0;
  const scratch = E.scratchState();
  const off = (why: string) => { log(`[racepool] ${why}: racing on one thread from now on`); const ws = workers; workers = []; ws.forEach((w) => w.terminate()); };
  return {
    size,
    alive: () => workers.length > 0,
    heap: () => Promise.all(workers.map(async (w) => { const h = await (w as unknown as { getHeapStatistics(): Promise<{ used_heap_size: number; total_heap_size: number }> }).getHeapStatistics(); return { used: h.used_heap_size, total: h.total_heap_size }; })),
    close: async () => { const ws = workers; workers = []; await Promise.all(ws.map((w) => w.terminate())); },
    round(ctx: RaceCtx, alive: number[], scens: Scen[]): number[][] | null {
      if (!workers.length) return null;
      const n = scens.length, total = alive.length * n;
      const sab = new SharedArrayBuffer(16 + 8 * total); const ctrl = new Int32Array(sab, 0, 4); const out = new Float64Array(sab, 16, total);
      try {
        let cid = cids.get(ctx);
        if (cid === undefined) {
          const tk = twKey(ctx.tw, ctx.events); cid = ++nextCid; cids.set(ctx, cid);
          if (!sent.includes(tk)) { for (const w of workers) w.postMessage({ kind: "race-tw", key: tk, tw: ctx.tw, events: ctx.events }); sent.push(tk); if (sent.length > TW_KEEP) sent.shift(); }
          for (const w of workers) w.postMessage({ kind: "race-ctx", cid, tk, base: ctx.base, st: ctx.st, evIdx: ctx.evIdx, cands: ctx.cands, prices: ctx.prices });
        }
        for (const w of workers) w.postMessage({ kind: "race-round", cid, alive, scens, sab, chunk: CHUNK });
      } catch (e) { off(`posting failed (${e})`); return null; }
      // this thread plays its share
      claim(ctrl, out, total, n, CHUNK, (j, k) => continuation(ctx.tw, ctx.base, ctx.events, ctx.st, ctx.evIdx, ctx.cands[alive[j]], scens[k], scratch), false);
      // wait for the workers' (the round's elimination / stopping only happens once every result is in)
      let last = Atomics.load(ctrl, 1), since = Date.now();
      while (last < total && !Atomics.load(ctrl, 2)) {
        Atomics.wait(ctrl, 1, last, 250);
        const d = Atomics.load(ctrl, 1);
        if (d !== last) { last = d; since = Date.now(); } else if (Date.now() - since > STALL_MS) { Atomics.store(ctrl, 0, total); off(`no progress for ${STALL_MS} ms`); return null; }
      }
      if (Atomics.load(ctrl, 2)) { Atomics.store(ctrl, 0, total); off("a worker failed"); return null; }
      const res: number[][] = []; for (let j = 0; j < alive.length; j++) res.push(Array.from(out.subarray(j * n, (j + 1) * n)));
      return res;
    },
  };
}

// The app's pool: created on the first raced round (never just by building hooks), stopped after IDLE_MS unused (the
// web server keeps running; a new pool starts in ~0.1 s). Size env LOCKIN_RACE_WORKERS (default min(12, cores - 2); 0 =
// off); LOCKIN_NO_WORKERS also switches it off. Worker bundle as for the projections' pool (lib/live/teamsim.ts): env
// LOCKIN_SIMWORKER, ./scripts/dist/simworker.cjs, or next to this bundle.
let live: RaceWorkerPool | null | undefined; let lastUse = 0; let idleTimer: ReturnType<typeof setInterval> | null = null;
function livePool(): RaceWorkerPool | null {
  lastUse = Date.now();
  if (live !== undefined) return live && live.alive() ? live : null;
  live = null;
  if (typeof window !== "undefined" || process.env.LOCKIN_NO_WORKERS) return live;
  const size = process.env.LOCKIN_RACE_WORKERS !== undefined ? Number(process.env.LOCKIN_RACE_WORKERS) : Math.max(1, Math.min(12, os.cpus().length - 2));
  if (!(size > 0)) return live;
  const file = [process.env.LOCKIN_SIMWORKER, path.join(process.cwd(), "scripts/dist/simworker.cjs"), typeof __dirname !== "undefined" ? path.join(__dirname, "simworker.cjs") : undefined]
    .find((f) => f && fs.existsSync(f));
  if (!file) { console.log(`[racepool] no simworker.cjs found (cwd ${process.cwd()}): racing on one thread`); return live; }
  try { live = createRacePool(path.resolve(file), size, (s) => console.log(s)); } catch (e) { console.log("[racepool] workers unavailable, racing on one thread:", e); live = null; }
  if (live && !idleTimer) {
    idleTimer = setInterval(() => {
      if (Date.now() - lastUse < IDLE_MS) return;
      const p = live; live = undefined; if (idleTimer) clearInterval(idleTimer); idleTimer = null; p?.close();
    }, Math.min(60e3, IDLE_MS));
    idleTimer.unref?.();
  }
  return live;
}
export const liveRacePool: RacePool = { round: (ctx, alive, scens) => livePool()?.round(ctx, alive, scens) ?? null };
export function liveRaceWorkers(): number { return livePool()?.size ?? 0; }
// (tests) stop the app's pool; the next race re-reads the environment
export async function resetLiveRacePool() { const p = live; live = undefined; if (idleTimer) clearInterval(idleTimer); idleTimer = null; if (p) await p.close(); }

// ---------------- worker thread ----------------
const tws = new Map<number, { tw: E.TeamWeek; events: E.Ev[] }>();
const ctxs = new Map<number, { tk: number; base: E.Policy; st: E.State; evIdx: number; cands: RaceCtx["cands"]; prices: PriceSnap | null }>();
let imported = -1; let wScratch: ((st: E.State) => E.State) | null = null;
const trim = <K, V>(m: Map<K, V>, max: number) => { while (m.size > max) m.delete(m.keys().next().value!); };
// handles a race message (returns false for any other message)
export function raceWorkerMessage(m: any): boolean {
  switch (m?.kind) {
    case "race-hello": { setMemoMax(WORKER_MEMO); const c = new Int32Array(m.sab); Atomics.add(c, 0, 1); Atomics.notify(c, 0); return true; }
    case "race-tw": tws.delete(m.key); tws.set(m.key, { tw: m.tw, events: m.events }); trim(tws, TW_KEEP); return true;
    case "race-ctx": ctxs.set(m.cid, m); trim(ctxs, 4); return true;
    case "race-round": {
      const n = m.scens.length, total = m.alive.length * n;
      const ctrl = new Int32Array(m.sab, 0, 4); const out = new Float64Array(m.sab, 16, total);
      try {
        const c = ctxs.get(m.cid); const T = c && tws.get(c.tk); if (!c || !T) throw new Error(`race context ${m.cid} missing`);
        if (imported !== m.cid) { if (c.prices) importPrices(T.tw, c.prices); else resetPrices(T.tw); imported = m.cid; }
        const sc = (wScratch ??= E.scratchState());
        claim(ctrl, out, total, n, m.chunk ?? 1, (j, k) => continuation(T.tw, c.base, T.events, c.st, c.evIdx, c.cands[m.alive[j]], m.scens[k], sc), true);
      } catch (e) { console.error(`[${RACE_PROTOCOL}] worker:`, e); Atomics.store(ctrl, 2, 1); Atomics.notify(ctrl, 1); }
      return true;
    }
  }
  return false;
}
