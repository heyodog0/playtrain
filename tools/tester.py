"""Lightweight game tester: play games in browser + refine via Gemini."""

import json
import re
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

# The browser shim: PlayTrain's own rasterizer, not real p5. The tester used to load
# p5.js from a CDN, which renders the same game slightly differently from the runtime
# the agent trains on (and from playtrain.org). This is the Python twin of
# browserShimBundle() in tools/play-templates.mjs, so both surfaces draw identically.
_P5_DIR = ROOT / "runtime" / "p5"
_shim_cache: dict[bool, str] = {}


def browser_shim_bundle(wasm: bool = True) -> str:
    if wasm in _shim_cache:
        return _shim_cache[wasm]
    raster = (_P5_DIR / "raster.mjs").read_text().replace(
        "export function createCanvas(", "function createRasterCanvas(")
    shim = (_P5_DIR / "p5-shim.mjs").read_text().replace(
        "import { createCanvas as createJsCanvas } from './raster.mjs'; // pure JS, browser-safe",
        "const createJsCanvas = createRasterCanvas;")
    pre = ""
    if wasm:
        import base64 as _b64, re as _re
        glue = (_P5_DIR / "raster-wasm.mjs").read_text()
        glue = _re.sub(r"// @node-only-begin[\s\S]*?// @node-only-end\n?", "", glue)
        glue = glue.replace("export function makeWasmBackend(", "function makeWasmBackend(")
        b64 = _b64.b64encode((_P5_DIR / "rasterizer.wasm").read_bytes()).decode()
        pre = (glue + "\n{\n"
               "  const __b = atob(" + json.dumps(b64) + ");\n"
               "  const __bytes = new Uint8Array(__b.length);\n"
               "  for (let i = 0; i < __b.length; i++) __bytes[i] = __b.charCodeAt(i);\n"
               "  globalThis.__PT_WASM_EXPORTS = (await WebAssembly.instantiate(__bytes, {})).instance.exports;\n"
               "}\n")
    bundle = pre + raster + "\n" + shim
    _shim_cache[wasm] = bundle
    return bundle


def matter_bundle() -> str:
    return (ROOT / "runtime" / "vendor" / "matter.min.js").read_text()


def seed_workspace() -> int:
    """Copy the shipped catalog into the empty generation workspace.

    ``games/js`` is where generation, refinement and variants write, and a fresh
    clone ships it empty, so the tester would otherwise open on a picker with no
    games in it. Seeding from the read-only catalog gives it something to show
    while keeping every edit inside the workspace.
    """
    import shutil
    from playtrain._paths import games_dir

    JS_DIR.mkdir(parents=True, exist_ok=True)
    if any(JS_DIR.glob("*.js")):
        return 0
    src = games_dir()
    if not src.is_dir():
        return 0
    n = 0
    for f in sorted(src.glob("*.js")):
        shutil.copy2(f, JS_DIR / f.name)
        n += 1
    return n


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
  // The renderer choice lives in the frame's localStorage but the parent builds
  // the src, so re-apply it here or switching games silently reverts to native.
  try {
    if (localStorage.getItem('pt-renderer') === 'p5' && src.indexOf('p5=1') < 0) {
      src += (src.indexOf('?') < 0 ? '?' : '&') + 'p5=1';
    }
  } catch (e) {}
  clearConsole();
  const main = document.getElementById('main');
  main.querySelector('#empty')?.remove();
  const oldStage = document.getElementById('stage');
  if (oldStage) oldStage.remove();
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.innerHTML = '<iframe id="game-frame" src="' + src + '"></iframe>';
  main.appendChild(stage);
  const frame = stage.querySelector('iframe');
  frame.addEventListener('load', () => {
    syncBigScreen();
    // Key events go to the focused document. Without this the parent keeps focus
    // and the game ignores the keyboard until you click inside the frame.
    try { frame.contentWindow.focus(); } catch (e) {}
  });
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

