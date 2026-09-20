#!/usr/bin/env node
// G8 render gate: the reference's own graphics.js redraw(), run against a recording 2D context, vs the prelude's
// tile list. For every bundle: 10 seeds x 20 random steps = 200 states (plus the reset states); at each, redraw()'s
// drawImage calls are decoded to (cell, ordered sprite ids) and compared with __ps.tiles() (cell -> atlas key), and
// the viewport (mini, minj, maxi, maxj) is compared.
//   node tests/render_gate.mjs [game[,game..]] [--seeds N] [--steps N]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const NSEEDS = parseInt(opt('seeds', '10'), 10), NSTEPS = parseInt(opt('steps', '20'), 10);
const games = positional.length ? positional.join(',').split(',') : readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const GRAPHICS = readFileSync(join(ROOT, 'reference', 'js', 'graphics.js'), 'utf8');
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }

// A document whose canvases record drawImage calls; everything else on a context is a no-op.
function makeDocument(rec) {
  const noop = () => {};
  const mkCtx = (owner) => new Proxy({}, { get(_, k) {
    if (k === 'drawImage') return (img, x, y) => { if (owner.isMain) rec.push([img, x, y]); };
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'measureText') return () => ({ width: 0 });
    return noop; }, set() { return true; } });
  const mkCanvas = (isMain) => { const c = { isMain, width: 0, height: 0, style: {}, parentNode: { clientWidth: 0, clientHeight: 0 }, setAttribute: noop, removeAttribute: noop, focus: noop, blur: noop, addEventListener: noop, removeEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }; c.getContext = () => mkCtx(c); return c; };
  const main = mkCanvas(true);
  return { main, document: { URL: 'render-gate://', title: '', body: { classList: { contains: () => false }, addEventListener: noop, removeEventListener: noop, style: {} },
    createElement: (tag) => tag === 'canvas' ? mkCanvas(false) : { style: {}, innerHTML: '', textContent: '', getContext: () => null },
    getElementById: (id) => id === 'gameCanvas' ? main : null, getElementsByTagName: () => [] } };
}

let bad = 0, total = 0, states = 0;
for (const game of games) {
  const rec = []; const { main, document } = makeDocument(rec);
  const ctx = { console, document, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'dist', `ps_${game}.js`), 'utf8'), ctx, { filename: `ps_${game}.js` });
  vm.runInContext(GRAPHICS, ctx, { filename: 'graphics.js' });          // the reference renderer, after the bundle
  ctx.setup();
  let gameBad = 0, gameStates = 0;
  const check = (seed, step) => {
    gameStates++; states++;
    // reference: size the fake canvas to 5 px per screen cell so cellwidth = cellheight = 5 exactly, then redraw
    const meta = vm.runInContext('state.metadata', ctx);
    const scr = meta.flickscreen || meta.zoomscreen || [vm.runInContext('level.width', ctx), vm.runInContext('level.height', ctx)];
    main.parentNode.clientWidth = scr[0] * 5; main.parentNode.clientHeight = scr[1] * 5;
    vm.runInContext('spriteimages = undefined; canvasResize();', ctx);   // canvasResize() ends with its own redraw()
    rec.length = 0;                                   // drop that and any draws the engine issued during reset / the turn
    vm.runInContext('redraw();', ctx);
    const cd = vm.runInContext('canvasdict', ctx), xo = vm.runInContext('xoffset', ctx), yo = vm.runInContext('yoffset', ctx), cw = vm.runInContext('cellwidth', ctx), ch = vm.runInContext('cellheight', ctx);
    const nameOf = new Map(Object.entries(cd).map(([n, c]) => [c, n]));
    const ref = {};
    for (const [img, x, y] of rec.splice(0)) {
      const n = nameOf.get(img); if (n === undefined || !/^\d+$/.test(n)) continue;
      const key = `${Math.round((x - xo) / cw)},${Math.round((y - yo) / ch)}`;
      (ref[key] = ref[key] || []).push(parseInt(n, 10));
    }
    const refView = vm.runInContext('(state.metadata.flickscreen !== undefined || state.metadata.zoomscreen !== undefined) ? oldflickscreendat.slice() : [0, 0, level.width, level.height]', ctx);
    // prelude
    const t = ctx.__ps.tiles();
    const mine = {};
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) { const k = t.keys[t.kinds[j * t.w + i]]; mine[`${i},${j}`] = k === '' ? [] : k.split(',').map(Number); }
    let diff = null;
    if (JSON.stringify(refView) !== JSON.stringify(t.viewport)) diff = `viewport ref ${JSON.stringify(refView)} vs ${JSON.stringify(t.viewport)}`;
    else {
      const keys = new Set([...Object.keys(ref), ...Object.keys(mine)]);
      for (const k of keys) { const a = JSON.stringify(ref[k] || []), b = JSON.stringify(mine[k] || []); if (a !== b) { diff = `cell ${k}: ref ${a} vs ${b}`; break; } }
    }
    if (diff) { gameBad++; bad++; if (gameBad <= 3) console.log(`   ❌ ${game} seed${seed} step${step}: ${diff}`); }
  };
  for (let s = 1; s <= NSEEDS; s++) {
    const rnd = lcg(s * 7919 + 17);
    ctx.__ps.reset(s); check(s, 0);
    for (let k = 1; k <= NSTEPS; k++) { if (ctx.__ps.snap().winning) break; ctx.__ps.step(rnd() % 6); check(s, k); }
  }
  total++;
  console.log(`${gameBad ? '❌' : '✅'} ${game}: ${gameStates} states, ${gameBad} draw-list mismatches`);
}
console.log(`${total - (bad ? 1 : 0) >= 0 ? '' : ''}${states} states checked, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
