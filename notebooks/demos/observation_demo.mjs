// Demo: The full observation pipeline
// Loads the actual game, plays a few frames, then extracts an 84x84
// grayscale observation — the exact same pipeline used during RL training.

import { readFileSync } from 'fs';
import vm from 'vm';
import {
  installGlobals,
  setKeysDown,
  simulateKeyPress,
  tick,
  getPixelData,
} from '../../poc/p5/p5-shim.mjs';
import { preprocessObservationFromRGBA } from '../../poc/p5/obs.mjs';

installGlobals();

// Load and run the actual game code via vm
let gameCode = readFileSync('poc/p5/kazuki_game.js', 'utf8');
gameCode += `
globalThis.getGameState = () => ({
  gameState, score, lives, player, inventory, currentRoom
});
`;
vm.runInThisContext(gameCode);
globalThis.setup();
tick();

// Start the game (ENTER) and play 30 frames moving right
simulateKeyPress(13);
tick();
for (let i = 0; i < 30; i++) {
  setKeysDown([39]); // RIGHT_ARROW
  tick();
}

// Extract raw RGBA from the Cairo canvas buffer
const pixels = getPixelData();

// Preprocess: 640x448 RGBA → 84x84 grayscale (BT.601 luminance)
const obs = preprocessObservationFromRGBA(
  pixels.data,
  pixels.width,
  pixels.height,
  84,
  84,
);

const state = globalThis.getGameState();

// Output as JSON for the Python notebook to consume
console.log(
  JSON.stringify({
    canvas_width: pixels.width,
    canvas_height: pixels.height,
    rgba_bytes: pixels.data.length,
    obs_size: obs.length,
    obs_all: Array.from(obs),
    state: {
      gameState: state.gameState,
      score: state.score,
      lives: state.lives,
    },
  }),
);
