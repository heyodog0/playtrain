// reference_trace.mjs — the V8 side of the differential bit-exact gate.
// Runs the REAL PlayTrain JS env (wasm rasterizer, same as production) on the
// same seed + same deterministic action formula as the native hosts, and
// emits an identically-formatted trace. Compare with `native/build/<game> trace`.
//
//   node reference_trace.mjs <game_basename> <seed> <nsteps>
//
// A bare <game_basename> resolves against $PLAYTRAIN_GAMES_DIR, falling back to
// the bundled examples/games/js — the same precedence the Python runtime uses
// (_resolve_games_dir in src/playtrain/runtime/native_vec_env.py). That lets the
// gate cover consumer-repo games (e.g. ../a consumer repo/games/js) without symlinking
// them in. An argument ending in .js is used as a path verbatim.
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
// PLAYTRAIN_ACTION_SPACE (name / .json path) selects a non-default space so a
// custom space can be differentially gated too; qjs_host takes the same table
// via PLAYTRAIN_QJS_ACTIONS. Unset = default8, formula unchanged (% 8).
// PLAYTRAIN_INPUT_MAP (a box-space name or JSON channel array) switches to the
// quantized box path — compare with `qjs_host <game> traceq` under
// PLAYTRAIN_QJS_INPUT_MAP. The wire-value formula MUST match q_at there.
const actionSpace = process.env.PLAYTRAIN_ACTION_SPACE || null;
const inputMap = process.env.PLAYTRAIN_INPUT_MAP || null;
const qActionAt = (i, j) => (Math.imul(i * 33 + j + 1, 2654435761) >>> 16) & 0xFFFF;

const gamesDir = process.env.PLAYTRAIN_GAMES_DIR
  || join(__dirname, '..', 'examples', 'games', 'js');
const gamePath = game.endsWith('.js') ? game : join(gamesDir, `${game}.js`);
const env = new GameEnv({ gamePath, obsWidth: 64, obsHeight: 64, obsMode: 'rgb', maxSteps: 100000, frameSkip: 1, actions: actionSpace, inputMap });
const actionAt = (i) => (i * 3 + 1) % env.actions.length;

let r = env.reset({ seed });
console.log(`reset seed=${seed} score=${r.info.score} lives=${r.info.lives} state=${r.info.gameState} obshash=${fnv1a(r.observation)}`);

for (let i = 0; i < nsteps; i++) {
  let s, alabel;
  if (inputMap) {
    const q = env.inputMap.map((_, j) => qActionAt(i, j));
    s = env.stepQ(q);
    alabel = `q=${q.join(',')}`;
  } else {
    const a = actionAt(i);
    s = env.step(a);
    alabel = `a=${a}`;
  }
  console.log(`${i} ${alabel} reward=${s.reward} term=${s.terminated ? 1 : 0} trunc=${s.truncated ? 1 : 0} score=${s.info.score} lives=${s.info.lives} state=${s.info.gameState} obshash=${fnv1a(s.observation)}`);
  if (s.terminated || s.truncated) { env.reset({ seed: (seed + i + 1) >>> 0 }); }
}
env.close();
