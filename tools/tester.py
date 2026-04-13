"""Lightweight game tester: play games in browser + refine via Gemini."""

import json
import os
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from google import genai

ROOT = Path(__file__).resolve().parent.parent
GAMES_DIR = ROOT / "games"
TEMPLATE_PATH = ROOT / "GAME_TEMPLATE.md"

MODELS = {
    "flash": "gemini-3-flash-preview",
    "pro": "gemini-3.1-pro-preview",
}

CLIENT = None


def get_client():
    global CLIENT
    if CLIENT is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("Warning: GEMINI_API_KEY not set, refinement will fail")
            return None
        CLIENT = genai.Client(api_key=api_key)
    return CLIENT


def strip_fences(text: str) -> str:
    m = re.search(r"```(?:javascript|js)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1).strip() if m else text.strip()


def list_games() -> list[str]:
    return sorted(p.stem for p in GAMES_DIR.glob("*.js"))


def needs_matter(name: str) -> bool:
    for catalog_file in GAMES_DIR.glob("*.json"):
        try:
            catalog = json.loads(catalog_file.read_text())
            for g in catalog:
                if g["name"] == name and g.get("physics") == "matter.js":
                    return True
        except Exception:
            pass
    return False


def refine_game(name: str, feedback: str, model_key: str) -> str:
    client = get_client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY not set")

    code = (GAMES_DIR / f"{name}.js").read_text()
    template = TEMPLATE_PATH.read_text()
    model = MODELS.get(model_key, MODELS["flash"])

    prompt = f"""Here is the current game code:

{code}

The game must conform to this template specification:

{template}

Player feedback:
{feedback}

Update the game to address the feedback while maintaining full compliance with the template.
Output ONLY the complete updated JavaScript code. No markdown fences, no explanation."""

    response = client.models.generate_content(model=model, contents=prompt)
    return strip_fences(response.text)


# -- HTML templates (inline) --------------------------------------------------

TESTER_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Game Tester</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #111; color: #eee; height: 100vh; display: flex; flex-direction: column; }
  #top { display: flex; flex: 1; min-height: 0; }
  #sidebar { width: 180px; background: #1a1a1a; border-right: 1px solid #333; overflow-y: auto; padding: 8px; }
  #sidebar h3 { font-size: 12px; color: #888; margin-bottom: 8px; }
  .game-btn { display: block; width: 100%; text-align: left; background: none; border: 1px solid transparent;
    color: #ccc; padding: 6px 8px; cursor: pointer; font-family: monospace; font-size: 12px; margin-bottom: 2px; }
  .game-btn:hover { background: #252525; }
  .game-btn.active { background: #333; color: #fff; border-color: #555; }
  #main { flex: 1; display: flex; justify-content: center; align-items: center; background: #0a0a0a; }
  #main iframe { border: none; width: 520px; height: 560px; }
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
  <div id="main"><span id="empty">Select a game</span></div>
</div>
<div id="bottom">
  <select id="model"><option value="flash">Flash</option><option value="pro">Pro</option></select>
  <input id="feedback" type="text" placeholder="Feedback for refinement..." disabled>
  <button id="refine-btn" onclick="refine()" disabled>Refine</button>
  <span id="status">Ready</span>
</div>
<script>
let currentGame = null;

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
  main.innerHTML = '<iframe src="/play/' + name + '"></iframe>';
  document.getElementById('feedback').disabled = false;
  document.getElementById('refine-btn').disabled = false;
  document.getElementById('status').textContent = 'Playing: ' + name;
}

async function refine() {
  const feedback = document.getElementById('feedback').value.trim();
  if (!feedback || !currentGame) return;
  const model = document.getElementById('model').value;
  const btn = document.getElementById('refine-btn');
  const status = document.getElementById('status');

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
      status.textContent = 'Refined! Reloading...';
      document.getElementById('feedback').value = '';
      const iframe = document.querySelector('#main iframe');
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
  body {{ margin: 0; background: #000; display: flex; flex-direction: column; align-items: center; }}
  #controls {{ position: fixed; top: 4px; right: 8px; color: #888; font: 11px monospace; z-index: 10; }}
  #controls button {{ background: #222; color: #aaa; border: 1px solid #444; padding: 2px 10px; cursor: pointer; font: 11px monospace; }}
</style>
</head>
<body>
<div id="controls">
  <button onclick="resetGame(Date.now()>>>0)">Reset</button>
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
            fp = GAMES_DIR / f"{name}.js"
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
                new_code = refine_game(name, feedback, model_key)
                (GAMES_DIR / f"{name}.js").write_text(new_code)
                self._send(200, "application/json", json.dumps({"success": True}).encode())
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
