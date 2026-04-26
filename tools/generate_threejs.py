"""Generate Three.js (v2) games from a JSON catalog using Gemini.

Parallel to tools/generate.py, but:
  - Two templates: THREE_GAME_TEMPLATE.md (simple) + THREE_COMPLEX_TEMPLATE.md (complex tier)
  - Auto-picks template by catalog filename: threejs_complex_games.json -> complex template
  - Override with --template
  - Targets games/threejs/ (separate from p5 games/js/)
  - Default catalog: games/catalogs/threejs_games.json
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
SIMPLE_TEMPLATE = ROOT / "THREE_GAME_TEMPLATE.md"
COMPLEX_TEMPLATE = ROOT / "THREE_COMPLEX_TEMPLATE.md"
GAMES_DIR = ROOT / "games"
CATALOGS_DIR = GAMES_DIR / "catalogs"
THREEJS_DIR = GAMES_DIR / "threejs"
DEFAULT_CATALOG = CATALOGS_DIR / "threejs_games.json"

# Engine integration files (used when --no-engine is NOT set, i.e. by default).
ENGINE_README = ROOT / "engine" / "three" / "README.md"
ENGINE_REFERENCE_GAME = ROOT / "games" / "threejs" / "crossy_road_3d_v2.js"


def pick_template(catalog_path: Path, override: Path | None) -> Path:
    """Auto-pick template based on catalog filename, unless overridden."""
    if override is not None:
        return override
    if "complex" in catalog_path.stem.lower():
        return COMPLEX_TEMPLATE
    return SIMPLE_TEMPLATE


def build_prompt(game: dict, template: str, ref_text: str, *, use_engine: bool = True) -> str:
    """Build the LLM prompt. When use_engine=True (default), the engine README
    + a reference engine-using game are included, and the LLM is told to
    target the engine API. When use_engine=False, the older standalone
    pattern is used (write everything from scratch)."""
    name = game["name"]
    mechanic = game.get("mechanic", "")
    actions = ", ".join(game.get("actions_used", []))

    ref_section = ""
    if ref_text:
        ref_section = f"""
Reference description of the original game:
{ref_text}
"""

    if use_engine:
        # Engine-using prompt: inject the engine README + a reference example.
        engine_readme = ENGINE_README.read_text() if ENGINE_README.exists() else ""
        ref_game_src = ENGINE_REFERENCE_GAME.read_text() if ENGINE_REFERENCE_GAME.exists() else ""
        engine_section = f"""
========================================================================
THIS GAME MUST USE THE FAST-LLM-GAMES ENGINE.
The runtime injects the engine as `globalThis.engine` before your file
runs. You write a thin game ON TOP of the engine — do NOT reimplement
the things the engine provides (camera setup, lighting, color palette,
mulberry32, particles, etc.).
========================================================================

Engine API reference (the LLM contract):

{engine_readme}

========================================================================
Reference engine-using game (study this for idiomatic API usage):
File: games/threejs/crossy_road_3d_v2.js

```javascript
{ref_game_src}
```

Note in particular:
  - Destructure helpers from `engine` at the top: `const {{ setupGame, drawCube, ... }} = engine;`
  - Do NOT destructure `render` from engine (would shadow the local render fn)
  - In your local render() function, call `engine.render(world)` explicitly
  - Use `engine.palette.*` / saturated color constants for semantic meaning
  - Use `engine.mulberry32(seed)` in resetGame to seed Math.random
========================================================================
"""

        prompt = f"""Generate a Three.js game implementing "{name}" USING THE FAST-LLM-GAMES ENGINE.

Mechanic: {mechanic}
Actions this game should use: {actions}
{ref_section}
{engine_section}

Critical requirements:
  - The lifecycle: setup({{ THREE, renderer, width, height }}), update(dt),
    render(), resetGame(seed), getGameState()
  - Action space: Discrete(15). Read action via engine.getCurrentAction()
    or globalThis.currentAction (integer 0..14)
  - Determinism: in resetGame, do `Math.random = engine.mulberry32(seed >>> 0)`
  - PER-SEED VARIATION: different seeds MUST produce visibly different
    episodes (different obstacle layouts, enemy positions, level geometry,
    etc.). All randomization belongs in resetGame() AFTER reseeding
    Math.random.
  - Use engine helpers wherever possible. Don't manually create THREE.Mesh
    instances when drawCube/drawSphere/drawPlane will do.
  - Do NOT write `import * as THREE from 'three'` or any import statement.
  - Do NOT define mulberry32 yourself — use engine.mulberry32.
  - Do NOT destructure `render` from engine — call engine.render(world)
    inside your local render() function instead.

Output ONLY the JavaScript code. No markdown fences, no explanation."""
        return prompt

    # --- Standalone (no engine) path — original behavior, kept for --no-engine ---
    prompt = f"""Generate a Three.js game implementing "{name}".

Mechanic: {mechanic}
Actions this game should use: {actions}
{ref_section}
The game MUST conform to this template specification exactly. Read the entire
template before writing — pay particular attention to:

  - The lifecycle: setup({{ THREE, renderer, width, height }}), update(dt),
    render(), resetGame(seed), getGameState()
  - Action space: Discrete(15). Read globalThis.currentAction (integer 0..14)
    in update(dt) — NOT keyIsDown. See the template's Action Space table for
    the full mapping. Most games use a subset (4-9 actions); use what fits.
  - Determinism: seed Math.random in resetGame via the mulberry32 helper
  - PER-SEED VARIATION: different seeds MUST produce visibly different
    episodes (different obstacle layouts, enemy positions, level geometry,
    etc.). All randomization belongs in resetGame() AFTER reseeding
    Math.random — do NOT hardcode a fixed level. Train/test generalization
    eval depends on this.
  - Rendering palette: primitive geometry, MeshBasic/Normal/Lambert/Phong
    materials, up to 3 lights, optional fog/PointsMaterial/per-vertex colors
    — see template "Rendering Palette" section. NO PBR, NO post-processing,
    NO external assets, NO AnimationMixer.
  - Use the THREE module argument passed to setup() — do NOT write
    `import * as THREE from 'three'` at the top of the file
  - Define mulberry32 as a local function in the file (the runtime may also
    inject it as a global, but defining it locally guarantees portability)

