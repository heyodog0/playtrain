"""Fork a game into a named variant via natural-language edit.

A *variant* is an ordinary game file in ``games/js/`` produced by the same
NL->code transform as refine, but written to a NEW name so the parent is left
untouched. This lets you spin up many prototype siblings from one base game.

Design:
- Reuses ``refine.refine_game(..., apply=False)`` to generate the code (it
  already returns new code without writing or backing up the source), so we do
  not duplicate the chunk/patch/rewrite machinery.
- Lineage lives in ``games/variants.json`` (a registry keyed by variant name):
  parent, base_root, prompt, model, created, physics. The registry is the
  single source of truth for (a) the tester's variant tree, (b) matter.js
  detection for variants, and (c) excluding prototypes from bulk ``--all`` runs.
- Naming: variant name = ``{base_root}.{suffix}`` — two levels deep so names
  stay short even when forking a variant-of-a-variant. The real parent is
  recorded in the registry, not the name.
- ``promote`` drops a variant from the registry so it graduates into a
  first-class game (picked up by ``--all``). ``delete`` backs it up and removes
  it.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

if __package__:
    from .refine import refine_game, backup_game
else:
    from refine import refine_game, backup_game

from playtrain._paths import repo_root as _repo_root
ROOT = _repo_root() or Path.cwd()
GAMES_DIR = ROOT / "games"
JS_DIR = GAMES_DIR / "js"
CATALOGS_DIR = GAMES_DIR / "catalogs"
REGISTRY_PATH = GAMES_DIR / "variants.json"


# -- registry -----------------------------------------------------------------

def load_registry() -> dict:
    if REGISTRY_PATH.exists():
        try:
            return json.loads(REGISTRY_PATH.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_registry(reg: dict):
    REGISTRY_PATH.write_text(json.dumps(reg, indent=2, sort_keys=True) + "\n")


def variant_names() -> set[str]:
    """Names of all registered variants — used to exclude them from --all."""
    return set(load_registry().keys())


def resolve_root(name: str, reg: dict | None = None) -> str:
    """Walk the parent chain to the base (non-variant) game name."""
    reg = load_registry() if reg is None else reg
    seen: set[str] = set()
    while name in reg and name not in seen:
        seen.add(name)
        name = reg[name].get("base_root") or reg[name]["parent"]
    return name


# -- physics lookup (mirrors tester.needs_matter, but for the base game) -------

def lookup_physics(name: str) -> str | None:
    """Return the physics engine declared for a base game in the catalogs."""
    for catalog_file in CATALOGS_DIR.glob("*.json"):
        try:
            catalog = json.loads(catalog_file.read_text())
        except Exception:
            continue
        for g in catalog:
            if g.get("name") == name and g.get("physics"):
                return g["physics"]
    return None


# -- naming -------------------------------------------------------------------

def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug


def unique_name(root: str, suffix: str, reg: dict) -> str:
    """Build {root}.{suffix}, auto-numbering when suffix is blank/taken."""
    suffix = slugify(suffix)
    if not suffix:
        n = 1
        while f"{root}.v{n}" in reg or (JS_DIR / f"{root}.v{n}.js").exists():
            n += 1
        return f"{root}.v{n}"

    base = f"{root}.{suffix}"
    if base not in reg and not (JS_DIR / f"{base}.js").exists():
        return base
    n = 2
    while f"{base}-{n}" in reg or (JS_DIR / f"{base}-{n}.js").exists():
        n += 1
    return f"{base}-{n}"


# -- core ---------------------------------------------------------------------

def make_variant(
    parent: str,
    prompt: str,
    suffix: str = "",
    model_key: str = "pro",
    *,
    on_event=None,
) -> dict:
    """Fork ``parent`` into a new variant via a natural-language ``prompt``.

    Returns {name, code, parent, base_root, duration_s, strategy}.
    The parent file is never modified.
    """
    parent_path = JS_DIR / f"{parent}.js"
    if not parent_path.exists():
        raise FileNotFoundError(f"Parent game not found: {parent_path}")

    reg = load_registry()
    root = resolve_root(parent, reg)
    name = unique_name(root, suffix, reg)

    # Reuse the refine transform with variant framing (bolder edits, contract
    # preserved), but do NOT write/back up the parent.
    result = refine_game(parent, prompt, model_key, apply=False, on_event=on_event, intent="variant")
    code = result["code"]

    (JS_DIR / f"{name}.js").write_text(code)

    # refine_game logged this run under the PARENT as a "refine" (prompt, raw
    # output, timing, chunk metadata are all captured). Re-tag and re-file it
    # under the variant name so logs are queryable by variant and carry lineage.
    # Best-effort: a logging hiccup must never fail a fork.
    log_name = None
    try:
        lp = Path(result["log_path"])
        log = json.loads(lp.read_text())
        log["action"] = "variant"
        log["game"] = name
        log["parent"] = parent
        log["base_root"] = root
        ts = lp.name.split("_", 1)[0]
        new_lp = lp.with_name(f"{ts}_{name}_variant.json")
        new_lp.write_text(json.dumps(log, indent=2))
        if new_lp != lp:
            lp.unlink()
        log_name = new_lp.name
    except Exception:
        lp = result.get("log_path")
        log_name = Path(lp).name if lp else None

    reg[name] = {
        "parent": parent,
        "base_root": root,
        "prompt": prompt,
        "model": model_key,
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "physics": lookup_physics(root),
        "strategy": result.get("strategy"),
        "duration_s": result.get("duration_s"),
        "log": log_name,
    }
    save_registry(reg)

    print(f"  Forked {parent} -> {name} ({result['duration_s']}s, strategy={result.get('strategy')})")
    return {
        "name": name,
        "code": code,
        "parent": parent,
        "base_root": root,
        "duration_s": result["duration_s"],
        "strategy": result.get("strategy"),
    }


def promote_variant(name: str) -> dict:
    """Graduate a variant into a first-class game (drop it from the registry).

    The .js file stays exactly where it is; it simply stops being treated as a
    prototype, so bulk ``--all`` runs will include it. To add it to the paper
    sweep, also append its name to CANONICAL_GAMES in src/playtrain/gen/constants.py.
    """
    reg = load_registry()
    if name not in reg:
        raise KeyError(f"Not a registered variant: {name}")
    del reg[name]
    save_registry(reg)
    print(f"  Promoted {name} to a first-class game. "
          f"Add it to CANONICAL_GAMES if it belongs in the paper sweep.")
    return {"name": name, "promoted": True}


def delete_variant(name: str) -> dict:
    """Back up and remove a variant (file + registry entry)."""
    reg = load_registry()
    if name not in reg:
        raise KeyError(f"Not a registered variant: {name}")
    backup_game(name)  # snapshot into games/backups before removing
    path = JS_DIR / f"{name}.js"
    if path.exists():
        path.unlink()
    del reg[name]
    save_registry(reg)
    print(f"  Deleted variant {name} (a backup was saved first).")
    return {"name": name, "deleted": True}


# -- CLI ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Fork a game into a named variant via Gemini")
    parser.add_argument("--parent", help="Base game (or another variant) to fork from")
    parser.add_argument("--prompt", help="Natural-language description of the change")
    parser.add_argument("--name", default="", help="Short suffix for the variant (blank = auto v{n})")
    parser.add_argument("--model", choices=["flash", "pro"], default="pro")
    parser.add_argument("--promote", metavar="NAME", help="Graduate a variant into a first-class game")
    parser.add_argument("--delete", metavar="NAME", help="Remove a variant (backed up first)")
    parser.add_argument("--list", action="store_true", help="List registered variants")
    args = parser.parse_args()

    if args.list:
        reg = load_registry()
        if not reg:
            print("No variants registered.")
        for n, meta in sorted(reg.items()):
            print(f"{n}\n    parent: {meta['parent']}  created: {meta['created']}\n    prompt: {meta['prompt']}")
        return
    if args.promote:
        promote_variant(args.promote)
        return
    if args.delete:
        delete_variant(args.delete)
        return
    if not args.parent or not args.prompt:
        parser.error("--parent and --prompt are required to create a variant")
    make_variant(args.parent, args.prompt, args.name, args.model)


if __name__ == "__main__":
    main()
