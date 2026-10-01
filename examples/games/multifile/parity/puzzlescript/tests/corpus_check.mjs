// G2: every bundle compiles its game with zero errors, reports the manifest's playable levels, loads a level for
// three seeds and steps without throwing. Run: node tests/corpus_check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
let bad = 0, n = 0;
for (const f of readdirSync(join(ROOT, 'dist')).filter(f => f.endsWith('.js')).sort()) {
  const game = f.slice(3, -3); n++;
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx);
  const t0 = Date.now();
  try {
    vm.runInContext(readFileSync(join(ROOT, 'dist', f), 'utf8'), ctx, { filename: f });
    ctx.setup();
    const tc = Date.now() - t0;
    const errs = ctx.__ps.compileErrors(), playable = ctx.__ps.playable(), want = manifest.corpus.games[game].playable_levels;
    let steps = 0, wins = 0;
    for (const seed of [1, 2, 3]) {
      ctx.resetGame(seed);
      const s0 = ctx.__ps.snap();
      if (!(s0.width > 0 && s0.height > 0)) throw new Error('no level loaded');
      for (let k = 0; k < 40 && ctx.getGameState().gameState === 'PLAYING'; k++) { ctx.draw(); ctx.__ps.step(k % 6); steps++; }
      if (ctx.getGameState().gameState === 'WIN') wins++;
    }
    const ok = errs === 0 && JSON.stringify(playable) === JSON.stringify(want);
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${f}: compile ${tc} ms, errors ${errs}, playable ${playable.length} (manifest ${want.length}), ${steps} steps, ${wins} early wins`);
  } catch (e) { bad++; console.log(`FAIL ${f}: ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); }
}
console.log(`${n - bad}/${n} bundles ok`);
process.exit(bad ? 1 : 0);
