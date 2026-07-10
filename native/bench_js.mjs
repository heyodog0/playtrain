// bench_js.mjs — V8-side throughput for apples-to-apples comparison with the
// native twin's `bench` mode (same env, obs, action formula, auto-reset).
//   node bench_js.mjs <game> <nsteps>
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameEnv } from '../runtime/p5/game-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const game = process.argv[2] || 'bigfish';
const nsteps = process.argv[3] !== undefined ? Number(process.argv[3]) : 500000;
const actionAt = (i) => (i * 3 + 1) % 8;

const gamePath = join(__dirname, '..', 'examples', 'games', 'js', `${game}.js`);
const env = new GameEnv({ gamePath, obsWidth: 64, obsHeight: 64, obsMode: 'rgb', maxSteps: 2000, frameSkip: 1 });

env.reset({ seed: 1 });
// warmup
for (let i = 0; i < 20000; i++) { const s = env.step(actionAt(i)); if (s.terminated || s.truncated) env.reset({ seed: 2 }); }

let rs = 2;
const t0 = process.hrtime.bigint();
for (let i = 0; i < nsteps; i++) {
  const s = env.step(actionAt(i));
  if (s.terminated || s.truncated) env.reset({ seed: rs++ });
}
const t1 = process.hrtime.bigint();
const secs = Number(t1 - t0) / 1e9;
console.log(`bench(js): ${nsteps} steps in ${secs.toFixed(4)}s = ${Math.round(nsteps / secs)} steps/sec`);
env.close();
