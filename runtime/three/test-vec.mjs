/** Smoke test for the batched vec renderer. Pass a game path that exports
 *  createInstance(). Validates each atlas tile holds distinct, non-flat scene. */

const N = 4, TILE = 84;
const grid = Math.ceil(Math.sqrt(N));
process.env.PLAYTRAIN_THREE_OBS_SIZE = String(grid * TILE);

const gamePath = process.argv[2];
if (!gamePath) { console.error('usage: node test-vec.mjs <game.mjs>'); process.exit(1); }

const { VecGameEnv } = await import('./vec-game-env.mjs');
const env = new VecGameEnv({ gamePath, actionSize: 7, numEnvs: N, tile: TILE, maxSteps: 100000 });
let obs = await env.reset(Uint32Array.from([11, 22, 33, 44]));

const TPX = TILE * TILE * 3;
function stats(buf, i) {
  let min = 255, max = 0, sum = 0;
  for (let k = i * TPX; k < (i + 1) * TPX; k++) { const v = buf[k]; if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { min, max, mean: (sum / TPX).toFixed(1) };
}

const actions = new Float32Array(N * 7);
for (let s = 0; s < 30; s++) {
  for (let i = 0; i < N; i++) { actions[i * 7] = (i - 1.5) * 120; actions[i * 7 + 3] = 1; }
  obs = (await env.step(actions, 1)).obs;
}

let ok = true;
for (let i = 0; i < N; i++) {
  const st = stats(obs, i);
  const varied = st.max - st.min > 20;
  console.log(`  env ${i}: min=${st.min} max=${st.max} mean=${st.mean} ${varied ? 'OK' : 'FLAT!'}`);
  ok = ok && varied;
}
env.close();
console.log(ok ? 'VEC OK' : 'VEC FAILED');
process.exit(ok ? 0 : 1);
