// Worker thread: simulates a slice of scenarios for one team (see lib/live/teamsim.ts parallelWeekValues).
import { parentPort } from "worker_threads";
import { weekValues } from "../lib/live/teamsim";
parentPort!.on("message", (m: { id: number; T: any; N: number; salt: number; asOf: number; k0: number }) => {
  const v = weekValues(m.T, m.N, m.salt, m.asOf, m.k0);
  parentPort!.postMessage({ id: m.id, v }, [v.buffer as ArrayBuffer]);
});
