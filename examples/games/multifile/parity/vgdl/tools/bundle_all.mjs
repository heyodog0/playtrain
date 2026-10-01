#!/usr/bin/env node
// Rebuild every bundle in dist/ from manifest.json's corpora (tiles render, seed-picked level, sidecars).
//   node tools/bundle_all.mjs [--check]     (--check: fail if any committed bundle differs)
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const check = process.argv.includes('--check');
const outDir = check ? '/tmp/vgdl_bundle_check' : join(ROOT, 'dist');
if (check) { rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); }
const built = [];
for (const [corpus, c] of Object.entries(manifest.corpora)) {
  for (const game of c.games) {
    const out = join(outDir, `vgdl_${game}.js`);
    execFileSync('node', [join(HERE, 'bundle_vgdl.mjs'), corpus, game, '--block', String(c.block_size), '--render', 'tiles', '--sidecar', '--out', out], { stdio: 'pipe' });
    built.push(`vgdl_${game}`);
  }
}
if (check) {
  let stale = 0;
  for (const n of built) for (const ext of ['.js', '.json']) {
    const a = join(outDir, n + ext), b = join(ROOT, 'dist', n + ext);
    if (!existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')) { console.log('stale: dist/' + n + ext); stale++; }
  }
  const extra = readdirSync(join(ROOT, 'dist')).filter(f => !built.some(n => f === n + '.js' || f === n + '.json'));
  for (const f of extra) { console.log('unexpected in dist/: ' + f); stale++; }
  if (stale) { console.log(`${stale} stale; run node tools/bundle_all.mjs`); process.exit(1); }
  console.log(`dist/ fresh (${built.length} games)`);
} else console.log(`built ${built.length} games into dist/`);
