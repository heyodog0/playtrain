// fuzz program 23 (auto-generated; FLOAT supported-ISA hot loop)
var acc = 0;
function setup() { createCanvas(64, 64); }
function resetGame(seed) { acc = 0; }
function getGameState() { return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function hot(n) {
  var s = 0.0, x = 0.25, y = 1.5;
  while (x < n) {
    s = s - x * x;
    if (x < 22.5) s = s + 0.75;
    s = s + y * 2.5;
    x = x + 0.25;
  }
  return ((s * 1000) | 0) ^ ((y * 997) | 0);          // precision-sensitive projection
}
function draw() { acc = (acc + hot(406.5)) | 0; }
