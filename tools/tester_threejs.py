"""Browser tester + refiner for Three.js (v2) generated games.

Mirror of tools/tester.py for the v2 path:
- Sidebar lists games in games/threejs/
- Iframe stage, big-screen toggle, score/state HUD overlay
- Console panel captures iframe console.log/warn/error
- Bottom bar: model selector + feedback input + Refine button (SSE streaming)
- Version bar: browse + restore backups in games/backups/

Run:  uv run python tools/tester_threejs.py [--port 3001]
Or:   just tester-three
"""

from __future__ import annotations

import argparse
import json
import queue
import socketserver
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

if __package__:
    from .refine_threejs import refine_game
else:
    from refine_threejs import refine_game

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / "games"
THREEJS_DIR = GAMES_DIR / "threejs"
BACKUPS_DIR = GAMES_DIR / "backups"


def list_games() -> list[str]:
    if not THREEJS_DIR.exists():
        return []
    return sorted(p.stem for p in THREEJS_DIR.glob("*.js"))


def list_backups(name: str) -> list[str]:
    if not BACKUPS_DIR.exists():
        return []
    files = sorted(BACKUPS_DIR.glob(f"{name}_*.js"), reverse=True)
    return [f.name for f in files]


# -- HTML templates -----------------------------------------------------------

