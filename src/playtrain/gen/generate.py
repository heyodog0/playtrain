"""Generate p5.js games from JSON catalogs using Gemini."""

import argparse
import json
import os
import re
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx
from google import genai
from google.genai import types

from playtrain._paths import repo_root as _repo_root
ROOT = _repo_root() or Path.cwd()
from playtrain._paths import asset as _asset_path
TEMPLATE_PATH = _asset_path("GAME_TEMPLATE.md")
GAMES_DIR = ROOT / "games"
CATALOGS_DIR = GAMES_DIR / "catalogs"
JS_DIR = GAMES_DIR / "js"
CATALOGS = sorted(CATALOGS_DIR.glob("*_games.json"))

MODELS = {
    "flash": "gemini-3-flash-preview",
    "pro": "gemini-3.1-pro-preview",
}

MAX_REF_CHARS = 2000
MAX_SOURCE_CHARS = 16000
PROCGEN_SRC_DIR = GAMES_DIR / "procgen_src"


class _HTMLToText(HTMLParser):
    """Extract text from main content area only, skipping nav/chrome."""
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._in_main = False
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        # Enter main content area
        if tag == "article" or attr_dict.get("role") == "main":
            self._in_main = True
        # Skip script/style even inside main
        if tag in ("script", "style", "nav", "figure"):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "figure"):
            self._skip_depth = max(0, self._skip_depth - 1)
        if tag == "article":
            self._in_main = False

    def handle_data(self, data):
        if self._in_main and self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = " ".join(self._parts)
        return re.sub(r"\s+", " ", raw).strip()


HEADERS = {"User-Agent": "gym-gen/0.1 (game research project; contact@example.com)"}


def _fetch_wikipedia(url: str) -> str:
    """Fetch Wikipedia article summary via REST API."""
    title = url.rstrip("/").split("/wiki/")[-1]
    api_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
    resp = httpx.get(api_url, follow_redirects=True, timeout=10, headers=HEADERS)
    resp.raise_for_status()
    return resp.json().get("extract", "")


def _fetch_appstore(url: str) -> str:
    """Fetch App Store app description via iTunes Lookup API."""
    m = re.search(r"/id(\d+)", url)
    if not m:
        return ""
    app_id = m.group(1)
    resp = httpx.get(f"https://itunes.apple.com/lookup?id={app_id}&country=us", timeout=10)
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        return ""
    app = results[0]
    return f"{app.get('trackName', '')}: {app.get('description', '')}"


def _fetch_steam(url: str) -> str:
    """Extract game description from Steam page, skipping reviews."""
    resp = httpx.get(url, follow_redirects=True, timeout=10, headers=HEADERS)
    resp.raise_for_status()
    html = resp.text

    # Get the short snippet
    parts = []
    m = re.search(r'game_description_snippet">\s*(.*?)\s*</div>', html, re.DOTALL)
    if m:
        parts.append(m.group(1).strip())

    # Get the "About This Game" section
    m = re.search(r'game_area_description"[^>]*>(.*?)</div>', html, re.DOTALL)
    if m:
        about = re.sub(r"<[^>]+>", " ", m.group(1))
        about = re.sub(r"\s+", " ", about).strip()
        parts.append(about)

    return "\n".join(parts)


def fetch_ref(url: str) -> str:
    """Fetch a URL and return concise plain text from main content."""
    try:
        if "wikipedia.org/wiki/" in url:
            text = _fetch_wikipedia(url)
        elif "apps.apple.com/" in url:
            text = _fetch_appstore(url)
        elif "store.steampowered.com/" in url:
            text = _fetch_steam(url)
        else:
            resp = httpx.get(url, follow_redirects=True, timeout=10, headers=HEADERS)
            resp.raise_for_status()
            parser = _HTMLToText()
            parser.feed(resp.text)
            text = parser.get_text()
            if not text:
                text = re.sub(r"<[^>]+>", " ", resp.text)
                text = re.sub(r"\s+", " ", text).strip()

        if len(text) > MAX_REF_CHARS:
            text = text[:MAX_REF_CHARS] + "..."
        return text
    except Exception as e:
        print(f"    Warning: could not fetch {url}: {e}")
        return ""


def load_image_ref(game: dict):
    """Load a reference screenshot for the game, if the catalog entry has an
    `image` field (URL or repo-relative path). Returns (bytes, mime) or None."""
    ref = game.get("image")
    if not ref:
        return None
    try:
        if ref.startswith("http"):
            resp = httpx.get(ref, follow_redirects=True, timeout=15, headers=HEADERS)
            resp.raise_for_status()
            data = resp.content
            mime = resp.headers.get("content-type", "image/png").split(";")[0]
        else:
            path = ROOT / ref
            data = path.read_bytes()
            mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        return data, mime
    except Exception as e:
        print(f"    Warning: could not load image {ref}: {e}")
        return None


