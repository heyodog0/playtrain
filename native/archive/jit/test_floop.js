// Float hot loop (milestone 1): pure-float locals + a float bound. Positions/physics
// style — the case int-only specialization can't touch. Exercises the f64 fast path
// end-to-end: FLOAD/FSTORE, FADD/FMUL, float loop guard (with int->float promotion of
// the bound if it is int-tagged). Gate must be byte-identical OFF==ON.
function hotf(n) {              // self-contained: only local vars + arg (no closure refs)
  var s = 0.0;                  // becomes FLOAT64 after the first float op
  var x = 0.25;                 // FLOAT64 (non-integral -> stays float)
  while (x < n) { s = s + x * 1.5; x = x + 0.25; }
  return s;
}
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: (acc * 1000) | 0, lives: 0, gameState: 'PLAYING' }; }
function draw() { acc = hotf(1000.25); }