TESTER_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Three.js Game Tester (v2)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --stage-width: 540px; --stage-height: 540px; }
  body { font-family: monospace; background: #111; color: #eee; height: 100vh; display: flex; flex-direction: column; }
  #top { display: flex; flex: 1; min-height: 0; }
  #sidebar { width: 200px; background: #1a1a1a; border-right: 1px solid #333; overflow-y: auto; padding: 8px; }
  #sidebar h3 { font-size: 12px; color: #888; margin-bottom: 8px; }
  #sidebar .empty { color: #666; font-size: 11px; line-height: 1.5; padding: 4px 8px; }
  .game-btn { display: block; width: 100%; text-align: left; background: none; border: 1px solid transparent;
    color: #ccc; padding: 6px 8px; cursor: pointer; font-family: monospace; font-size: 12px; margin-bottom: 2px; }
  .game-btn:hover { background: #252525; }
  .game-btn.active { background: #333; color: #fff; border-color: #555; }
  #main { flex: 1; position: relative; display: flex; justify-content: center; align-items: center; background: #0a0a0a; overflow: auto; }
  #stage { width: var(--stage-width); height: var(--stage-height); border: 1px solid #2d2d2d; border-radius: 18px;
    overflow: hidden; background: #000; box-shadow: 0 24px 70px rgba(0,0,0,0.45); transition: width 160ms ease, height 160ms ease, box-shadow 160ms ease; }
  #main iframe { border: none; width: 100%; height: 100%; }
  #main.large-view { --stage-width: min(860px, calc(100% - 32px)); --stage-height: min(900px, calc(100% - 32px)); }
  #main.large-view #stage { box-shadow: 0 30px 90px rgba(0,0,0,0.6); }
  #console { width: 280px; flex-shrink: 0; background: #111; border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; font-family: monospace; font-size: 11px; }
  #console-header { padding: 5px 10px; color: #555; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; font-size: 11px; }
  #console-header button { background: none; border: 1px solid #2a2a2a; color: #555; padding: 1px 8px; cursor: pointer; font: 11px monospace; border-radius: 3px; }
  #console-header button:hover { color: #aaa; border-color: #555; }
  #console-output { flex: 1; overflow-y: auto; padding: 2px 0; }
  .con-line { padding: 2px 8px; word-break: break-all; white-space: pre-wrap; color: #666; border-bottom: 1px solid #181818; line-height: 1.4; }
  .con-log { color: #aaa; }
  .con-warn { color: #e94; }
  .con-error { color: #e55; }
  .con-stream { color: #5a8; font-size: 10px; opacity: 0.8; }
  #view-toggle { position: absolute; top: 14px; right: 16px; border: 1px solid #3d3d3d; background: rgba(20,20,20,0.92);
    color: #d7d7d7; border-radius: 999px; padding: 8px 14px; cursor: pointer; font-family: monospace; font-size: 12px;
    letter-spacing: 0.02em; transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease; }
  #view-toggle:hover { background: rgba(36,36,36,0.96); border-color: #5a5a5a; color: #fff; transform: translateY(-1px); }
  #view-toggle.active { background: #d9efe4; color: #0f291d; border-color: #d9efe4; }
  #empty { color: #555; font-size: 14px; }
  #bottom { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1a1a1a; border-top: 1px solid #333; }
  #bottom select { background: #222; color: #eee; border: 1px solid #444; padding: 6px; font-family: monospace; }
  #bottom input { flex: 1; background: #222; color: #eee; border: 1px solid #444; padding: 6px 10px; font-family: monospace; }
  #bottom button { background: #2a6; color: #fff; border: none; padding: 6px 16px; cursor: pointer; font-family: monospace; }
  #bottom button:disabled { background: #444; cursor: not-allowed; }
  #status { color: #888; font-size: 11px; min-width: 100px; }
  #version-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #161616; border-top: 1px solid #2a2a2a; font-family: monospace; font-size: 12px; color: #888; }
  #version-bar.hidden { display: none; }
  #version-select { background: #222; color: #eee; border: 1px solid #444; padding: 4px 6px; font-family: monospace; font-size: 12px; }
  #restore-btn { background: #555; color: #eee; border: none; padding: 4px 12px; cursor: pointer; font-family: monospace; font-size: 12px; }
  #restore-btn:hover { background: #e94; color: #fff; }
  #restore-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
</style>
</head>
<body>
<div id="top">
  <div id="sidebar"><h3>Three.js games (v2)</h3><div id="game-list"></div></div>
  <div id="main">
    <button id="view-toggle" onclick="toggleBigScreen()" disabled>Big Screen</button>
    <span id="empty">Select a game</span>
  </div>
  <div id="console">
    <div id="console-header"><span>Console</span><button onclick="clearConsole()">Clear</button></div>
    <div id="console-output"></div>
  </div>
</div>
<div id="version-bar" class="hidden">
  <span>Version:</span>
  <select id="version-select" onchange="switchVersion(this.value)"></select>
  <button id="restore-btn" onclick="restoreBackup()" disabled>Restore</button>
</div>
<div id="bottom">
  <select id="model"><option value="flash">Flash</option><option value="pro">Pro</option></select>
  <input id="feedback" type="text" placeholder="Feedback for refinement..." disabled>
  <button id="refine-btn" onclick="refine()" disabled>Refine</button>
  <span id="status">Ready</span>
</div>
<script>
let currentGame = null;
let bigScreen = false;
let currentBackup = null;

async function loadGames() {
  const res = await fetch('/api/games');
  const games = await res.json();
  const list = document.getElementById('game-list');
  list.innerHTML = '';
  if (games.length === 0) {
    list.innerHTML = '<div class="empty">No games in <code>games/threejs/</code>.<br><br>Generate one:<br><code>just gen-three runner_3d</code></div>';
    return;
  }
  games.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'game-btn';
    btn.textContent = name;
    btn.onclick = () => selectGame(name);
    list.appendChild(btn);
  });
}

function loadGameFrame(src) {
  clearConsole();
  const main = document.getElementById('main');
  main.querySelector('#empty')?.remove();
  const oldStage = document.getElementById('stage');
  if (oldStage) oldStage.remove();
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.innerHTML = '<iframe id="game-frame" src="' + src + '"></iframe>';
  main.appendChild(stage);
  stage.querySelector('iframe').addEventListener('load', syncBigScreen);
  syncBigScreen();
}

function appendConsole(level, text) {
  const out = document.getElementById('console-output');
  const el = document.createElement('div');
  el.className = 'con-line con-' + level;
  const ts = new Date().toLocaleTimeString('en', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});
  el.textContent = '[' + ts + '] ' + text;
  out.appendChild(el);
  out.scrollTop = out.scrollHeight;
}

function clearConsole() {
  document.getElementById('console-output').innerHTML = '';
}

async function selectGame(name) {
  currentGame = name;
  currentBackup = null;
  document.querySelectorAll('.game-btn').forEach(b => b.classList.toggle('active', b.textContent === name));
  loadGameFrame('/play/' + name);
  document.getElementById('feedback').disabled = false;
  document.getElementById('refine-btn').disabled = false;
  document.getElementById('view-toggle').disabled = false;
  document.getElementById('status').textContent = 'Playing: ' + name;
  await loadVersionBar(name);
}

async function loadVersionBar(name) {
  const bar = document.getElementById('version-bar');
  const sel = document.getElementById('version-select');
  const res = await fetch('/api/backups/' + name);
  const backups = await res.json();
  sel.innerHTML = '';
  const current = document.createElement('option');
  current.value = 'current';
  current.textContent = 'current';
  sel.appendChild(current);
  backups.forEach(fname => {
    const opt = document.createElement('option');
    opt.value = fname;
    const ts = fname.replace(name + '_', '').replace('.js', '');
    const d = ts.slice(0,4) + '-' + ts.slice(4,6) + '-' + ts.slice(6,8) + ' ' + ts.slice(9,11) + ':' + ts.slice(11,13) + ':' + ts.slice(13,15);
    opt.textContent = d;
    sel.appendChild(opt);
  });
  bar.classList.toggle('hidden', backups.length === 0);
  document.getElementById('restore-btn').disabled = true;
}

function switchVersion(value) {
  if (!currentGame) return;
  const restoreBtn = document.getElementById('restore-btn');
  if (value === 'current') {
    currentBackup = null;
    restoreBtn.disabled = true;
    loadGameFrame('/play/' + currentGame);
    document.getElementById('status').textContent = 'Playing: ' + currentGame;
  } else {
    currentBackup = value;
    restoreBtn.disabled = false;
    loadGameFrame('/play-backup/' + value);
    const sel = document.getElementById('version-select');
    document.getElementById('status').textContent = 'Backup: ' + sel.options[sel.selectedIndex].textContent;
  }
}

async function restoreBackup() {
  if (!currentBackup) return;
  const btn = document.getElementById('restore-btn');
  const status = document.getElementById('status');
  btn.disabled = true;
  status.textContent = 'Restoring...';
  try {
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: currentBackup})
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = 'Restored! Reloading current...';
      currentBackup = null;
      document.getElementById('version-select').value = 'current';
      document.getElementById('restore-btn').disabled = true;
      loadGameFrame('/play/' + currentGame);
      await loadVersionBar(currentGame);
    } else {
      status.textContent = 'Error: ' + (data.error || 'unknown');
      btn.disabled = false;
    }
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    btn.disabled = false;
  }
}

function syncBigScreen() {
  const main = document.getElementById('main');
  const btn = document.getElementById('view-toggle');
  const iframe = document.getElementById('game-frame');
  main.classList.toggle('large-view', bigScreen);
  btn.classList.toggle('active', bigScreen);
  btn.textContent = bigScreen ? 'Standard View' : 'Big Screen';
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'tester-scale', scale: bigScreen ? 1.5 : 1 }, window.location.origin);
  }
}

