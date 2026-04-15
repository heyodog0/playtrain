"""Lightweight game tester: play games in browser + refine via Gemini."""

import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

if __package__:
    from .refine import refine_game
else:
    from refine import refine_game

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / "games"
CATALOGS_DIR = GAMES_DIR / "catalogs"
JS_DIR = GAMES_DIR / "js"


def list_games() -> list[str]:
    return sorted(p.stem for p in JS_DIR.glob("*.js"))


def needs_matter(name: str) -> bool:
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
  #main.large-view { --stage-width: 860px; --stage-height: 900px; }
  #main.large-view #stage { box-shadow: 0 30px 90px rgba(0,0,0,0.6); }
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
</style>
</head>
<body>
<div id="top">
  <div id="sidebar"><h3>Games</h3><div id="game-list"></div></div>
  <div id="main">
    <button id="view-toggle" onclick="toggleBigScreen()" disabled>Big Screen</button>
    <span id="empty">Select a game</span>
  </div>
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

async function loadGames() {
  const res = await fetch('/api/games');
  const games = await res.json();
  const list = document.getElementById('game-list');
  list.innerHTML = '';
  games.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'game-btn';
    btn.textContent = name;
    btn.onclick = () => selectGame(name);
    list.appendChild(btn);
  });
}

function selectGame(name) {
  currentGame = name;
  document.querySelectorAll('.game-btn').forEach(b => b.classList.toggle('active', b.textContent === name));
  const main = document.getElementById('main');
  main.querySelector('#empty')?.remove();
  const oldStage = document.getElementById('stage');
  if (oldStage) oldStage.remove();
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.innerHTML = '<iframe id="game-frame" src="/play/' + name + '"></iframe>';
  main.appendChild(stage);
  stage.querySelector('iframe').addEventListener('load', syncBigScreen);
  document.getElementById('feedback').disabled = false;
  document.getElementById('refine-btn').disabled = false;
  document.getElementById('view-toggle').disabled = false;
  document.getElementById('status').textContent = 'Playing: ' + name;
  syncBigScreen();
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

  try {
    const res = await fetch('/api/refine', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: currentGame, feedback, model})
    });
    const data = await res.json();
    if (data.success) {
      const strategy = data.strategy ? ' (' + data.strategy + ')' : '';
      status.textContent = 'Refined in ' + data.duration_s + 's' + strategy + '. Reloading...';
      document.getElementById('feedback').value = '';
      const iframe = document.getElementById('game-frame');
      iframe.src = iframe.src;
    } else {
      status.textContent = 'Error: ' + (data.error || 'unknown');
    }
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
}

document.getElementById('feedback').addEventListener('keydown', e => { if (e.key === 'Enter') refine(); });
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
  <button id="reset-btn" onclick="resetGame(Date.now()>>>0); this.blur();">Reset</button>
  <span id="state"></span>
</div>
<script src="/api/games/{name}"></script>
<script>
// Wrap setup to auto-call resetGame after canvas creation
const _origSetup = typeof setup === 'function' ? setup : function(){{}};
setup = function() {{
  _origSetup();
  if (typeof resetGame === 'function') resetGame(Date.now() >>> 0);
}};
// State overlay
setInterval(() => {{
  if (typeof getGameState === 'function') {{
    const s = getGameState();
    document.getElementById('state').textContent =
      'Score: ' + s.score + ' | Lives: ' + s.lives + ' | ' + s.gameState;
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

        elif path.startswith("/api/games/"):
            name = path.split("/api/games/")[1]
            fp = JS_DIR / f"{name}.js"
            if fp.exists():
                self._send(200, "application/javascript", fp.read_bytes())
            else:
                self._send(404, "text/plain", b"not found")

        elif path.startswith("/play/"):
            name = path.split("/play/")[1]
            matter = MATTER_TAG if needs_matter(name) else ""
            html = PLAY_HTML.format(name=name, matter_tag=matter)
            self._send(200, "text/html", html.encode())

        else:
            self._send(404, "text/plain", b"not found")

    def do_POST(self):
        if self.path == "/api/refine":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            name = body["name"]
            feedback = body["feedback"]
            model_key = body.get("model", "flash")

            try:
                result = refine_game(name, feedback, model_key)
                self._send(200, "application/json", json.dumps({
                    "success": True,
                    "duration_s": result["duration_s"],
                    "strategy": result.get("strategy"),
                }).encode())
            except Exception as e:
                self._send(500, "application/json", json.dumps({"success": False, "error": str(e)}).encode())
        else:
            self._send(404, "text/plain", b"not found")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Game tester server")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()

    server = HTTPServer(("", args.port), Handler)
    print(f"Tester running at http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")


if __name__ == "__main__":
    main()
