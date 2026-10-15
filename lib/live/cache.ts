// Result cache keyed by an input fingerprint: recompute only when something that affects the answer changed.
// Memory cache (per process) + optional disk cache (LOCKIN_CACHE_DIR) shared by the web app and the notifier.
import crypto from "crypto";
import { engineTag, simTag } from "./engine";

const mem = new Map<string, { fp: string; v: unknown }>();

// Every cached result depends on the decision engine: a non-default engine is part of the fingerprint (the default's
// fingerprints are unchanged, so switching engines never serves another engine's numbers). scope "sim": a result of
// mass simulations only (projections, Waivers, league, IR) - keyed by the simulation engine, so engines that simulate
// alike (p7h and p10b both use POLICY) share entries; "decision" (default): anything containing decisions.
export function fingerprint(x: unknown, scope: "decision" | "sim" = "decision"): string {
  const tag = scope === "sim" ? simTag() : engineTag(); if (tag) x = { engine: tag, x };
  return crypto.createHash("sha1").update(JSON.stringify(x, (_k, v) => (v instanceof Float64Array || v instanceof Int32Array || v instanceof Uint8Array ? Array.from(v as ArrayLike<number>).map((n) => (Number.isNaN(n) ? "NaN" : Math.round(n * 100) / 100)) : v))).digest("hex");
}

async function disk() {
  if (typeof window !== "undefined" || !process.env.LOCKIN_CACHE_DIR) return null;
  const fs = await import("fs"); const path = await import("path");
  const dir = path.join(process.env.LOCKIN_CACHE_DIR, "results"); fs.mkdirSync(dir, { recursive: true });
  const file = (key: string) => path.join(dir, key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
  return {
    get(key: string) { try { return JSON.parse(fs.readFileSync(file(key), "utf8")) as { fp: string; v: unknown }; } catch { return undefined; } },
    set(key: string, val: { fp: string; v: unknown }) { try { fs.writeFileSync(file(key), JSON.stringify(val)); } catch {} },
  };
}

export async function cachedCompute<T>(key: string, fp: string, compute: () => T | Promise<T>): Promise<{ value: T; cached: boolean }> {
  const m = mem.get(key);
  if (m && m.fp === fp) return { value: m.v as T, cached: true };
  const d = await disk();
  const dv = d?.get(key);
  if (dv && dv.fp === fp) { mem.set(key, dv); return { value: dv.v as T, cached: true }; }
  const v = await compute();
  const entry = { fp, v }; mem.set(key, entry); d?.set(key, entry);
  return { value: v, cached: false };
}
