function hot(arr) {
  var s = 0;
  for (const e of arr) { s = s + e; }
  return s | 0;
}
var data = []; for (var k = 0; k < 64; k++) data[k] = (k * 7) % 13;
var acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(seed){ acc = 0; }
function getGameState(){ return { score: acc|0, lives:0, gameState:'PLAYING' }; }
function draw(){ acc = hot(data); }