P5_HTML = """<!DOCTYPE html>
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
  #renderer {{ margin-left: 10px; cursor: pointer; }}
</style>
</head>
<body>
<div id="controls">
  <button id="reset-btn" onclick="_newEpisode(); this.blur();">Reset</button>
  <span id="state"></span>
  <label id="renderer"><input type="checkbox" id="use-p5" checked> real p5 (CDN)</label>
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
// Same seed pinning as the rasterizer page, so toggling the renderer replays
// the identical episode instead of rolling a new one.
var _maxLives = 0;
var _u0 = new URL(location.href);
var _SEED = Number(_u0.searchParams.get('seed')) || (Date.now() >>> 0);
if (_u0.searchParams.get('seed') !== String(_SEED)) {{
  _u0.searchParams.set('seed', String(_SEED));
  history.replaceState(null, '', _u0.toString());
}}
function _newEpisode() {{
  _maxLives = 0;
  _SEED = Date.now() >>> 0;
  var u = new URL(location.href);
  u.searchParams.set('seed', String(_SEED));
  history.replaceState(null, '', u.toString());
  if (typeof resetGame === 'function') resetGame(_SEED);
}}

// Wrap setup to auto-call resetGame after canvas creation
const _origSetup = typeof setup === 'function' ? setup : function(){{}};
setup = function() {{
  _origSetup();
  if (typeof resetGame === 'function') resetGame(_SEED);
}};
// State overlay — only show "Lives" if a game actually uses lives (max ever > 1).
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

(function() {{
  function grabFocus() {{ try {{ window.focus(); }} catch (e) {{}} }}
  grabFocus();
  addEventListener('pointerdown', grabFocus);
  document.addEventListener('mouseover', grabFocus);
  document.getElementById('use-p5').onchange = function () {{
    try {{ localStorage.setItem('pt-renderer', this.checked ? 'p5' : 'native'); }} catch (e) {{}}
    var u = new URL(location.href);
    if (this.checked) u.searchParams.set('p5', '1'); else u.searchParams.delete('p5');
    location.href = u.toString();
  }};
}})();

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

P5_MATTER_TAG = '<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script>'


def play_html(name: str, source: str, needs_matter: bool, use_p5: bool = False) -> str:
    """The play page, rendered by PlayTrain's rasterizer.

    Mirrors rasterizerPage() in tools/play-templates.mjs, which is what
    playtrain.org serves, so a game looks the same in both places and the same
    as what the training runtime draws. The game source is inlined inert and
    eval'd only after the shim has installed its globals; a <script src> would
    run against real p5's globals or none at all.
    """
    if use_p5:
        # Real p5 from a CDN, for eyeballing the difference. Not what the agent
        # sees: p5 lights per fragment where our rasterizer is per vertex, so a
        # 3D game is visibly smoother here than in training.
        return P5_HTML.format(name=name,
                              matter_tag=P5_MATTER_TAG if needs_matter else "")
    matter = "<script>" + matter_bundle() + "</script>\n" if needs_matter else ""
    bundle = browser_shim_bundle(wasm=bool(re.search(r"\bWEBGL\b", source)))
    return (
        HEAD_HTML.replace("__TITLE__", name)
        + matter
        + '<script type="text/plain" id="game-src">' + source + "</script>\n"
        + '<script type="module">\n' + bundle + BOOT_JS + "</script>\n</body></html>"
    )


HEAD_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<style>
  :root { --game-scale: 1; }
  body { margin: 0; background: #000; display: flex; flex-direction: column;
         align-items: center; overflow: auto; }
  canvas { transform: scale(var(--game-scale)); transform-origin: top center;
           transition: transform 140ms ease; image-rendering: pixelated; }
  #controls { position: fixed; bottom: 4px; left: 0; right: 0; text-align: center;
              color: #888; font: 11px monospace; z-index: 10; }
  #controls button { background: #222; color: #aaa; border: 1px solid #444;
                     padding: 2px 10px; cursor: pointer; font: 11px monospace; }
  #renderer { margin-left: 10px; cursor: pointer; }
</style>
</head>
<body>
<div id="controls">
  <button id="reset-btn">Reset</button>
  <span id="state"></span>
  <label id="renderer"><input type="checkbox" id="use-p5"> real p5 (CDN)</label>
</div>
<canvas id="view"></canvas>
<script>
(function() {
  ['log','warn','error'].forEach(function(lvl) {
    var orig = console[lvl].bind(console);
    console[lvl] = function() {
      orig.apply(console, arguments);
      try { parent.postMessage({type:'tester-console',level:lvl,text:Array.from(arguments).map(function(a){return typeof a==='object'?JSON.stringify(a):String(a)}).join(' ')}, window.location.origin); } catch(e) {}
    };
  });
  window.onerror = function(msg, src, line) {
    try { parent.postMessage({type:'tester-console',level:'error',text:String(msg)+' (line '+line+')'}, window.location.origin); } catch(e) {}
  };
  window.addEventListener('unhandledrejection', function(e) {
    try { parent.postMessage({type:'tester-console',level:'error',text:'Unhandled: '+String(e.reason)}, window.location.origin); } catch(e) {}
  });
})();
</script>
"""

