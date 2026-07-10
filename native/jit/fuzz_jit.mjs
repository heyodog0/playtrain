// fuzz_jit.mjs — engine-level differential fuzzer for the QuickJS JIT.
// Generates random node-gym "games" whose hot draw-loop is built ONLY from the JIT's
// supported ISA subset (int arithmetic, fast-array int/string loads, strict_eq, control
// flow). Each program is meant to FIRE a trace. The runner then checks qjs_host OFF vs ON
// is bit-exact for every program × seed — proving the JIT is faithful to QuickJS for
// arbitrary inputs, not just for hand-picked games.
//
//   node fuzz_jit.mjs <count> <outdir> [int|float]   # emit <count> programs into <outdir>
//
// mode 'float' (milestone 1) generates float-local hot loops (f64 arithmetic, float
// consts, float compares incl. negated/NaN-free guards) — the gate for the float path.
// (a companion bash sweep runs each OFF vs ON and diffs — see the commit / README.)
import { writeFileSync, mkdirSync } from 'node:fs';

const count = parseInt(process.argv[2] || '24', 10);
const outdir = process.argv[3] || 'jit/fuzz';
const mode = process.argv[4] || 'int';
mkdirSync(outdir, { recursive: true });

// deterministic per-program RNG (mulberry32) so the corpus is reproducible
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const ATOMS = ['GROUND', 'AIR', 'WALL', 'X', 'Y'];

// a random int-producing sub-expression over locals i and accumulators
function intExpr(r) {
  const k = (r() * 9 | 0) + 1;
  const forms = [ `i`, `${k}`, `i + ${k}`, `i - ${k}`, `i * ${k}`, `s + i`, `ai[i]`, `ai[i] + ${k}` ];
  return forms[r() * forms.length | 0];
}

function stmt(r) {
  switch (r() * 6 | 0) {
    case 0: return `s = s + ${intExpr(r)};`;
    case 1: return `s = s - ${intExpr(r)};`;
    case 2: return `s = s + ai[i];`;
    case 3: return `if (as[i] === '${ATOMS[r() * ATOMS.length | 0]}') c = c + 1;`;
    case 4: return `if (ai[i] < ${(r() * 5 | 0)}) c = c + 1;`;
    default: return `s = s + i * ${(r() * 4 | 0) + 1};`;
  }
}

// --- float generators (milestone 1). Locals x,y,s are float; consts are non-integral so
// they stay FLOAT64. A precision-sensitive integer projection is the observable score. ---
function fconst(r) { const t = ['0.5','0.25','1.5','2.5','0.75','1.25','3.5']; return t[r() * t.length | 0]; }
function fexpr(r) {
  const forms = [`x`, `x * ${fconst(r)}`, `x + ${fconst(r)}`, `s + x`, `y - x`, `x * x`, `y * ${fconst(r)}`];
  return forms[r() * forms.length | 0];
}
function fstmt(r) {
  switch (r() * 6 | 0) {
    case 0: return `s = s + ${fexpr(r)};`;
    case 1: return `s = s - ${fexpr(r)};`;
    case 2: return `y = y + x * ${fconst(r)};`;
    case 3: return `if (x < ${(r() * 40 | 0)}.5) s = s + ${fconst(r)};`;   // mid-body float guard
    case 4: return `y = y - ${fconst(r)};`;
    default: return `s = s + y * ${fconst(r)};`;
  }
}

for (let p = 0; p < count; p++) {
  const r = rng(p * 2654435761 + 12345);
  const N = 200 + (r() * 400 | 0);                    // loop length (crosses the hot threshold over frames)
  const nStmt = 1 + (r() * 4 | 0);
  let src;
  if (mode === 'float') {
    const body = Array.from({ length: nStmt }, () => '    ' + fstmt(r)).join('\n');
    src = `// fuzz program ${p} (auto-generated; FLOAT supported-ISA hot loop)
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function hot(n) {
  var s = 0.0, x = 0.25, y = 1.5;
  while (x < n) {
${body}
    x = x + 0.25;
  }
  return ((s * 1000) | 0) ^ ((y * 997) | 0);          // precision-sensitive projection
}
function draw() { acc = (acc + hot(${N}.5)) | 0; }
`;
  } else {
    const body = Array.from({ length: nStmt }, () => '    ' + stmt(r)).join('\n');
    src = `// fuzz program ${p} (auto-generated; supported-ISA hot loop)
var ai = [], as = [];
for (var k = 0; k < ${N}; k++) { ai[k] = (k * 7 + ${p}) % 17; as[k] = ${JSON.stringify(ATOMS)}[(k + ${p}) % ${ATOMS.length}]; }
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function hot(n) {
  var s = 0, c = 0, i = 0;
  while (i < n) {
${body}
    i = i + 1;
  }
  return (s ^ (c * 131)) | 0;
}
function draw() { acc = (acc + hot(${N})) | 0; }
`;
  }
  writeFileSync(`${outdir}/prog_${String(p).padStart(2, '0')}.js`, src);
}
console.log(`wrote ${count} ${mode} fuzz programs to ${outdir}/`);
