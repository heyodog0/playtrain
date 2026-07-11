var tiles = [];
for (var k = 0; k < 64; k++) tiles[k] = (k % 3 === 0) ? 'GROUND' : 'AIR';
var acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(s){ acc = 0; }
function getGameState(){ return { score: acc|0, lives: 0, gameState: 'PLAYING' }; }
function countGround(a, n) {
  var c = 0; var i = 0;
  while (i < n) { if (a[i] === 'GROUND') { c = c + 1; } i = i + 1; }
  return c;
}
function draw(){ acc = countGround(tiles, 64); }