Template:

{template}

Output ONLY the JavaScript code. No markdown fences, no explanation."""
    return prompt


def generate_one(client: genai.Client, game: dict, template: str, model: str,
                 output_dir: Path, use_ref: bool, *, force: bool = False,
                 suffix: str = "", use_engine: bool = True):
    name = game["name"]
    out_name = f"{name}{suffix}"
    out_path = output_dir / f"{out_name}.js"

    # Refuse-by-default if the file already exists. User must opt in via
    # --force to replace, or via --suffix to write to a different filename.
    if out_path.exists() and not force:
        print(f"  SKIP {out_name}: already exists. Use --force to replace, or --suffix _v2 to write a versioned copy.")
        return False

    print(f"  Generating {out_name}...", end=" ", flush=True)

    ref_text = ""
    if use_ref and game.get("ref"):
        print("fetching ref...", end=" ", flush=True)
        ref_text = fetch_ref(game["ref"])

    prompt = build_prompt(game, template, ref_text, use_engine=use_engine)

    try:
        t0 = time.time()
        response = client.models.generate_content(model=model, contents=prompt)
        duration = time.time() - t0

        raw_output = response.text
        code = strip_fences(raw_output)

        # Always back up before any overwrite (defense-in-depth even with --force).
        if out_path.exists():
            backup_game(out_name, output_dir)
        out_path.write_text(code)

        save_log(out_name, model, prompt, raw_output, code, duration, "generate-threejs")
        print(f"OK ({len(code)} bytes, {duration:.1f}s) -> {out_path}")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Generate Three.js (v2) games via Gemini")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG,
                        help="Path to a JSON catalog (default: threejs_games.json)")
    parser.add_argument("--name", help="Generate only this game from the catalog")
    parser.add_argument("--model", choices=["flash", "pro"], default="pro")
    parser.add_argument("--output-dir", type=Path, default=THREEJS_DIR)
    parser.add_argument("--ref", action="store_true",
                        help="Fetch ref URLs and include in prompt")
    parser.add_argument("--template", type=Path, default=None,
                        help="Override template path. Defaults to simple template, or "
                             "complex template if catalog filename contains 'complex'.")
    parser.add_argument("--force", action="store_true",
                        help="Overwrite existing game files (a backup is still written to "
                             "games/backups/ first). Default is to SKIP existing files.")
    parser.add_argument("--suffix", default="",
                        help="Append suffix to output filename (e.g. --suffix _v2 writes "
                             "crossy_road_3d_v2.js instead of crossy_road_3d.js). Lets you "
                             "keep the original alongside a regenerated version.")
    parser.add_argument("--no-engine", action="store_true",
                        help="Generate STANDALONE games (no engine usage). Default is to "
                             "generate engine-using games — the engine README + a reference "
                             "engine-using game are injected into the prompt, and the LLM "
                             "is told to use engine.drawCube / engine.palette / engine.mulberry32 "
                             "etc. instead of writing those itself.")
    args = parser.parse_args()
    use_engine = not args.no_engine

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: Set GEMINI_API_KEY environment variable")
        raise SystemExit(1)

    client = genai.Client(api_key=api_key)
    model = MODELS[args.model]
    template_path = pick_template(args.catalog, args.template)
    template = template_path.read_text()
    print(f"Template: {template_path.name}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    catalog = json.loads(args.catalog.read_text())
    print(f"\nCatalog: {args.catalog.name} ({len(catalog)} games), model: {model}")
    print(f"Output:  {args.output_dir}")

    games = [g for g in catalog if g["name"] == args.name] if args.name else catalog
    if args.name and not games:
        print(f"  Game '{args.name}' not found in {args.catalog.name}")
        raise SystemExit(1)

    if args.force:
        print("MODE: --force enabled (existing files will be backed up + overwritten)")
    elif args.suffix:
        print(f"MODE: writing with suffix '{args.suffix}' (originals preserved at <name>.js)")
    else:
        print("MODE: skip-if-exists (default). Use --force to overwrite or --suffix _v2 for versioned output.")

    if use_engine:
        print(f"ENGINE: ON (default). Prompts include engine README ({ENGINE_README.name})")
        if ENGINE_REFERENCE_GAME.exists():
            print(f"        + reference game ({ENGINE_REFERENCE_GAME.name})")
        if not ENGINE_README.exists():
            print(f"        WARNING: {ENGINE_README} not found, prompt will be missing engine docs")
    else:
        print("ENGINE: OFF (--no-engine). Standalone games only — game writes everything from scratch.")

    n_generated = n_skipped = 0
    for i, game in enumerate(games):
        wrote = generate_one(client, game, template, model, args.output_dir, args.ref,
                             force=args.force, suffix=args.suffix, use_engine=use_engine)
        if wrote: n_generated += 1
        else: n_skipped += 1
        if i < len(games) - 1 and wrote:
            time.sleep(2)
    print(f"\nDone: {n_generated} generated, {n_skipped} skipped.")


if __name__ == "__main__":
    main()
