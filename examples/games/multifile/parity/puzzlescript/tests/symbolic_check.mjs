// getObservation() == multihot of level.objects, every game, 3 seeds x 30 random steps.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
let bad = 0, n = 0;
for (const f of readdirSync(join(ROOT, 'dist')).filter(f => f.endsWith('.js')).sort()) {
  n++;
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, 'dist', f), 'utf8'), ctx, { filename: f }); ctx.setup();
  const side = JSON.parse(readFileSync(join(ROOT, 'dist', f.replace(/\.js$/, '.json')), 'utf8'));
  let err = null;
  for (let seed = 1; seed <= 3 && !err; seed++) {
    ctx.__ps.reset(seed);
    for (let k = 0; k < 30 && !err; k++) {
      if (k) ctx.__ps.step(k % 6);
      const o = ctx.getObservation(); const S = ctx.__ps.def().symbolic;
      if (o.length !== side.obs.symbolic) { err = `dim ${o.length} vs sidecar ${side.obs.symbolic}`; break; }
      const want = vm.runInContext(`(function(){ const out = new Float32Array(${S.dim}); for (let x = 0; x < level.width; x++) for (let y = 0; y < level.height; y++) { const c = level.getCell(y + x * level.height); for (let kk = 0; kk < state.objectCount; kk++) if (c.get(kk)) out[(kk * ${S.max_height} + y) * ${S.max_width} + x] = 1; } return Array.from(out); })()`, ctx);
      for (let i = 0; i < o.length; i++) if (o[i] !== want[i]) { err = `seed${seed} step${k} index ${i}: ${o[i]} vs ${want[i]}`; break; }
    }
  }
  if (err) { bad++; console.log(`❌ ${f}: ${err}`); }
}
console.log(`${n - bad}/${n} games ok`); process.exit(bad ? 1 : 0);
