/** In-process batched-renderer throughput. One N per process (shim size is
 *  fixed at import). Usage: node bench-vec.mjs <N> <game.mjs> [numSteps] */
const N = parseInt(process.argv[2] || '4', 10);
const gamePath = process.argv[3];
const numSteps = parseInt(process.argv[4] || '1', 10);
const TILE = 84;
const grid = Math.ceil(Math.sqrt(N));
process.env.NODE_GYM_THREE_OBS_SIZE = String(grid * TILE);

const { VecGameEnv } = await import('./vec-game-env.mjs');
const env = new VecGameEnv({ gamePath, actionSize: 7, numEnvs: N, tile: TILE, maxSteps: 1e9 });
const seeds = Uint32Array.from({ length: N }, (_, i) => i + 1);
await env.reset(seeds);

const actions = new Float32Array(N * 7);
for (let i = 0; i < N; i++) actions[i * 7 + 3] = 1; // forward

for (let i = 0; i < 40; i++) await env.step(actions, numSteps);  // warmup

const M = 600;
const t0 = performance.now();
for (let i = 0; i < M; i++) await env.step(actions, numSteps);
const wall = (performance.now() - t0) / 1000;
env.close();

const aggSteps = (N * M) / wall;
const msPerStep = (wall / M) * 1000;
console.log(`N=${String(N).padStart(2)} atlas=${grid * TILE}px  agg=${aggSteps.toFixed(0).padStart(6)} steps/s  `
  + `frames/s=${(aggSteps * numSteps).toFixed(0).padStart(7)}  step=${msPerStep.toFixed(3)}ms  per-env=${(msPerStep / N).toFixed(4)}ms`);
process.exit(0);  // Dawn keeps the event loop alive otherwise
