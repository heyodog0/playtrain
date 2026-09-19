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
