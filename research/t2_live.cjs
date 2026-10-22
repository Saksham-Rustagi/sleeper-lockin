// Task T2 live check: the task-U card (research/donow_live.ts) with its own cache + config dirs (never the live app's)
//   node research/t2_live.cjs   (bundle research/donow_live.ts to research/dist/donow_live.cjs first)
process.env.LOCKIN_CACHE_DIR = "research/scratch/t2/cache";
process.env.LOCKIN_CONFIG_DIR = "research/scratch/t2/cfg";
process.env.LOCKIN_RACE_WORKERS = "6"; // memory is tight on this Mac
process.argv = [process.argv[0], "donow_live", "1344387394811490304", "8", "research/scratch/t2/live.json"];
require("./dist/donow_live.cjs");