def strip_fences(text: str) -> str:
    """Remove markdown code fences if present."""
    m = re.search(r"```(?:javascript|js)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1).strip() if m else text.strip()


def load_source_context(name: str) -> str:
    """Load local source context for games with checked-in reference code."""
    path = PROCGEN_SRC_DIR / f"{name}.cpp"
    if not path.exists():
        return ""

    text = path.read_text()
    if len(text) > MAX_SOURCE_CHARS:
        text = text[:MAX_SOURCE_CHARS] + "\n// ... truncated ...\n"
    return text


def build_prompt(game: dict, template: str, ref_text: str, source_text: str, include_mechanic: bool = True, has_image: bool = False) -> str:
    name = game["name"]
    mechanic = game.get("mechanic", "")
    actions = ", ".join(game.get("actions_used", []))
    physics = game.get("physics", "")

    mechanic_line = f"Mechanic: {mechanic}\n" if include_mechanic and mechanic else ""

    image_note = (
        "A reference screenshot of the original game is attached. Match its overall "
        "look and feel — screen layout, the shape/style of the playfield, colors, and "
        "proportions — so the result is recognizably this game. You may adapt exact "
        "details to fit the template constraints below; do not copy pixel-for-pixel.\n"
        if has_image else ""
    )

    ref_section = ""
    if ref_text:
        ref_section = f"""
Reference description of the original game:
{ref_text}
"""

    source_section = ""
    if source_text:
        source_section = f"""
Reference implementation source code:
```cpp
{source_text}
```
"""

    prompt = f"""Generate a p5.js game implementing "{name}".

{image_note}{mechanic_line}Actions this game should use: {actions}
{"This game requires Matter.js physics (available as global `Matter`)." if physics else ""}
{ref_section}
{source_section}
The game MUST conform to this template specification exactly:

{template}

Output ONLY the JavaScript code. No markdown fences, no explanation."""
    return prompt


LOG_DIR = ROOT / "games" / "logs"


def save_log(name: str, model: str, prompt: str, raw_output: str, code: str, duration_s: float, action: str):
    """Save a generation/refinement log entry."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    log = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "action": action,
        "game": name,
        "model": model,
        "duration_s": round(duration_s, 2),
        "prompt_chars": len(prompt),
        "output_chars": len(raw_output),
        "code_chars": len(code),
        "prompt": prompt,
        "raw_output": raw_output,
    }
    log_path = LOG_DIR / f"{ts}_{name}_{action}.json"
    log_path.write_text(json.dumps(log, indent=2))
    return log_path


def backup_game(name: str, output_dir: Path):
    """Backup existing game file before overwriting."""
    src = output_dir / f"{name}.js"
    if not src.exists():
        return
    backup_dir = GAMES_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = backup_dir / f"{name}_{ts}.js"
    dst.write_text(src.read_text())


def generate_one(client: genai.Client, game: dict, template: str, model: str, output_dir: Path, use_ref: bool, include_mechanic: bool = True):
    name = game["name"]
    out_path = output_dir / f"{name}.js"
    print(f"  Generating {name}...", end=" ", flush=True)

    ref_text = ""
    if use_ref and game.get("ref"):
        print(f"fetching ref...", end=" ", flush=True)
        ref_text = fetch_ref(game["ref"])

    source_text = load_source_context(name)
    if source_text:
        print("using source...", end=" ", flush=True)

    image = load_image_ref(game)
    if image:
        print("using image...", end=" ", flush=True)

    prompt = build_prompt(game, template, ref_text, source_text, include_mechanic, has_image=bool(image))

    if image:
        contents = [types.Part.from_bytes(data=image[0], mime_type=image[1]), prompt]
    else:
        contents = prompt

    try:
        t0 = time.time()
        response = client.models.generate_content(model=model, contents=contents)
        duration = time.time() - t0

        raw_output = response.text
        code = strip_fences(raw_output)

        backup_game(name, output_dir)
        out_path.write_text(code)

        log_path = save_log(name, model, prompt, raw_output, code, duration, "generate")
        print(f"OK ({len(code)} bytes, {duration:.1f}s) -> {out_path}")
    except Exception as e:
        print(f"FAILED: {e}")


def main():
    parser = argparse.ArgumentParser(description="Generate p5.js games via Gemini")
    parser.add_argument("--catalog", type=Path, help="Path to a JSON catalog file")
    parser.add_argument("--all", action="store_true", help="Process all catalogs")
    parser.add_argument("--name", help="Generate only this game from the catalog")
    parser.add_argument("--model", choices=["flash", "pro"], default="pro")
    parser.add_argument("--output-dir", type=Path, default=JS_DIR)
    parser.add_argument("--ref", action="store_true", help="Fetch ref URLs and include in prompt")
    parser.add_argument("--no-mechanic", action="store_true", help="Omit the catalog mechanic line from the prompt")
    args = parser.parse_args()

    if not args.catalog and not args.all:
        parser.error("Specify --catalog or --all")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY environment variable")
        raise SystemExit(1)

    # google-genai prefers GOOGLE_API_KEY when both are set and warns about it, so a
    # stale GOOGLE_API_KEY would silently bill the wrong account. Hide it for the call
    # and put it back, the same way refine.py does.
    _google = os.environ.pop("GOOGLE_API_KEY", None)
    try:
        client = genai.Client(api_key=api_key)
    finally:
        if _google is not None:
            os.environ["GOOGLE_API_KEY"] = _google
    model = MODELS[args.model]
    template = TEMPLATE_PATH.read_text()

    catalogs = CATALOGS if args.all else [args.catalog]

    for catalog_path in catalogs:
        catalog = json.loads(catalog_path.read_text())
        print(f"\nCatalog: {catalog_path.name} ({len(catalog)} games), model: {model}")

        games = [g for g in catalog if g["name"] == args.name] if args.name else catalog
        if args.name and not games:
            print(f"  Game '{args.name}' not found in {catalog_path.name}")
            continue

        for i, game in enumerate(games):
            generate_one(client, game, template, model, args.output_dir, args.ref, not args.no_mechanic)
            if i < len(games) - 1:
                time.sleep(2)


if __name__ == "__main__":
    main()
