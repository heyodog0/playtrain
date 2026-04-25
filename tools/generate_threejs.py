"""Generate Three.js (v2) games from a JSON catalog using Gemini.

Parallel to tools/generate.py, but:
  - Uses THREE_GAME_TEMPLATE.md instead of GAME_TEMPLATE.md
  - Targets games/threejs/ (separate from p5 games/js/)
  - Default catalog: games/catalogs/threejs_games.json
  - Prompt explains the Three.js lifecycle + the THREE/renderer args to setup()
"""

import argparse
import json
import os
import time
from pathlib import Path

from google import genai

# Reuse helpers from the p5 generator (ref fetching, html stripping, fence stripping, logging).
from generate import (
    MODELS,
    fetch_ref,
    strip_fences,
    save_log,
    backup_game,
)

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = ROOT / "THREE_GAME_TEMPLATE.md"
GAMES_DIR = ROOT / "games"
CATALOGS_DIR = GAMES_DIR / "catalogs"
THREEJS_DIR = GAMES_DIR / "threejs"
DEFAULT_CATALOG = CATALOGS_DIR / "threejs_games.json"


def build_prompt(game: dict, template: str, ref_text: str) -> str:
    name = game["name"]
    mechanic = game.get("mechanic", "")
    actions = ", ".join(game.get("actions_used", []))

    ref_section = ""
    if ref_text:
        ref_section = f"""
Reference description of the original game:
{ref_text}
"""

    prompt = f"""Generate a Three.js game implementing "{name}".

Mechanic: {mechanic}
Actions this game should use: {actions}
{ref_section}
The game MUST conform to this template specification exactly. Read the entire
template before writing — pay particular attention to:

  - The lifecycle: setup({{ THREE, renderer, width, height }}), update(dt),
    render(), resetGame(seed), getGameState()
  - Reading the action via globalThis.currentAction (NOT keyIsDown)
  - Determinism: seed Math.random in resetGame via the mulberry32 helper
  - PER-SEED VARIATION: different seeds MUST produce visibly different
    episodes (different obstacle layouts, enemy positions, level geometry,
    etc.). All randomization belongs in resetGame() AFTER reseeding
    Math.random — do NOT hardcode a fixed level. Train/test generalization
    eval depends on this.
  - Rendering constraints: primitive geometry only, MeshBasic/Normal/Lambert
    materials only, at most 1 AmbientLight + 1 DirectionalLight, no
    post-processing, no external assets
  - Use the THREE module argument passed to setup() — do NOT write
    `import * as THREE from 'three'` at the top of the file
  - Define mulberry32 as a local function in the file (the runtime may also
    inject it as a global, but defining it locally guarantees portability)

Template:

{template}

Output ONLY the JavaScript code. No markdown fences, no explanation."""
    return prompt


def generate_one(client: genai.Client, game: dict, template: str, model: str, output_dir: Path, use_ref: bool):
    name = game["name"]
    out_path = output_dir / f"{name}.js"
    print(f"  Generating {name}...", end=" ", flush=True)

    ref_text = ""
    if use_ref and game.get("ref"):
        print("fetching ref...", end=" ", flush=True)
        ref_text = fetch_ref(game["ref"])

    prompt = build_prompt(game, template, ref_text)

    try:
        t0 = time.time()
        response = client.models.generate_content(model=model, contents=prompt)
        duration = time.time() - t0

        raw_output = response.text
        code = strip_fences(raw_output)

        backup_game(name, output_dir)
        out_path.write_text(code)

        save_log(name, model, prompt, raw_output, code, duration, "generate-threejs")
        print(f"OK ({len(code)} bytes, {duration:.1f}s) -> {out_path}")
    except Exception as e:
        print(f"FAILED: {e}")


def main():
    parser = argparse.ArgumentParser(description="Generate Three.js (v2) games via Gemini")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG,
                        help="Path to a JSON catalog (default: threejs_games.json)")
    parser.add_argument("--name", help="Generate only this game from the catalog")
    parser.add_argument("--model", choices=["flash", "pro"], default="pro")
    parser.add_argument("--output-dir", type=Path, default=THREEJS_DIR)
    parser.add_argument("--ref", action="store_true",
                        help="Fetch ref URLs and include in prompt")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY environment variable")
        raise SystemExit(1)

    client = genai.Client(api_key=api_key)
    model = MODELS[args.model]
    template = TEMPLATE_PATH.read_text()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    catalog = json.loads(args.catalog.read_text())
    print(f"\nCatalog: {args.catalog.name} ({len(catalog)} games), model: {model}")
    print(f"Output:  {args.output_dir}")

    games = [g for g in catalog if g["name"] == args.name] if args.name else catalog
    if args.name and not games:
        print(f"  Game '{args.name}' not found in {args.catalog.name}")
        raise SystemExit(1)

    for i, game in enumerate(games):
        generate_one(client, game, template, model, args.output_dir, args.ref)
        if i < len(games) - 1:
            time.sleep(2)


if __name__ == "__main__":
    main()
