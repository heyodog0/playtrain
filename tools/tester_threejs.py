"""Browser tester for Three.js (v2) generated games.

Parallel to tools/tester.py (which handles p5 games in games/js/), this
serves games from games/threejs/ inside a Three.js harness page.

Keyboard -> currentAction mapping:
  arrows -> LEFT(1)/RIGHT(2)/UP(3)/DOWN(4); SPACE -> D(5);
  LEFT+SPACE -> 6; RIGHT+SPACE -> 7; otherwise NOOP(0).

Run:  uv run python tools/tester_threejs.py [--port 3001]
Or:   just tester-three
"""

from __future__ import annotations

import argparse
import socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THREEJS_DIR = ROOT / "games" / "threejs"


def list_games() -> list[str]:
    if not THREEJS_DIR.exists():
        return []
    return sorted(p.stem for p in THREEJS_DIR.glob("*.js"))


# -------------- HTML -----------------------------------------------------------

INDEX_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Three.js Game Tester</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #111; color: #eee; height: 100vh; display: flex; }
  #sidebar { width: 200px; background: #1a1a1a; border-right: 1px solid #333; overflow-y: auto; padding: 10px; }
  #sidebar h3 { font-size: 12px; color: #888; margin-bottom: 8px; text-transform: uppercase; }
  #sidebar .empty { color: #666; font-size: 11px; line-height: 1.5; }
  .game-btn { display: block; width: 100%; text-align: left; background: none; border: 1px solid transparent;
    color: #ccc; padding: 6px 8px; cursor: pointer; font-family: monospace; font-size: 12px; margin-bottom: 2px; }
  .game-btn:hover { background: #252525; }
  .game-btn.active { background: #333; color: #fff; border-color: #555; }
  #main { flex: 1; display: flex; justify-content: center; align-items: center; background: #0a0a0a; }
  #stage { width: 540px; height: 540px; border: 1px solid #2d2d2d; border-radius: 12px; overflow: hidden; background: #000; }
  iframe { border: none; width: 100%; height: 100%; }
  #footer { position: fixed; bottom: 8px; left: 220px; right: 0; text-align: center; color: #555; font-size: 11px; }
  kbd { background: #222; border: 1px solid #444; padding: 1px 4px; border-radius: 2px; color: #aaa; font-size: 10px; }
</style></head><body>
<div id="sidebar">
  <h3>Three.js games (v2)</h3>
  <div id="games"></div>
  <div id="empty" class="empty" style="display:none;">
    No games in <code>games/threejs/</code> yet.<br><br>
    Generate one with:<br>
    <code>just gen-three runner_3d</code>
  </div>
</div>
<div id="main"><div id="stage"><iframe id="frame"></iframe></div></div>
<div id="footer">
  Controls: <kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd> + <kbd>SPACE</kbd> &nbsp; &middot; &nbsp;
  click the iframe to focus
</div>
<script>
async function loadGames() {
  const res = await fetch('/api/games-list');
  const games = await res.json();
  const container = document.getElementById('games');
  const empty = document.getElementById('empty');
  if (games.length === 0) { empty.style.display = 'block'; return; }
  container.innerHTML = games.map(g => `<button class="game-btn" data-game="${g}">${g}</button>`).join('');
  container.querySelectorAll('.game-btn').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('frame').src = '/play/' + btn.dataset.game;
    };
  });
  if (games.length > 0) container.querySelector('.game-btn').click();
}
loadGames();
</script>
</body></html>"""


PLAY_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{name}</title>
<style>
  body {{ margin: 0; background: #000; color: #eee; font-family: monospace; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }}
  canvas {{ display: block; max-width: 100%; max-height: calc(100% - 60px); }}
  #hud {{ position: fixed; top: 6px; left: 8px; right: 8px; display: flex; justify-content: space-between; font-size: 11px; color: #888; pointer-events: none; }}
  #hud button {{ pointer-events: auto; background: #222; color: #aaa; border: 1px solid #444; padding: 2px 10px; cursor: pointer; font: 11px monospace; }}
  #err {{ position: fixed; bottom: 8px; left: 8px; right: 8px; color: #e55; font-size: 11px; white-space: pre-wrap; }}
</style></head><body>
<div id="hud">
  <span id="state">loading...</span>
  <button id="reset-btn">Reset</button>
</div>
<div id="err"></div>
<script type="importmap">
{{
  "imports": {{ "three": "https://unpkg.com/three@0.161.0/build/three.module.js" }}
}}
</script>
<script type="module">
import * as THREE from 'three';

const errEl = document.getElementById('err');
const stateEl = document.getElementById('state');

function showErr(msg) {{ errEl.textContent = String(msg); console.error(msg); }}
window.addEventListener('error', e => showErr(e.message + ' (line ' + e.lineno + ')'));
window.addEventListener('unhandledrejection', e => showErr('Unhandled: ' + e.reason));

// Keyboard -> action mapping
const keys = new Set();
window.addEventListener('keydown', e => {{ keys.add(e.code); e.preventDefault(); }});
window.addEventListener('keyup',   e => {{ keys.delete(e.code); e.preventDefault(); }});

function currentActionFromKeys() {{
  const left = keys.has('ArrowLeft'), right = keys.has('ArrowRight');
  const up = keys.has('ArrowUp'), down = keys.has('ArrowDown');
  const space = keys.has('Space');
  if (left  && space) return 6;
  if (right && space) return 7;
  if (space) return 5;
  if (left)  return 1;
  if (right) return 2;
  if (up)    return 3;
  if (down)  return 4;
  return 0;
}}

// mulberry32 — exposed as a global so generated games can rely on it
window.mulberry32 = function(seed) {{
  let t = seed >>> 0;
  return () => {{
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }};
}};

// Set up renderer + canvas
const W = 512, H = 512;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.insertBefore(canvas, document.getElementById('err'));
const renderer = new THREE.WebGLRenderer({{ canvas, antialias: false }});
renderer.setSize(W, H, false);
window.renderer = renderer;

// Load the game source as a classic script and let it define globals.
async function loadGame() {{
  const src = await (await fetch('/api/games/{name}')).text();
  // Run in global scope so function declarations (setup, update, etc.) become window.*
  // eslint-disable-next-line no-new-func
  (new Function(src + "\\n; window.setup = typeof setup==='function'?setup:undefined;"
                    + " window.update = typeof update==='function'?update:undefined;"
                    + " window.render = typeof render==='function'?render:undefined;"
                    + " window.resetGame = typeof resetGame==='function'?resetGame:undefined;"
                    + " window.getGameState = typeof getGameState==='function'?getGameState:undefined;"))();
  const required = ['setup','update','render','resetGame','getGameState'];
  for (const r of required) {{
    if (typeof window[r] !== 'function') throw new Error('game missing ' + r + '()');
  }}
}}

let lastT = performance.now();
let frame = 0;

function loop(t) {{
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  window.currentAction = currentActionFromKeys();
  try {{
    window.update(dt);
    window.render();
    if (frame++ % 12 === 0) {{
      const s = window.getGameState();
      stateEl.textContent = `score: ${{s.score}}  |  lives: ${{s.lives}}  |  ${{s.gameState}}`;
    }}
  }} catch (e) {{ showErr(e.message + '\\n' + (e.stack || '')); return; }}
  requestAnimationFrame(loop);
}}

document.getElementById('reset-btn').onclick = () => {{
  window.resetGame((Date.now() & 0x7fffffff) >>> 0);
  document.getElementById('reset-btn').blur();
}};

(async () => {{
  try {{
    await loadGame();
    window.setup({{ THREE, renderer, width: W, height: H }});
    window.resetGame((Date.now() & 0x7fffffff) >>> 0);
    requestAnimationFrame(loop);
  }} catch (e) {{ showErr(e.message + '\\n' + (e.stack || '')); }}
}})();
</script>
</body></html>"""


# -------------- HTTP handler ---------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # quiet

    def _send(self, code, body, content_type="text/html; charset=utf-8"):
        body_bytes = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/":
            return self._send(200, INDEX_HTML)

        if path == "/api/games-list":
            import json
            return self._send(200, json.dumps(list_games()), "application/json")

        if path.startswith("/play/"):
            name = path[len("/play/"):].strip("/")
            if name not in list_games():
                return self._send(404, f"unknown game: {name}", "text/plain")
            return self._send(200, PLAY_HTML.format(name=name))

        if path.startswith("/api/games/"):
            name = path[len("/api/games/"):].strip("/")
            if name not in list_games():
                return self._send(404, "// not found", "application/javascript")
            src = (THREEJS_DIR / f"{name}.js").read_text()
            return self._send(200, src, "application/javascript")

        return self._send(404, "not found", "text/plain")


def main():
    parser = argparse.ArgumentParser(description="Browser tester for Three.js v2 games")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()

    class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
        daemon_threads = True

    games = list_games()
    print(f"\n  Three.js tester:  http://localhost:{args.port}")
    print(f"  Games dir:        {THREEJS_DIR} ({len(games)} game{'s' if len(games)!=1 else ''})")
    if not games:
        print(f"  (empty — generate one with: just gen-three runner_3d)")
    print("  Ctrl-C to stop.\n")

    server = ThreadingHTTPServer(("", args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping.")
        server.shutdown()


if __name__ == "__main__":
    main()
