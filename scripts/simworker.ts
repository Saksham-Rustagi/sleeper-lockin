// Worker thread: simulates a slice of scenarios (see lib/live/teamsim.ts), or plays race continuations (lib/live/racepool.ts).
import { parentPort } from "worker_threads";
import { weekValues, lockWaitTotals } from "../lib/live/teamsim";
import { raceWorkerMessage } from "../lib/live/racepool";
parentPort!.on("message", (m: any) => {
  if (raceWorkerMessage(m)) return;
  const v = m.kind === "lockwait" ? lockWaitTotals(m.T, m.st0, m.ev0, m.p, m.g, m.X, m.mode, m.N, m.salt, m.asOf, m.k0) : weekValues(m.T, m.N, m.salt, m.asOf, m.k0);
  parentPort!.postMessage({ id: m.id, v }, [v.buffer as ArrayBuffer]);
});
