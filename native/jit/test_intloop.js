let acc = 0;
function setup(){ createCanvas(64,64); }
function resetGame(s){ acc = 0; }
function getGameState(){ return { score: acc | 0, lives: 0, gameState: 'PLAYING' }; }
function draw(){
  var s = 0;
  var i = 0;
  while (i < 5000) { s = s + i; i = i + 1; }
  acc = s;
}
