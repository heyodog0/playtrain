// int-array reduction: hot loop reads arr[i] (fast-array int elements), sums them.
// Exercises increment-1 codegen live: guarded array load + bounds + int-element unbox.
var arr = [];
for (var k = 0; k < 64; k++) arr[k] = (k * 7) % 13;

var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }

function sumArr(a, n) {          // a = arg0 (array), n = arg1; s,i locals
  var s = 0;
  var i = 0;
  while (i < n) { s = s + a[i]; i = i + 1; }
  return s;
}
function draw() { acc = sumArr(arr, 64); }
