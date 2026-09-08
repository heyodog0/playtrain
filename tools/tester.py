"""Lightweight game tester: play games in browser + refine via Gemini."""

import json
import queue
import socketserver
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from playtrain.gen.refine import refine_game
from playtrain.gen.variant import (
    make_variant, promote_variant, delete_variant, load_registry, lookup_physics,
)

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / "games"
CATALOGS_DIR = GAMES_DIR / "catalogs"
JS_DIR = GAMES_DIR / "js"


BACKUPS_DIR = GAMES_DIR / "backups"


def list_games() -> list[str]:
    return sorted(p.stem for p in JS_DIR.glob("*.js"))


def list_backups(name: str) -> list[str]:
    """Return backup filenames for a game, newest first."""
    files = sorted(BACKUPS_DIR.glob(f"{name}_*.js"), reverse=True)
    return [f.name for f in files]


def needs_matter(name: str) -> bool:
    # Variants aren't in any catalog, so consult the registry first: it carries
    # the base game's physics so matter.js loads for variants of angry_birds/suika.
    reg = load_registry()
    if name in reg:
        return reg[name].get("physics") == "matter.js"
    for catalog_file in CATALOGS_DIR.glob("*.json"):
        try:
            catalog = json.loads(catalog_file.read_text())
            for g in catalog:
                if g["name"] == name and g.get("physics") == "matter.js":
                    return True
        except Exception:
            pass
    return False


# -- HTML templates (inline) --------------------------------------------------

