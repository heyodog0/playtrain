"""Shared paths for the CHIP-8 family gates."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
REPO = FAMILY.parents[4]   # examples/games/multifile/parity/chip8 -> repo root
NODE = shutil.which("node")
BRIX_ROM = FAMILY / "roms" / "Brix [Andreas Gustafsson, 1990].ch8"
COMMON = FAMILY.parents[1] / "common"
# The bundle's recipe, in scope order: shared threefry core, then src/*.js by name (tools/bundle_chip8.mjs
# does the same; the family manifest deliberately has no "sources" key, which would make
# tools/bundle_multifile.py --all treat the family as one game).
SOURCES = [COMMON / "threefry2x32.js"] + sorted((FAMILY / "src").glob("*.js"))


def node(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    if NODE is None:
        pytest.skip("node not on PATH")
    return subprocess.run([NODE, *args], cwd=FAMILY, capture_output=True, text=True,
                          env={**os.environ, **(env or {})})


def oracle_configured() -> bool:
    return bool(os.environ.get("CHIP8_ORACLE_PY") and os.environ.get("CHIP8_OCTAX"))


def oracle(*args: str) -> subprocess.CompletedProcess:
    """Run tests/oracle.py in the oracle venv (CHIP8_ORACLE_PY) against the Octax checkout (CHIP8_OCTAX)."""
    if not oracle_configured():
        pytest.skip("Octax oracle not configured (CHIP8_ORACLE_PY, CHIP8_OCTAX)")
    return subprocess.run([os.environ["CHIP8_ORACLE_PY"], str(HERE / "oracle.py"), *args],
                          cwd=FAMILY, capture_output=True, text=True, env=os.environ.copy())


def run_js(script: Path, *args: str) -> subprocess.CompletedProcess:
    """Concatenate src/*.js (name order, as the bundler does) plus `script` into one flat file and run
    it with node. One global script, never eval: top-level const/class must be visible everywhere."""
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
