// Milestone-2 numeric ISA: int32 bitwise (<<, >>, &, |, ^), mod (%), negate (-), and
// inc (++). Bounded so the int adds don't overflow-deopt. Gate must be byte-identical
// OFF==ON, and the loop should fire under QJIT.
function hot(n) {
  var s = 5, i = 0;
  while (i < n) {
    s = ((s << 3) ^ (i & 255)) & 0x3FFFFF;   // shl, xor, and (mask)
    s = (s + (i % 7)) | 0;                    // mod, or (|0)
    s = s | (i >> 4);                         // sar, or
    s = (s + (-(i % 3 + 1))) & 0x3FFFFF;      // neg (operand 1..3), mod, add, and
    i++;                                      // inc
  }
  return s | 0;
}
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function draw() { acc = hot(4000); }