function toggleBigScreen() {
  if (!currentGame) return;
  bigScreen = !bigScreen;
  syncBigScreen();
}

async function refine() {
  const feedback = document.getElementById('feedback').value.trim();
  if (!feedback || !currentGame) return;
  const model = document.getElementById('model').value;
  const btn = document.getElementById('refine-btn');
  const status = document.getElementById('status');

  btn.blur();
  btn.disabled = true;
  status.textContent = 'Refining...';
  clearConsole();

  let liveEl = null;
  let liveText = '';

  function finalizeStream() { liveEl = null; liveText = ''; }

  try {
    const res = await fetch('/api/refine', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: currentGame, feedback, model})
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const parts = buffer.split('\\n\\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(part.slice(6)); } catch(e) { continue; }

        if (event.type === 'status') {
          finalizeStream();
          appendConsole('log', event.text);
          status.textContent = event.text;
        } else if (event.type === 'chunk') {
          liveText += event.text;
          if (!liveEl) {
            liveEl = document.createElement('div');
            liveEl.className = 'con-line con-stream';
            document.getElementById('console-output').appendChild(liveEl);
          }
          liveEl.textContent = liveText;
          const out = document.getElementById('console-output');
          out.scrollTop = out.scrollHeight;
        } else if (event.type === 'done') {
          finalizeStream();
          const strategy = event.strategy ? ' (' + event.strategy + ')' : '';
          appendConsole('log', 'Done: ' + event.duration_s + 's' + strategy);
          status.textContent = 'Refined in ' + event.duration_s + 's' + strategy + '. Reloading...';
          document.getElementById('feedback').value = '';
          currentBackup = null;
          document.getElementById('version-select').value = 'current';
          document.getElementById('restore-btn').disabled = true;
          loadGameFrame('/play/' + currentGame);
          await loadVersionBar(currentGame);
        } else if (event.type === 'error') {
          finalizeStream();
          status.textContent = 'Error: ' + event.text;
          appendConsole('error', event.text);
        }
      }
    }
  } catch(e) {
    finalizeStream();
    status.textContent = 'Error: ' + e.message;
    appendConsole('error', e.message);
  }
  btn.disabled = false;
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tester-console') {
    appendConsole(event.data.level, event.data.text);
  }
});

