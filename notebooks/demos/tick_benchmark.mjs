// Demo: Frame-locked stepping benchmark
// Shows how fast synchronous tick() is compared to the browser's
// requestAnimationFrame ceiling of 60 FPS.

import { readFileSync } from 'fs';
import vm from 'vm';
import {
  installGlobals,
  setKeysDown,
  simulateKeyPress,
  tick,
} from '../../poc/p5/p5-shim.mjs';

installGlobals();

let gameCode = readFileSync('poc/p5/kazuki_game.js', 'utf8');
gameCode += `
globalThis.getGameState = () => ({
  gameState, score, lives, player, inventory, currentRoom
});
`;
vm.runInThisContext(gameCode);
globalThis.setup();
tick();
simulateKeyPress(13);
tick();

// Benchmark: pure tick() speed (render only, no observation extraction)
const frames = 5000;
const start = performance.now();
for (let i = 0; i < frames; i++) {
  setKeysDown(i % 60 < 30 ? [39] : [37]);
  tick();
}
const elapsed = performance.now() - start;
const fps = (frames / elapsed) * 1000;

console.log('Pure tick() benchmark (render only, no obs extraction):');
console.log('  Frames: ' + frames);
console.log('  Elapsed: ' + elapsed.toFixed(1) + ' ms');
console.log('  Per frame: ' + (elapsed / frames).toFixed(3) + ' ms');
console.log('  FPS: ' + fps.toFixed(0));
console.log('');
console.log('  Compare to browser rAF max: 60 FPS');
console.log('  Speedup vs rAF ceiling: ' + (fps / 60).toFixed(0) + 'x');
