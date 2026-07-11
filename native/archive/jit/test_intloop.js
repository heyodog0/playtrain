function hotsum(n) {          // self-contained: only local vars + arg, no closure refs
  var s = 0;
  var i = 0;
  while (i < n) { s = s + i; i = i + 1; }
  return s;
}
var acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(seed){ acc = 0; }
function getGameState(){ return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function draw(){ acc = hotsum(5000); }
