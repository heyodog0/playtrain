// Render sampled frames from a generated p5 game via PlayTrain's GameEnv.
// Invoked by tools/refine_vs_rom.py. Reads a JSON config:
//   { gamePath, outDir, seed, res, ticks:[int], actions:[int] }
// Writes <outDir>/clone_f<tick>.png for each tick.
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const here = dirname(fileURLToPath(import.meta.url));          // PlayTrain/tools
const REPO_ROOT = resolve(here, '..');                        // PlayTrain root

const { GameEnv } = await import(join(REPO_ROOT, 'runtime/p5/game-env.mjs'));
const { createCanvas } = await import(join(REPO_ROOT, 'node_modules/canvas/index.js'));

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const RES = cfg.res || 400;
const ticks = new Set(cfg.ticks);

const env = new GameEnv({ gamePath: cfg.gamePath, obsWidth: RES, obsHeight: RES, obsMode: 'rgb', maxSteps: 100000, frameSkip: 1 });
env.reset({ seed: cfg.seed });

for (let t = 0; t < cfg.actions.length; t++) {
  const s = env.step(cfg.actions[t]);
  if (ticks.has(t)) {
    const o = s.observation;
    const cv = createCanvas(RES, RES); const cx = cv.getContext('2d');
    const img = cx.createImageData(RES, RES);
    for (let i = 0; i < RES * RES; i++) { img.data[i*4]=o[i*3]; img.data[i*4+1]=o[i*3+1]; img.data[i*4+2]=o[i*3+2]; img.data[i*4+3]=255; }
    cx.putImageData(img, 0, 0);
    writeFileSync(join(cfg.outDir, `clone_f${t}.png`), cv.toBuffer('image/png'));
  }
  if (s.terminated || s.truncated) env.reset({ seed: cfg.seed });
}
env.close();
console.log('rendered clone frames:', cfg.ticks.join(','));