document.getElementById('feedback').addEventListener('keydown', e => { if (e.key === 'Enter') refine(); });
loadGames();
</script>
</body>
</html>"""


PLAY_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{name}</title>
<style>
  :root {{ --game-scale: 1; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #000; color: #eee; font-family: monospace; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }}
  /* Header strip — fixed-height, in document flow (NOT overlay).
     Content kept on the LEFT so the iframe's top-right stays clear for
     the parent tester's Big Screen toggle button. */
  #hud {{ flex-shrink: 0; padding: 6px 10px; background: #161616; border-bottom: 1px solid #2a2a2a;
          display: flex; align-items: center; gap: 12px; font-size: 11px; color: #aaa; }}
  #hud button {{ background: #222; color: #ccc; border: 1px solid #444; padding: 3px 12px; cursor: pointer; font: 11px monospace; border-radius: 3px; }}
  #hud button:hover {{ background: #2a2a2a; border-color: #5a5a5a; }}
  #hud #state {{ color: #888; font-variant-numeric: tabular-nums; }}
  /* Stage — fills remaining vertical space, centers the canvas. */
  #stage {{ flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 8px; }}
  canvas {{ display: block; max-width: 100%; max-height: 100%; transform: scale(var(--game-scale)); transform-origin: center center; transition: transform 140ms ease; }}
  /* Footer — only visible when there's an error message. */
  #err {{ flex-shrink: 0; padding: 4px 10px; background: #200; color: #e55; font-size: 11px; white-space: pre-wrap; min-height: 0; }}
  #err:empty {{ display: none; }}
</style></head><body>
<div id="hud">
  <button id="reset-btn">Reset</button>
  <span id="state">loading...</span>
</div>
<div id="stage"></div>
<div id="err"></div>
<script type="importmap">
{{ "imports": {{
  "three": "https://unpkg.com/three@0.161.0/build/three.module.js",
  "engine": "/api/engine"
}} }}
</script>
<script type="module">
import * as THREE from 'three';
import * as engine from 'engine';
window.engine = engine;

const errEl = document.getElementById('err');
const stateEl = document.getElementById('state');

// Forward console + errors to parent (the tester UI).
function postLog(level, text) {{
  try {{ parent.postMessage({{ type: 'tester-console', level, text }}, window.location.origin); }} catch (e) {{}}
}}
['log', 'warn', 'error'].forEach(lvl => {{
  const orig = console[lvl].bind(console);
  console[lvl] = function () {{
    orig.apply(console, arguments);
    postLog(lvl, Array.from(arguments).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
  }};
}});
window.addEventListener('error', e => {{
  postLog('error', e.message + ' (line ' + e.lineno + ')');
  errEl.textContent = String(e.message);
}});
window.addEventListener('unhandledrejection', e => {{
  postLog('error', 'Unhandled: ' + String(e.reason));
  errEl.textContent = 'Unhandled: ' + String(e.reason);
}});

// Big-screen scale message from parent.
window.addEventListener('message', event => {{
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tester-scale') {{
    document.documentElement.style.setProperty('--game-scale', String(Number(event.data.scale) || 1));
  }}
}});

// Keyboard -> action mapping.
const keys = new Set();
window.addEventListener('keydown', e => {{ keys.add(e.code); e.preventDefault(); }});
window.addEventListener('keyup',   e => {{ keys.delete(e.code); e.preventDefault(); }});

function currentActionFromKeys() {{
  // v2 uses Discrete(15) — see THREE_GAME_TEMPLATE.md "Action Space".
  // Arrows = move, SPACE = A (primary), SHIFT = B (secondary).
  const left = keys.has('ArrowLeft'), right = keys.has('ArrowRight');
  const up = keys.has('ArrowUp'), down = keys.has('ArrowDown');
  const space = keys.has('Space');
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');

  // Combos with A (SPACE) — move-and-fire patterns
  if (space && left)  return 11;
  if (space && right) return 12;
  if (space && up)    return 13;
  if (space && down)  return 14;
  if (space) return 9;  // A alone

  // B alone (SHIFT)
  if (shift && !left && !right && !up && !down) return 10;

  // Diagonals
  if (up && left)   return 5;
  if (up && right)  return 6;
  if (down && left) return 7;
  if (down && right) return 8;

  // Cardinals
  if (left)  return 1;
  if (right) return 2;
  if (up)    return 3;
  if (down)  return 4;
  return 0; // NOOP
}}

// mulberry32 — exposed as a global so games can rely on it (template also defines it locally).
window.mulberry32 = function (seed) {{
  let t = seed >>> 0;
  return () => {{
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }};
}};

const W = 512, H = 512;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.getElementById('stage').appendChild(canvas);
const renderer = new THREE.WebGLRenderer({{ canvas, antialias: false }});
renderer.setSize(W, H, false);
window.renderer = renderer;

async function loadGame() {{
  const src = await (await fetch('{src_path}')).text();
  // Run in global scope; promote function declarations to window.*
  // eslint-disable-next-line no-new-func
  (new Function(src + "\\n; window.setup = typeof setup==='function'?setup:undefined;"
                    + " window.update = typeof update==='function'?update:undefined;"
                    + " window.render = typeof render==='function'?render:undefined;"
                    + " window.resetGame = typeof resetGame==='function'?resetGame:undefined;"
                    + " window.getGameState = typeof getGameState==='function'?getGameState:undefined;"))();
  const required = ['setup', 'update', 'render', 'resetGame', 'getGameState'];
  for (const r of required) {{
    if (typeof window[r] !== 'function') throw new Error('game missing ' + r + '()');
  }}
}}

let lastT = performance.now();
let frame = 0;
let maxLives = 0;

function formatHUD(s) {{
  if (typeof s.lives === 'number' && s.lives > maxLives) maxLives = s.lives;
  const parts = ['score: ' + s.score];
  if (maxLives > 1) parts.push('lives: ' + s.lives);
  parts.push(s.gameState);
  return parts.join('  |  ');
}}

function loop(t) {{
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  window.currentAction = currentActionFromKeys();
  try {{
    window.update(dt);
    window.render();
    if (frame++ % 12 === 0) {{
      const s = window.getGameState();
      stateEl.textContent = formatHUD(s);
    }}
  }} catch (e) {{
    errEl.textContent = e.message + '\\n' + (e.stack || '');
    postLog('error', e.message);
    return;
  }}
  requestAnimationFrame(loop);
}}

document.getElementById('reset-btn').onclick = () => {{
  try {{ maxLives = 0; window.resetGame((Date.now() & 0x7fffffff) >>> 0); }} catch (e) {{ errEl.textContent = e.message; }}
  document.getElementById('reset-btn').blur();
}};

(async () => {{
  try {{
    await loadGame();
    window.setup({{ THREE, renderer, width: W, height: H }});
    window.resetGame((Date.now() & 0x7fffffff) >>> 0);
    requestAnimationFrame(loop);
  }} catch (e) {{
    errEl.textContent = e.message + '\\n' + (e.stack || '');
    postLog('error', e.message);
  }}
}})();
</script>
</body></html>"""


