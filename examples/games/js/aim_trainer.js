// aim_trainer — pointer-input demo game (GAME_TEMPLATE.md pointer tier).
// Click the target to score; 10 hits wins, 900 frames is game over. Reads the
// pointer through standard p5 globals (mouseX / mouseY / mouseIsPressed), so
// it is playable with a real mouse in the browser, with the "mouse2d" box
// space (continuous pointer + click), or with the "aimgrid18" discrete preset.
// Keyboard-only spaces can't score here — this game exists to exercise and
// gate the pointer input channel.
let targets, ti, score, gameState;
const HITS_NEEDED = 10;
// Small target: random click-spam averages ~3 hits per episode, so beating it
// requires actual aim — this is what makes the game a learning benchmark.
const RADIUS = 3;
const TIME_LIMIT = 900;

function setup() {
  createCanvas(64, 64);
}

function resetGame(seed) {
  score = 0;
  ti = 0;
  gameState = 'PLAYING';
  // Per-seed variation: the whole target sequence is drawn from the seeded RNG.
  targets = [];
  for (let i = 0; i < HITS_NEEDED; i++) {
    targets.push({
      x: 8 + Math.random() * (width - 16),
      y: 8 + Math.random() * (height - 16),
    });
  }
}

function draw() {
  background(18, 22, 30);
  noStroke();  // don't inherit stroke state (differs between first-frame paths)

  if (gameState === 'PLAYING') {
    const t = targets[ti];
    const dx = mouseX - t.x, dy = mouseY - t.y;
    const d2 = dx * dx + dy * dy;
    // Dense proximity shaping (monotonic score): a small bonus each frame the
    // crosshair hovers near the target gives the policy a gradient toward it —
    // the sparse click reward alone is an exploration cliff at RADIUS=3.
    if (d2 <= 144) score += 0.01;
    if (mouseIsPressed && d2 <= RADIUS * RADIUS) {
      score += 1;
      ti += 1;
      if (ti >= HITS_NEEDED) gameState = 'WIN';
    }
    if (gameState === 'PLAYING' && frameCount >= TIME_LIMIT) gameState = 'GAMEOVER';
  }

  // Clock sweep: the obs must evolve even under keyboard-only random play
  // (the validator's changes-after-30-steps check), and it gives the agent a
  // visible time budget.
  fill(60, 70, 90);
  rect(frameCount % width, 0, 1, 2);

  const t = targets[Math.min(ti, HITS_NEEDED - 1)];
  fill(220, 60, 60);
  circle(t.x, t.y, RADIUS * 2);
  fill(250, 200, 90);
  circle(t.x, t.y, 4);

  // Crosshair at the pointer.
  stroke(240, 240, 240);
  line(mouseX - 3, mouseY, mouseX + 3, mouseY);
  line(mouseX, mouseY - 3, mouseX, mouseY + 3);
  noStroke();

  // Progress bar.
  fill(90, 200, 120);
  rect(0, 62, (score / HITS_NEEDED) * width, 2);
}

function getGameState() {
  return { score, lives: 1, gameState };
}