TESTER_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Game Tester</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --stage-width: 520px; --stage-height: 560px; --game-scale: 1; }
  body { font-family: monospace; background: #111; color: #eee; height: 100vh; display: flex; flex-direction: column; }
  #top { display: flex; flex: 1; min-height: 0; }
  #sidebar { width: 180px; background: #1a1a1a; border-right: 1px solid #333; overflow-y: auto; padding: 8px; }
  #sidebar h3 { font-size: 12px; color: #888; margin-bottom: 8px; }
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
  #console { width: 260px; flex-shrink: 0; background: #111; border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; font-family: monospace; font-size: 11px; }
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
  #mode-toggle { background: #333; color: #ccc; border: 1px solid #555; padding: 6px 12px; cursor: pointer; font-family: monospace; white-space: nowrap; }
  #mode-toggle.fork { background: #26a; color: #fff; border-color: #48c; }
  #bottom #variant-name { flex: 0 0 150px; }
  #bottom #variant-name:disabled { opacity: 0.4; }
  #refine-btn.fork { background: #38c; }
  .variant-row { display: flex; align-items: center; }
  .variant-row .game-btn { padding-left: 20px; font-size: 11px; color: #9ab; flex: 1; }
  .variant-row .game-btn:before { content: "\\21B3 "; color: #556; }
  .var-action { background: none; border: 1px solid transparent; color: #666; cursor: pointer; font: 12px monospace; padding: 4px 6px; flex-shrink: 0; }
  .var-action:hover { border-color: #555; }
  .var-promote:hover { color: #6d6; }
  .var-delete:hover { color: #e55; }
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
  <div id="sidebar"><h3>Games</h3><div id="game-list"></div></div>
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
  <button id="mode-toggle" onclick="toggleMode()">Mode: Refine</button>
  <select id="model"><option value="pro">Pro</option><option value="flash">Flash</option></select>
  <input id="feedback" type="text" placeholder="Feedback for refinement..." disabled>
  <input id="variant-name" type="text" placeholder="variant name (optional)" style="display:none" disabled>
  <button id="refine-btn" onclick="submitBar()" disabled>Refine</button>
  <span id="status">Ready</span>
</div>
<script>
let currentGame = null;
let bigScreen = false;
let currentBackup = null;

async function loadGames() {
  const [games, variants] = await Promise.all([
    fetch('/api/games').then(r => r.json()),
    fetch('/api/variants').then(r => r.json())
  ]);
  const list = document.getElementById('game-list');
  list.innerHTML = '';

  const byRoot = {};
  for (const [name, meta] of Object.entries(variants)) {
    (byRoot[meta.base_root] = byRoot[meta.base_root] || []).push(name);
  }
  const variantSet = new Set(Object.keys(variants));
  const bases = games.filter(g => !variantSet.has(g));

  bases.forEach(name => {
    list.appendChild(gameButton(name));
    (byRoot[name] || []).sort().forEach(v => list.appendChild(variantRow(v, variants[v])));
  });
  // variants whose base game file is gone — still show them so they're reachable
  Object.keys(byRoot).filter(r => !bases.includes(r)).sort().forEach(r => {
    byRoot[r].sort().forEach(v => list.appendChild(variantRow(v, variants[v])));
  });

  // keep the active highlight after a reload
  if (currentGame) {
    document.querySelectorAll('.game-btn').forEach(b => b.classList.toggle('active', b.dataset.game === currentGame));
  }
}

function gameButton(name) {
  const btn = document.createElement('button');
  btn.className = 'game-btn';
  btn.dataset.game = name;
  btn.textContent = name;
  btn.onclick = () => selectGame(name);
  return btn;
}

function variantRow(name, meta) {
  const row = document.createElement('div');
  row.className = 'variant-row';
  const btn = document.createElement('button');
  btn.className = 'game-btn';
  btn.dataset.game = name;
  btn.textContent = name.startsWith(meta.base_root + '.') ? name.slice(meta.base_root.length + 1) : name;
  btn.title = (meta.prompt || '') + '\\n(from ' + meta.parent + ')';
  btn.onclick = () => selectGame(name);
  const promote = document.createElement('button');
  promote.className = 'var-action var-promote';
  promote.textContent = '\\u2191';
  promote.title = 'Promote to first-class game';
  promote.onclick = (e) => { e.stopPropagation(); promoteVariant(name); };
  const del = document.createElement('button');
  del.className = 'var-action var-delete';
  del.textContent = '\\u00d7';
  del.title = 'Delete variant (backed up first)';
  del.onclick = (e) => { e.stopPropagation(); deleteVariant(name); };
  row.append(btn, promote, del);
  return row;
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
  document.querySelectorAll('.game-btn').forEach(b => b.classList.toggle('active', b.dataset.game === name));
  loadGameFrame('/play/' + name);
  document.getElementById('feedback').disabled = false;
  document.getElementById('variant-name').disabled = false;
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
    // show just the timestamp part: "20260422-140435" → "2026-04-22 14:04:35"
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

let mode = 'refine';

function toggleMode() {
  mode = mode === 'refine' ? 'fork' : 'refine';
  const t = document.getElementById('mode-toggle');
  const fb = document.getElementById('feedback');
  const vn = document.getElementById('variant-name');
  const btn = document.getElementById('refine-btn');
  const isFork = mode === 'fork';
  t.textContent = isFork ? 'Mode: Fork' : 'Mode: Refine';
  t.classList.toggle('fork', isFork);
  fb.placeholder = isFork ? 'Describe the new variant...' : 'Feedback for refinement...';
  vn.style.display = isFork ? '' : 'none';
  btn.textContent = isFork ? 'Fork' : 'Refine';
  btn.classList.toggle('fork', isFork);
}

function submitBar() {
  if (mode === 'fork') fork();
  else refine();
}

// Shared SSE reader for /api/refine and /api/variant. Handles status/chunk/error
// events uniformly; the caller's onDone runs on the terminal 'done' event.
async function streamJob(url, payload, onDone) {
  const status = document.getElementById('status');
  const outEl = () => document.getElementById('console-output');
  let liveEl = null, liveText = '';
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
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
        liveEl = null; liveText = '';
        appendConsole('log', event.text);
        status.textContent = event.text;
      } else if (event.type === 'chunk') {
        liveText += event.text;
        if (!liveEl) {
          liveEl = document.createElement('div');
          liveEl.className = 'con-line con-stream';
          outEl().appendChild(liveEl);
        }
        liveEl.textContent = liveText;
        outEl().scrollTop = outEl().scrollHeight;
      } else if (event.type === 'done') {
        liveEl = null; liveText = '';
        await onDone(event);
      } else if (event.type === 'error') {
        liveEl = null; liveText = '';
        status.textContent = 'Error: ' + event.text;
        appendConsole('error', event.text);
      }
    }
  }
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
  try {
    await streamJob('/api/refine', {name: currentGame, feedback, model}, async (event) => {
      const strategy = event.strategy ? ' (' + event.strategy + ')' : '';
      appendConsole('log', 'Done: ' + event.duration_s + 's' + strategy);
      status.textContent = 'Refined in ' + event.duration_s + 's' + strategy + '. Reloading...';
      document.getElementById('feedback').value = '';
      currentBackup = null;
      document.getElementById('version-select').value = 'current';
      document.getElementById('restore-btn').disabled = true;
      loadGameFrame('/play/' + currentGame);
      await loadVersionBar(currentGame);
    });
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    appendConsole('error', e.message);
  }
  btn.disabled = false;
}

async function fork() {
  const prompt = document.getElementById('feedback').value.trim();
  if (!prompt || !currentGame) return;
  const name = document.getElementById('variant-name').value.trim();
  const model = document.getElementById('model').value;
  const btn = document.getElementById('refine-btn');
  const status = document.getElementById('status');
  btn.blur();
  btn.disabled = true;
  status.textContent = 'Forking ' + currentGame + '...';
  clearConsole();
  try {
    await streamJob('/api/variant', {parent: currentGame, prompt, name, model}, async (event) => {
      appendConsole('log', 'Forked \\u2192 ' + event.name + ' (' + event.duration_s + 's)');
      status.textContent = 'Created ' + event.name + '. Opening...';
      document.getElementById('feedback').value = '';
      document.getElementById('variant-name').value = '';
      await loadGames();
      selectGame(event.name);
    });
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
    appendConsole('error', e.message);
  }
  btn.disabled = false;
}

async function promoteVariant(name) {
  const status = document.getElementById('status');
  status.textContent = 'Promoting ' + name + '...';
  try {
    const res = await fetch('/api/promote', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
    const data = await res.json();
    if (data.success) { status.textContent = 'Promoted ' + name + ' to a first-class game'; await loadGames(); }
    else status.textContent = 'Error: ' + (data.error || 'unknown');
  } catch(e) { status.textContent = 'Error: ' + e.message; }
}

async function deleteVariant(name) {
  if (!confirm('Delete variant ' + name + '? A backup is saved first.')) return;
  const status = document.getElementById('status');
  status.textContent = 'Deleting ' + name + '...';
  try {
    const res = await fetch('/api/delete-variant', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
    const data = await res.json();
    if (data.success) {
      status.textContent = 'Deleted ' + name;
      if (currentGame === name) currentGame = null;
      await loadGames();
    } else status.textContent = 'Error: ' + (data.error || 'unknown');
  } catch(e) { status.textContent = 'Error: ' + e.message; }
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tester-console') {
    appendConsole(event.data.level, event.data.text);
  }
});

document.getElementById('feedback').addEventListener('keydown', e => { if (e.key === 'Enter') submitBar(); });
document.getElementById('variant-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitBar(); });
loadGames();
</script>
</body>
</html>"""

PLAY_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{name}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
{matter_tag}
<style>
  :root {{ --game-scale: 1; }}
  body {{ margin: 0; background: #000; display: flex; flex-direction: column; align-items: center; overflow: auto; }}
  canvas {{ transform: scale(var(--game-scale)); transform-origin: top center; transition: transform 140ms ease; }}
  #controls {{ position: fixed; bottom: 4px; left: 0; right: 0; text-align: center; color: #888; font: 11px monospace; z-index: 10; }}
  #controls button {{ background: #222; color: #aaa; border: 1px solid #444; padding: 2px 10px; cursor: pointer; font: 11px monospace; }}
</style>
</head>
<body>
<div id="controls">
  <button id="reset-btn" onclick="_maxLives=0; resetGame(Date.now()>>>0); this.blur();">Reset</button>
  <span id="state"></span>
</div>
<script>
(function() {{
  ['log','warn','error'].forEach(function(lvl) {{
    var orig = console[lvl].bind(console);
    console[lvl] = function() {{
      orig.apply(console, arguments);
      try {{ parent.postMessage({{type:'tester-console',level:lvl,text:Array.from(arguments).map(function(a){{return typeof a==='object'?JSON.stringify(a):String(a)}}).join(' ')}}, window.location.origin); }} catch(e) {{}}
    }};
  }});
  window.onerror = function(msg, src, line) {{
    try {{ parent.postMessage({{type:'tester-console',level:'error',text:String(msg)+' (line '+line+')'}}, window.location.origin); }} catch(e) {{}}
  }};
  window.addEventListener('unhandledrejection', function(e) {{
    try {{ parent.postMessage({{type:'tester-console',level:'error',text:'Unhandled: '+String(e.reason)}}, window.location.origin); }} catch(e) {{}}
  }});
}})();
</script>
<script src="/api/games/{name}"></script>
<script>
// Wrap setup to auto-call resetGame after canvas creation
const _origSetup = typeof setup === 'function' ? setup : function(){{}};
setup = function() {{
  _origSetup();
  if (typeof resetGame === 'function') resetGame(Date.now() >>> 0);
}};
// State overlay — only show "Lives" if a game actually uses lives (max ever > 1).
var _maxLives = 0;
setInterval(() => {{
  if (typeof getGameState === 'function') {{
    const s = getGameState();
    if (typeof s.lives === 'number' && s.lives > _maxLives) _maxLives = s.lives;
    const parts = ['Score: ' + s.score];
    if (_maxLives > 1) parts.push('Lives: ' + s.lives);
    parts.push(s.gameState);
    document.getElementById('state').textContent = parts.join(' | ');
  }}
}}, 200);

window.addEventListener('message', event => {{
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'tester-scale') {{
    const scale = Number(event.data.scale) || 1;
    document.documentElement.style.setProperty('--game-scale', String(scale));
  }}
}});
</script>
</body>
</html>"""

MATTER_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script>'


# -- HTTP handler -------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet

    def _send(self, code, content_type, body):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path

        if path == "/":
            self._send(200, "text/html", TESTER_HTML.encode())

        elif path == "/api/games":
            games = list_games()
            self._send(200, "application/json", json.dumps(games).encode())

        elif path == "/api/variants":
            self._send(200, "application/json", json.dumps(load_registry()).encode())

        elif path.startswith("/api/games/"):
            name = path.split("/api/games/")[1]
            fp = JS_DIR / f"{name}.js"
            if fp.exists():
                self._send(200, "application/javascript", fp.read_bytes())
            else:
                self._send(404, "text/plain", b"not found")

        elif path.startswith("/api/backups/"):
            name = path.split("/api/backups/")[1]
            backups = list_backups(name)
            self._send(200, "application/json", json.dumps(backups).encode())

        elif path.startswith("/api/backup-file/"):
            filename = path.split("/api/backup-file/")[1]
            fp = BACKUPS_DIR / filename
            if fp.exists():
                self._send(200, "application/javascript", fp.read_bytes())
            else:
                self._send(404, "text/plain", b"not found")

        elif path.startswith("/play-backup/"):
            filename = path.split("/play-backup/")[1]
            # derive game name from filename (strip timestamp suffix)
            name = "_".join(filename.replace(".js", "").split("_")[:-1])
            matter = MATTER_TAG if needs_matter(name) else ""
            html = PLAY_HTML.format(name=filename, matter_tag=matter).replace(
                f"/api/games/{filename}", f"/api/backup-file/{filename}"
            )
            self._send(200, "text/html", html.encode())

        elif path.startswith("/play/"):
            name = path.split("/play/")[1]
            matter = MATTER_TAG if needs_matter(name) else ""
            html = PLAY_HTML.format(name=name, matter_tag=matter)
            self._send(200, "text/html", html.encode())

        else:
            self._send(404, "text/plain", b"not found")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def _json_result(self, fn):
        """Run fn(), reply {success:true} or {success:false, error:...}."""
        try:
            fn()
            self._send(200, "application/json", json.dumps({"success": True}).encode())
        except Exception as e:
            self._send(200, "application/json", json.dumps({"success": False, "error": str(e)}).encode())

    def _stream_sse(self, worker):
        """Run worker(emit) in a thread and stream its events as SSE.

        worker pushes {"type": "status"/"chunk"/...} via emit; its return dict is
        sent as the terminal "done" event.
        """
        q = queue.Queue()

        def run():
            try:
                done = worker(q.put)
                q.put({"type": "done", **(done or {})})
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

    def do_POST(self):
        if self.path == "/api/restore":
            body = self._read_json()
            filename = body.get("filename", "")
            src = BACKUPS_DIR / filename
            if not src.exists():
                self._send(404, "application/json", json.dumps({"success": False, "error": "backup not found"}).encode())
                return
            name = "_".join(filename.replace(".js", "").split("_")[:-1])
            dest = JS_DIR / f"{name}.js"
            dest.write_text(src.read_text())
            self._send(200, "application/json", json.dumps({"success": True}).encode())

        elif self.path == "/api/refine":
            body = self._read_json()

            def worker(emit):
                r = refine_game(body["name"], body["feedback"], body.get("model", "pro"), on_event=emit)
                return {"duration_s": r["duration_s"], "strategy": r.get("strategy")}

            self._stream_sse(worker)

        elif self.path == "/api/variant":
            body = self._read_json()

            def worker(emit):
                r = make_variant(body["parent"], body["prompt"], body.get("name", ""),
                                 body.get("model", "pro"), on_event=emit)
                return {"name": r["name"], "duration_s": r["duration_s"], "strategy": r.get("strategy")}

            self._stream_sse(worker)

        elif self.path == "/api/promote":
            body = self._read_json()
            self._json_result(lambda: promote_variant(body["name"]))

        elif self.path == "/api/delete-variant":
            body = self._read_json()
            self._json_result(lambda: delete_variant(body["name"]))

        else:
            self._send(404, "text/plain", b"not found")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Game tester server")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface to bind (default: loopback only)")
    args = parser.parse_args()

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

    # Loopback only. The POST endpoints below refine/generate games through the
    # Gemini API on this machine's key and write to the catalog, none of it
    # authenticated - binding "" (all interfaces) hands that to anyone on the
    # same network. Pass --host to widen it deliberately.
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Tester running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")


if __name__ == "__main__":
    main()
