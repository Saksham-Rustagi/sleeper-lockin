// Legal Sleeper rearrangements (rule 9): move a starter into an empty eligible slot, or swap two movable starters
// each eligible for the other's slot. Shared by the P8 policy (lib/engine/p8.ts) and the invariant checker.
// a matching of players into the open slots (prefer[p] tried first), or null
export function placeAll(slots: number[], pmask: number[], open: number, players: number[], prefer?: ArrayLike<number>): Map<number, number> | null {
  const nS = slots.length; const match = new Int32Array(nS).fill(-1);
  const aug = (p: number, seen: Uint8Array): boolean => {
    const order: number[] = []; const pf = prefer ? prefer[p] : -1;
    if (pf >= 0) order.push(pf); for (let s = 0; s < nS; s++) if (s !== pf) order.push(s);
    for (const s of order) {
      if (!((open >> s) & 1) || seen[s] || !(slots[s] & pmask[p])) continue;
      seen[s] = 1;
      if (match[s] < 0 || aug(match[s], seen)) { match[s] = p; return true; }
    }
    return false;
  };
  for (const p of players) if (!aug(p, new Uint8Array(nS))) return null;
  const m = new Map<number, number>(); match.forEach((p, s) => { if (p >= 0) m.set(p, s); });
  return m;
}
// BFS over arrangements of `players` (currently at cur[i]) inside the movable slots using single Sleeper moves.
// Returns the first arrangement satisfying goal (fewest moves), or null if none is reachable.
export function reach(slots: number[], pmask: number[], movable: number, players: number[], cur: number[], goal: (pos: Int8Array) => boolean, maxStates = 400000):
  { pos: Int8Array; moves: number } | null | "capped" {
  const n = players.length; const nS = slots.length;
  const start = Int8Array.from(cur);
  if (goal(start)) return { pos: start, moves: 0 };
  const key = (a: Int8Array) => { let k = 0; for (let i = 0; i < n; i++) k = k * 16 + a[i]; return k; };
  const seen = new Set<number>([key(start)]); let frontier: Int8Array[] = [start]; let depth = 0;
  while (frontier.length) {
    depth++; const next: Int8Array[] = [];
    for (const a of frontier) {
      const occ = new Int8Array(nS).fill(-1); for (let i = 0; i < n; i++) occ[a[i]] = i;
      const push = (b: Int8Array): { pos: Int8Array; moves: number } | null => {
        const k = key(b); if (seen.has(k)) return null; seen.add(k);
        if (goal(b)) return { pos: b, moves: depth };
        next.push(b); return null;
      };
      for (let i = 0; i < n; i++) {
        const p = players[i];
        for (let s = 0; s < nS; s++) {
          if (!((movable >> s) & 1) || !(slots[s] & pmask[p]) || s === a[i]) continue;
          const j = occ[s];
          if (j < 0) { const b = a.slice(); b[i] = s; const r = push(b); if (r) return r; }
          else if (j > i && slots[a[i]] & pmask[players[j]]) { const b = a.slice(); b[i] = s; b[j] = a[i]; const r = push(b); if (r) return r; }
        }
      }
      if (seen.size > maxStates) return "capped";
    }
    frontier = next;
  }
  return null;
}

