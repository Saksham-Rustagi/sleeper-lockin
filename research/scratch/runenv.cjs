// node research/scratch/runenv.cjs KEY=VAL ... bundle.cjs [args]: set env vars, then run the bundle
const path = require("path");
const a = process.argv.slice(2); let i = 0;
for (; i < a.length && /^[A-Z_][A-Z0-9_]*=/.test(a[i]); i++) { const k = a[i].indexOf("="); process.env[a[i].slice(0, k)] = a[i].slice(k + 1); }
process.argv = [process.argv[0], path.resolve(a[i]), ...a.slice(i + 1)];
require(path.resolve(a[i]));
