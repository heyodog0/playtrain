// instruction_smoke — the instruction channel's test game (DMLab tier 2,
// language levels). getInstruction() returns a text observation that depends
// on the seed and changes every 10 frames; the backends return it as
// info["instruction"] (one string per env for the vectorised ones).
let seed0, score, gameState;

function setup() {
  createCanvas(64, 64);
}

function resetGame(seed) {
  seed0 = seed;
  score = 0;
  gameState = 'PLAYING';
}

function draw() {
  background((seed0 * 37) % 255, 40, 80);
  fill(255);
  rect(frameCount % 64, 30, 4, 4);
  if (frameCount >= 200) gameState = 'GAMEOVER';
}

function getInstruction() {
  return 'pick é ' + (seed0 % 5) + ' at ' + Math.floor(frameCount / 10);
}

function getGameState() {
  return { score, lives: 1, gameState };
}
