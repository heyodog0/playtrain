// In-page game player for the project site.
//
// This file is the second half of site/player.js: tools/build-embed.mjs prepends
// PlayTrain's browser shim bundle (runtime/p5/raster.mjs + p5-shim.mjs, the same
// bundle the standalone tester inlines) and appends this controller, so the
// module below can call installGlobals / tick / getPixelData directly.
//
// Why a controller instead of an <iframe> per game:
//   - keyboard. The parent page owns keydown/keyup, so arrow keys reach the game
//     without the reader having to find and focus a nested document, and we can
//     preventDefault to stop the page scrolling out from under them.
//   - switching games costs a fetch, not a document load.
//
// Games are ordinary p5 sketches whose top level is `let score, lives, ...`.
// Evaluating two of them in the same global lexical scope would throw
// ("Identifier 'score' has already been declared"), so each game source is
// wrapped in `new Function` — its declarations become locals of that call, and
// the entry points come back as values we hang on globalThis for the shim to
// find. Switching games therefore cannot leak state between them.

const KEYS = [32, 37, 38, 39, 40, 65, 66, 68, 83, 87];   // space, arrows, wasd/ab/d
const FRAME_MS = 1000 / 60;
const OBS = 64;

const el = (id) => document.getElementById(id);
const view = el('pt-view');
const obs = el('pt-obs');
const overlay = el('pt-overlay');
const hud = el('pt-hud');
const nameOut = el('pt-name');

if (view) boot();

function boot() {
  const vctx = view.getContext('2d');
  const octx = obs.getContext('2d');
  octx.imageSmoothingEnabled = false;

  let current = null;      // game name
  let seed = 0;
  let active = false;      // is the player capturing keys and running?
  let ready = false;       // has a game been loaded at least once?
  const held = new Set();
  const pressed = new Set();

  installGlobals();

  // ---- loading a game -------------------------------------------------

  async function load(name) {
    let src;
    try {
      const res = await fetch(`games/${name}.js`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      src = await res.text();
    } catch (err) {
      hud.textContent = `could not load ${name}`;
      return;
    }

    // Entry points come back by value; anything else the game declares stays
    // local to this call and is collected when we load the next one.
    const factory = new Function(`${src}
;return {
  setup:        typeof setup        === 'function' ? setup        : null,
  draw:         typeof draw         === 'function' ? draw         : null,
  resetGame:    typeof resetGame    === 'function' ? resetGame    : null,
  getGameState: typeof getGameState === 'function' ? getGameState : null,
  keyPressed:   typeof keyPressed   === 'function' ? keyPressed   : null,
  mousePressed: typeof mousePressed === 'function' ? mousePressed : null,
};`);

    let g;
    try {
      g = factory();
    } catch (err) {
      hud.textContent = `${name} failed to load`;
      return;
    }

    // The shim reaches the game through these three globals, exactly as the
    // headless runtime does.
    globalThis.draw = g.draw;
    globalThis.keyPressed = g.keyPressed;
    globalThis.mousePressed = g.mousePressed;
    globalThis.getGameState = g.getGameState;

    current = name;
    nameOut.textContent = name;
    if (g.setup) g.setup();
    resetFrameCount();
    if (g.resetGame) g.resetGame(seed);
    if (typeof globalThis.loop === 'function') globalThis.loop();

    // Match the canvas element to whatever the game asked createCanvas for.
    const p = getPixelData();
    view.width = p.width;
    view.height = p.height;

    ready = true;
    document.querySelectorAll('[data-game]').forEach((b) => {
      b.classList.toggle('on', b.dataset.game === name);
    });
    render();
    if (!active) requestAnimationFrame(step);   // draw one frame, then idle
  }

  // ---- the loop -------------------------------------------------------

  function render() {
    const p = getPixelData();
    vctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
    octx.drawImage(view, 0, 0, OBS, OBS);
    if (typeof globalThis.getGameState === 'function') {
      try {
        const s = globalThis.getGameState();
        const parts = [];
        if ('score' in s) parts.push(`score ${s.score}`);
        if ('lives' in s) parts.push(`lives ${s.lives}`);
        parts.push(`seed ${seed}`);
        hud.textContent = parts.join('   ');
      } catch (err) { /* a game mid-reset can throw; the next frame is fine */ }
    }
  }

  let last = 0;
  function step(now) {
    if (active) requestAnimationFrame(step);
    if (now - last < FRAME_MS - 0.5) return;
    last = now;
    setKeysDown(Array.from(held));
    pressed.forEach((c) => simulateKeyPress(c));
    pressed.clear();
    tick();
    render();
  }

  // ---- activation -----------------------------------------------------
  // Keys are captured only while the player is running, so arrow keys scroll
  // the page normally everywhere else on it.

  function start() {
    if (!ready || active) return;
    active = true;
    overlay.hidden = true;
    view.parentElement.classList.add('live');
    last = 0;
    requestAnimationFrame(step);
  }

  function stop() {
    if (!active) return;
    active = false;
    held.clear();
    pressed.clear();
    setKeysDown([]);
    overlay.hidden = false;
    view.parentElement.classList.remove('live');
  }

  overlay.addEventListener('click', start);
  view.addEventListener('click', start);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { stop(); return; }
    if (!active) return;
    if (KEYS.includes(e.keyCode)) {
      e.preventDefault();
      if (!held.has(e.keyCode)) pressed.add(e.keyCode);
      held.add(e.keyCode);
    }
  }, { passive: false });

  addEventListener('keyup', (e) => { held.delete(e.keyCode); });
  addEventListener('blur', stop);

  // Pause when scrolled away, so a page left open is not burning a core.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const entry of entries) if (!entry.isIntersecting) stop();
    }, { threshold: 0.25 }).observe(view.parentElement);
  }

  // ---- game pickers ---------------------------------------------------

  fetch('games/index.json')
    .then((r) => r.json())
    .then((games) => {
      const chips = el('pt-chips');
      const filter = el('pt-filter');
      const count = el('pt-count');
      const preferred = 'bigfish';

      const button = (name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.dataset.game = name;
        b.textContent = name;
        b.addEventListener('click', () => {
          stop();
          load(name).then(() => {
            view.scrollIntoView({ block: 'center', behavior: 'smooth' });
            start();
          });
        });
        return b;
      };

      if (count) count.textContent = String(games.length);
      if (chips) games.forEach((g) => chips.append(button(g)));
      if (filter && chips) {
        filter.addEventListener('input', () => {
          const query = filter.value.trim().toLowerCase();
          chips.querySelectorAll('[data-game]').forEach((b) => {
            b.hidden = query !== '' && !b.dataset.game.toLowerCase().includes(query);
          });
        });
      }
      return load(games.includes(preferred) ? preferred : games[0]);
    })
    .catch(() => { hud.textContent = 'game list unavailable'; });

  // Reset re-runs the current game on the next seed. Reloading the source is
  // the same code path as a fresh load, so no state can survive it.
  el('pt-reset').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (!current) return;
    seed = (seed + 1) >>> 0;
    load(current);
  });
}