# Runs after the shim bundle in the same module scope. An IIFE so its locals cannot
# collide with the shim's top-level names (loop, tick, ...).
BOOT_JS = """
(function () {
  // Same reason as the parent side: this document has to hold focus for its
  // keydown listeners to fire. Grab it at boot, and grab it back whenever the
  // pointer comes over the game, so clicking the sidebar does not mute the keys.
  function grabFocus() { try { window.focus(); } catch (e) {} }
  grabFocus();
  addEventListener('pointerdown', grabFocus);
  addEventListener('mouseenter', grabFocus);
  document.addEventListener('mouseover', grabFocus, { once: false });

  // Renderer toggle. Sticky across games via localStorage, since switching game
  // rebuilds the frame with a fresh src.
  document.getElementById('use-p5').onchange = function () {
    try { localStorage.setItem('pt-renderer', this.checked ? 'p5' : 'native'); } catch (e) {}
    var u = new URL(location.href);
    if (this.checked) u.searchParams.set('p5', '1'); else u.searchParams.delete('p5');
    location.href = u.toString();
  };

  // Seed lives in the URL. Swapping the renderer reloads the page, so without a
  // pinned seed the two sides would show different episodes and be impossible to
  // compare; with it, both start from the identical frame 0.
  var _u = new URL(location.href);
  var SEED = Number(_u.searchParams.get('seed')) || (Date.now() >>> 0);
  if (_u.searchParams.get('seed') !== String(SEED)) {
    _u.searchParams.set('seed', String(SEED));
    history.replaceState(null, '', _u.toString());
  }

  installGlobals();
  (0, eval)(document.getElementById('game-src').textContent);
  if (typeof window.setup === 'function') window.setup();
  if (typeof window.resetGame === 'function') window.resetGame(SEED);

  var view = document.getElementById('view');
  var p0 = getPixelData(); view.width = p0.width; view.height = p0.height;
  var vctx = view.getContext('2d');

  var held = new Set(), pressed = new Set();
  var KEYS = [32, 37, 38, 39, 40, 65, 66, 68, 83, 87];
  addEventListener('keydown', function (e) {
    if (KEYS.indexOf(e.keyCode) >= 0) {
      e.preventDefault();
      if (!held.has(e.keyCode)) pressed.add(e.keyCode);
      held.add(e.keyCode);
    }
  }, { passive: false });
  addEventListener('keyup', function (e) { held.delete(e.keyCode); });

  // Pointer, quantized to the same uint16 wire format the envs step with.
  var mq = { x: 0, y: 0, down: false };
  var Q = function (v) { return Math.floor(Math.min(1, Math.max(0, v)) * 65535 + 0.5); };
  view.addEventListener('mousemove', function (e) {
    var r = view.getBoundingClientRect();
    mq.x = Q((e.clientX - r.left) / r.width);
    mq.y = Q((e.clientY - r.top) / r.height);
  });
  view.addEventListener('mousedown', function (e) { e.preventDefault(); mq.down = true; });
  addEventListener('mouseup', function () { mq.down = false; });

  var maxLives = 0;
  document.getElementById('reset-btn').onclick = function () {
    maxLives = 0;
    var s = Date.now() >>> 0;                    // a new episode, and record it
    var u = new URL(location.href);
    u.searchParams.set('seed', String(s));
    history.replaceState(null, '', u.toString());
    if (typeof window.resetGame === 'function') window.resetGame(s);
    this.blur();
  };

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'tester-scale') {
      var scale = Number(event.data.scale) || 1;
      document.documentElement.style.setProperty('--game-scale', String(scale));
    }
  });

  var FRAME_MS = 1000 / 60, last = 0;      // fixed-timestep games: pin to 60fps
  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    if (now - last < FRAME_MS - 0.5) return;
    last = now;
    setKeysDown(Array.from(held));
    pressed.forEach(function (c) { simulateKeyPress(c); });
    pressed.clear();
    setPointerPos(mq.x, mq.y);
    setButtons(mq.down ? 1 : 0);
    tick();
    var p = getPixelData();
    vctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
    if (typeof window.getGameState === 'function') {
      try {
        var st = window.getGameState();
        if (typeof st.lives === 'number' && st.lives > maxLives) maxLives = st.lives;
        var parts = ['Score: ' + st.score];
        if (maxLives > 1) parts.push('Lives: ' + st.lives);
        parts.push(st.gameState);
        document.getElementById('state').textContent = parts.join(' | ');
      } catch (e) {}
    }
  }
  requestAnimationFrame(renderLoop);
})();
"""


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
        path, _, query = self.path.partition("?")
        # ?p5=1 swaps the renderer for the CDN build. Viewing only: everything
        # measured, trained or replayed goes through the shim.
        use_p5 = "p5=1" in query

        if path == "/":
            self._send(200, "text/html", TESTER_HTML.encode())

        elif path == "/api/games":
            games = list_games()
            self._send(200, "application/json", json.dumps(games).encode())

        elif path == "/api/variants":
            # Only the variants that still have a file. The registry is the
            # generation history and outlives the games it records, so shipping
            # it whole puts entries in the picker that 404 when clicked.
            reg = {k: v for k, v in load_registry().items()
                   if (JS_DIR / f"{k}.js").exists()}
            self._send(200, "application/json", json.dumps(reg).encode())

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
            src = BACKUPS_DIR / filename
            if not src.exists():
                self._send(404, "text/plain", b"not found")
                return
            html = play_html(filename, src.read_text(), needs_matter(name), use_p5)
            self._send(200, "text/html", html.encode())

        elif path.startswith("/play/"):
            name = path.split("/play/")[1]
            fp = JS_DIR / f"{name}.js"
            if not fp.exists():
                self._send(404, "text/plain", b"not found")
                return
            html = play_html(name, fp.read_text(), needs_matter(name), use_p5)
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

    seeded = seed_workspace()
    if seeded:
        print(f"seeded games/js with {seeded} games from the shipped catalog")

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