# -- HTTP handler -------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet

    def _send(self, code, content_type, body):
        body_bytes = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_GET(self):
        path = self.path

        if path == "/":
            return self._send(200, "text/html", TESTER_HTML)

        if path == "/api/games":
            return self._send(200, "application/json", json.dumps(list_games()))

        if path == "/api/engine":
            engine_path = ROOT / "engine" / "three" / "index.mjs"
            return self._send(200, "application/javascript", engine_path.read_bytes())

        if path.startswith("/api/games/"):
            name = path.split("/api/games/")[1]
            fp = THREEJS_DIR / f"{name}.js"
            if fp.exists():
                return self._send(200, "application/javascript", fp.read_bytes())
            return self._send(404, "text/plain", b"not found")

        if path.startswith("/api/backups/"):
            name = path.split("/api/backups/")[1]
            return self._send(200, "application/json", json.dumps(list_backups(name)))

        if path.startswith("/api/backup-file/"):
            filename = path.split("/api/backup-file/")[1]
            fp = BACKUPS_DIR / filename
            if fp.exists():
                return self._send(200, "application/javascript", fp.read_bytes())
            return self._send(404, "text/plain", b"not found")

        if path.startswith("/play-backup/"):
            filename = path.split("/play-backup/")[1]
            html = PLAY_HTML.format(name=filename, src_path=f"/api/backup-file/{filename}")
            return self._send(200, "text/html", html)

        if path.startswith("/play/"):
            name = path.split("/play/")[1]
            html = PLAY_HTML.format(name=name, src_path=f"/api/games/{name}")
            return self._send(200, "text/html", html)

        return self._send(404, "text/plain", b"not found")

    def do_POST(self):
        if self.path == "/api/restore":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            filename = body.get("filename", "")
            src = BACKUPS_DIR / filename
            if not src.exists():
                return self._send(404, "application/json", json.dumps({"success": False, "error": "backup not found"}))
            name = "_".join(filename.replace(".js", "").split("_")[:-1])
            dest = THREEJS_DIR / f"{name}.js"
            dest.write_text(src.read_text())
            return self._send(200, "application/json", json.dumps({"success": True}))

        if self.path == "/api/refine":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            name = body["name"]
            feedback = body["feedback"]
            model_key = body.get("model", "pro")

            q = queue.Queue()

            def run():
                try:
                    result = refine_game(name, feedback, model_key, on_event=q.put)
                    q.put({"type": "done", "duration_s": result["duration_s"], "strategy": result.get("strategy")})
                except Exception as e:
                    q.put({"type": "error", "text": str(e)})
                finally:
                    q.put(None)

            threading.Thread(target=run, daemon=True).start()

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            try:
                while True:
                    event = q.get()
                    if event is None:
                        break
                    self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        self._send(404, "text/plain", b"not found")


def main():
    parser = argparse.ArgumentParser(description="Three.js v2 game tester + refiner")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

    games = list_games()
    print(f"\n  Three.js tester:  http://localhost:{args.port}")
    print(f"  Games dir:        {THREEJS_DIR} ({len(games)} game{'s' if len(games) != 1 else ''})")
    if not games:
        print("  (empty — generate one with: just gen-three runner_3d)")
    print("  Ctrl-C to stop.\n")

    server = ThreadingHTTPServer(("", args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping.")
        server.shutdown()


if __name__ == "__main__":
    main()
