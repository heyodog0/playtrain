#!/usr/bin/env node
// twin_spec.mjs — program-as-data for the native twin: run the JS parser (src/20_parser.js) on every corpus game and
// write twin/<corpus>/<game>.json = { corpus, game, block_size, profile, spec, levels, groupOrder }. The twin loads
// this instead of parsing VGDL text. `--check` fails if any committed file differs from a fresh run.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const check = process.argv.includes('--check');
const ctx = { console }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'src', '20_parser.js'), 'utf8'), ctx, { filename: '20_parser.js' });
let stale = 0, n = 0;
for (const [corpus, c] of Object.entries(manifest.corpora)) {
  const gdir = join(ROOT, 'games', corpus), odir = join(ROOT, 'twin', corpus);
  if (!check) mkdirSync(odir, { recursive: true });
  for (const game of c.games) {
    const text = readFileSync(join(gdir, game + '.txt'), 'utf8');
    const lvlFiles = readdirSync(gdir).filter(f => f.startsWith(game + '_lvl') && f.endsWith('.txt')).sort((a, b) => parseInt(a.match(/_lvl(\d+)/)[1], 10) - parseInt(b.match(/_lvl(\d+)/)[1], 10));
    const levels = lvlFiles.map(f => readFileSync(join(gdir, f), 'utf8'));
    ctx.__text = text;
    const spec = vm.runInContext('(function(){ const s = vgParse(__text); return { header: s.header, defs: s.defs, keys: s.keys, charMap: s.charMap, interactions: s.interactions, terminations: s.terminations, singletons: Array.from(s.singletons) }; })()', ctx);
    const gfile = join(gdir, game + '.groups.json');
    const out = { corpus, game, block_size: c.block_size, profile: corpus === 'vgfmri_rcrl' ? 'rcrl' : 'colas', spec, levels, groupOrder: existsSync(gfile) ? JSON.parse(readFileSync(gfile, 'utf8')) : null };
    const text2 = JSON.stringify(out) + '\n', dest = join(odir, game + '.json');
    n++;
    if (check) { if (!existsSync(dest) || readFileSync(dest, 'utf8') !== text2) { console.log('stale: twin/' + corpus + '/' + game + '.json'); stale++; } }
    else writeFileSync(dest, text2);
  }
}
if (check) { if (stale) { console.log(`${stale} stale; run node tools/twin_spec.mjs`); process.exit(1); } console.log(`twin/ fresh (${n} games)`); }
else console.log(`wrote ${n} spec files under twin/`);
