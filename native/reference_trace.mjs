// reference_trace.mjs — the V8 side of the differential bit-exact gate.
// Runs the REAL PlayTrain JS env (wasm rasterizer, same as production) on the
// same seed + same deterministic action formula as native/runtime/main.cpp, and
// emits an identically-formatted trace. Compare with `native/build/<game> trace`.
//
//   node reference_trace.mjs <game_basename> <seed> <nsteps>
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameEnv } from '../runtime/p5/game-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const game = process.argv[2] || 'bigfish';
const seed = (process.argv[3] !== undefined ? Number(process.argv[3]) : 12345) >>> 0;
const nsteps = process.argv[4] !== undefined ? Number(process.argv[4]) : 300;

const MASK = (1n << 64n) - 1n;
function fnv1a(bytes) {
  let h = 1469598103934665603n;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ BigInt(bytes[i])) & MASK;
    h = (h * 1099511628211n) & MASK;
  }
  return h;
}
const actionAt = (i) => (i * 3 + 1) % 8;

const gamePath = join(__dirname, '..', 'examples', 'games', 'js', `${game}.js`);
const env = new GameEnv({ gamePath, obsWidth: 64, obsHeight: 64, obsMode: 'rgb', maxSteps: 100000, frameSkip: 1 });

let r = env.reset({ seed });
console.log(`reset seed=${seed} score=${r.info.score} lives=${r.info.lives} state=${r.info.gameState} obshash=${fnv1a(r.observation)}`);

for (let i = 0; i < nsteps; i++) {
  const a = actionAt(i);
  const s = env.step(a);
  console.log(`${i} a=${a} reward=${s.reward} term=${s.terminated ? 1 : 0} trunc=${s.truncated ? 1 : 0} score=${s.info.score} lives=${s.info.lives} state=${s.info.gameState} obshash=${fnv1a(s.observation)}`);
  if (s.terminated || s.truncated) { env.reset({ seed: (seed + i + 1) >>> 0 }); }
}
env.close();
