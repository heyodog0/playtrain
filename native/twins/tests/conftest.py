"""Shared paths for the twin gates. The library and CLI are built on demand (never committed)."""
import os
import platform
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
TWINS = HERE.parent
REPO = TWINS.parents[1]
PARITY = REPO / "examples" / "games" / "multifile" / "parity"
BUILD = TWINS / "build"
LIB = BUILD / ("libtwin_vec.dylib" if platform.system() == "Darwin" else "libtwin_vec.so")
HOST = BUILD / "twin_host"
NODE = shutil.which("node")


def ensure_built() -> None:
    srcs = list(TWINS.glob("common/*.cpp")) + list(TWINS.glob("*/*.cpp")) + list(TWINS.glob("common/*.hpp"))
    newest = max(p.stat().st_mtime for p in srcs)
    if not (LIB.exists() and HOST.exists()) or LIB.stat().st_mtime < newest or HOST.stat().st_mtime < newest:
        proc = subprocess.run(["bash", str(TWINS / "build.sh")], capture_output=True, text=True)
        assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]


def node(*args: str, env: dict | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess:
    if NODE is None:
        pytest.skip("node not on PATH")
    return subprocess.run([NODE, *args], cwd=cwd or TWINS, capture_output=True, text=True, env={**os.environ, **(env or {})})


def twin_host(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    ensure_built()
    return subprocess.run([str(HOST), *args], capture_output=True, text=True, env={**os.environ, **(env or {})})
