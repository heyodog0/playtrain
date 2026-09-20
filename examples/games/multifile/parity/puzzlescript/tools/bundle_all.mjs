#!/usr/bin/env node
// Rebuild every bundle in dist/ from games/*.json (with sidecars).
//   node tools/bundle_all.mjs [--check]     (--check: fail if any committed bundle differs)
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const check = process.argv.includes('--check');
const outDir = check ? join(tmpdir(), 'puzzlescript_bundle_check') : join(ROOT, 'dist');
if (check) { rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); }
const games = readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const built = [];
for (const game of games) { execFileSync('node', [join(HERE, 'bundle_puzzlescript.mjs'), game, '--sidecar', '--out', join(outDir, `ps_${game}.js`)], { stdio: 'pipe' }); built.push(`ps_${game}`); }
if (check) {
  let stale = 0;
  for (const n of built) for (const ext of ['.js', '.json']) {
    const a = join(outDir, n + ext), b = join(ROOT, 'dist', n + ext);
    if (!existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')) { console.log('stale: dist/' + n + ext); stale++; }
  }
  const extra = existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')).filter(f => !built.some(n => f === n + '.js' || f === n + '.json')) : [];
  for (const f of extra) { console.log('unexpected in dist/: ' + f); stale++; }
  if (stale) { console.log(`${stale} stale; run node tools/bundle_all.mjs`); process.exit(1); }
  console.log(`dist/ fresh (${built.length} games)`);
} else console.log(`built ${built.length} games into dist/`);
