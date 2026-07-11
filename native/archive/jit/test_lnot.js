// Milestone-4 logical-not: `if (!(...))` in a hot loop (data-dependent branch -> exercises
// the bool-guard path + deopt on the other branch). Must be byte-identical OFF==ON.
function hot(n) {
  var s = 0, i = 0, c = 0;
  while (i < n) {
    if (!(i & 3)) c = c + 1;        // !(i&3): true when i is a multiple of 4
    if (!(i < 0)) s = s + (i & 7);  // !(i<0): always true (lnot flips the compare)
    i = i + 1;
  }
  return (s ^ c) | 0;
}
var acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(seed){ acc = 0; }
function getGameState(){ return { score: acc|0, lives:0, gameState:'PLAYING' }; }
function draw(){ acc = hot(4000); }
