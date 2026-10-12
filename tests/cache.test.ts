import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedCompute, fingerprint } from "../lib/live/cache";

test("results are reused until an input changes", async () => {
  let runs = 0; const work = () => { runs++; return { answer: runs }; };
  const fpA = fingerprint({ week: 1, locks: new Float64Array([0, NaN, 12.5]) });
  const a1 = await cachedCompute("t-key", fpA, work);
  const a2 = await cachedCompute("t-key", fingerprint({ week: 1, locks: new Float64Array([0, NaN, 12.5]) }), work);
  assert.equal(runs, 1); assert.equal(a1.cached, false); assert.equal(a2.cached, true); assert.deepEqual(a2.value, a1.value);
  const b = await cachedCompute("t-key", fingerprint({ week: 1, locks: new Float64Array([0, NaN, 31.0]) }), work);
  assert.equal(runs, 2); assert.equal(b.cached, false);
});
