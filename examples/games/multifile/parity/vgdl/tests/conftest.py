"""Shared paths for the VGDL family gates."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FAMILY = HERE.parent
REPO = FAMILY.parents[4]   # examples/games/multifile/parity/vgdl -> repo root
NODE = shutil.which("node")


def node(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    if NODE is None:
        pytest.skip("node not on PATH")
    return subprocess.run([NODE, *args], cwd=FAMILY, capture_output=True, text=True,
                          env={**os.environ, **(env or {})})
