"""CLI: bundle a multi-file game into one flat script plus its sidecar.

Usage:
    just bundle craftax_classic
    just bundle-all
    uv run python tools/bundle_multifile.py examples/games/multifile/parity/craftax_classic/manifest.json
    uv run python tools/bundle_multifile.py --all --check

Plain concatenation, nothing clever. The sources are joined in manifest
order with a `// ---- <path> ----` separator and a generated banner, and
written to `dist/<name>.js`. There are no ES modules and no minifier
because QuickJS, the AOT tier (`qjsc`), node and the browser embed all
evaluate one global script, exactly as they do for `games/js/`.

That also means concatenation order IS scope order: a top-level `const` or
`class` in an earlier file is visible to a later one, and nothing is
hoisted across files except function declarations. Sources must be listed
in dependency order.

`dist/<name>.json` is the sidecar: the manifest minus `sources`, which is
the build-time-only key. Tools read the sidecar, never the directory name.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MULTIFILE = REPO / "examples" / "games" / "multifile"

BANNER = """\
// ============================================================================
// {name} v{version} — GENERATED, DO NOT EDIT
//
// Built by tools/bundle_multifile.py from {n} sources listed in
// {manifest}
// Source hash (sha256 over the concatenated sources): {digest}
//
// Edit the files under src/ and common/, then run:
//     just bundle {name}
// ============================================================================
"""


def find_manifests() -> list[Path]:
    return sorted(MULTIFILE.glob("*/*/manifest.json"))


def resolve_manifest(arg: str) -> Path:
    """Accept a path, or a bare game name to look up in the tree."""
    path = Path(arg)
    if path.is_file():
        return path.resolve()
    matches = [m for m in find_manifests() if m.parent.name == arg]
    if not matches:
        raise SystemExit(f"bundle: no manifest for {arg!r}; have "
                         f"{[m.parent.name for m in find_manifests()]}")
    if len(matches) > 1:
        raise SystemExit(f"bundle: {arg!r} is ambiguous: {matches}")
    return matches[0]


def build(manifest_path: Path) -> tuple[str, str]:
    """Return (bundle js, sidecar json) for this manifest, without writing."""
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent

    missing = []
    parts = []
    raw = []
    for rel in manifest["sources"]:
        src = (root / rel).resolve()
        if not src.is_file():
            missing.append(rel)
            continue
        text = src.read_text()
        raw.append(text)
        parts.append(f"// ---- {rel} ----\n{text.rstrip()}\n")
    if missing:
        raise SystemExit(f"bundle: {manifest_path}: missing sources {missing}")

    digest = hashlib.sha256("".join(raw).encode()).hexdigest()
    banner = BANNER.format(
        name=manifest["name"],
        version=manifest["version"],
        n=len(manifest["sources"]),
        manifest=manifest_path.relative_to(REPO),
        digest=digest,
    )
    js = banner + "\n" + "\n".join(parts)

    sidecar = {k: v for k, v in manifest.items() if k != "sources"}
    sidecar["source_sha256"] = digest
    return js, json.dumps(sidecar, indent=2) + "\n"


def write(manifest_path: Path, check: bool) -> bool:
    """Write dist/, or in check mode report whether it is already current.
    Returns True when everything is up to date."""
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent
    dist = root / "dist"
    js_path = dist / f"{manifest['name']}.js"
    json_path = dist / f"{manifest['name']}.json"

    js, sidecar = build(manifest_path)
    if check:
        ok = True
        for path, want in ((js_path, js), (json_path, sidecar)):
            if not path.is_file():
                print(f"STALE {path.relative_to(REPO)}: missing")
                ok = False
            elif path.read_text() != want:
                print(f"STALE {path.relative_to(REPO)}: differs from a fresh bundle")
                ok = False
        if ok:
            print(f"ok {manifest['name']}")
        return ok

    dist.mkdir(parents=True, exist_ok=True)
    js_path.write_text(js)
    json_path.write_text(sidecar)
    print(f"bundled {manifest['name']}: {js_path.relative_to(REPO)} "
          f"({len(js.splitlines())} lines), {json_path.relative_to(REPO)}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("manifest", nargs="?", help="manifest path, or a game name")
    ap.add_argument("--all", action="store_true", help="every multifile game")
    ap.add_argument("--check", action="store_true",
                    help="do not write; fail if dist/ is not what a fresh bundle would produce")
    args = ap.parse_args()

    if args.all == bool(args.manifest):
        ap.error("give a manifest (or game name), or --all, not both")

    targets = find_manifests() if args.all else [resolve_manifest(args.manifest)]
    if not targets:
        print("no multifile games found")
        return 0
    return 0 if all([write(t, args.check) for t in targets]) else 1


if __name__ == "__main__":
    sys.exit(main())
