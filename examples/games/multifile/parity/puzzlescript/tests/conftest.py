"""Shared paths for the PuzzleScript family gates."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
REPO = FAMILY.parents[4]   # examples/games/multifile/parity/puzzlescript -> repo root
NODE = shutil.which("node")
MANIFEST = json.loads((FAMILY / "manifest.json").read_text())
# The bundle's recipe, in scope order (tools/bundle_puzzlescript.mjs does the same): shims, the reference engine in
# the reference's own load order, then the prelude.
SOURCES = sorted((FAMILY / "src").glob("0*.js")) + [FAMILY / "reference" / f for f in MANIFEST["reference"]["engine_load_order"]] + sorted((FAMILY / "src").glob("9*.js"))


def node(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    if NODE is None:
        pytest.skip("node not on PATH")
    return subprocess.run([NODE, *args], cwd=FAMILY, capture_output=True, text=True, env={**os.environ, **(env or {})})


def ref_configured() -> bool:
    return bool(os.environ.get("PS_REF")) and (Path(os.environ["PS_REF"]) / "src" / "js" / "engine.js").is_file()


def oracle(*args: str) -> subprocess.CompletedProcess:
    """Run tests/oracle.mjs against the unmodified checkout (PS_REF)."""
    if not ref_configured():
        pytest.skip("PuzzleScript checkout not configured (PS_REF)")
    return node("tests/oracle.mjs", *args)


def run_js(script: Path, *args: str) -> subprocess.CompletedProcess:
    """Concatenate SOURCES plus `script` into one flat file and run it with node (one global script, never eval)."""
    if NODE is None:
        pytest.skip("node not on PATH")
    import tempfile
    text = "\n".join(p.read_text() for p in SOURCES) + "\n" + Path(script).read_text()
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False, dir=tempfile.gettempdir()) as fh:
        fh.write(text)
        tmp = fh.name
    try:
        return subprocess.run([NODE, tmp, *args], cwd=FAMILY, capture_output=True, text=True)
    finally:
        os.unlink(tmp)
