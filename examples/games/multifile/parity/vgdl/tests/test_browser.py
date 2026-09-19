"""The bundles play in a real browser: the built page loads, ticks, takes arrow keys and
draws. Skips unless playwright-core and a Chromium are available (set PLAYWRIGHT_CHROMIUM
to a chrome-headless-shell binary, or install playwright's browsers)."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from conftest import FAMILY, REPO, node

GAMES = ["vgdl_aliens", "vgdl_vgfmri3_zelda", "vgdl_vgfmri3_sokoban"]


def _have_playwright() -> bool:
    if shutil.which("node") is None:
        return False
    return subprocess.run(["node", "-e", "import('playwright-core').then(()=>process.exit(0),()=>process.exit(1))"],
                          cwd=FAMILY, capture_output=True).returncode == 0


@pytest.mark.skipif(not _have_playwright(), reason="playwright-core not resolvable from the family dir")
def test_pages_play_in_headless_chromium():
    out = Path(tempfile.mkdtemp(prefix="vgdl_pages_"))
    proc = subprocess.run(["node", str(REPO / "tools" / "build-pages.mjs"), "--games", str(FAMILY / "dist"), "--out", str(out)],
                          cwd=REPO, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    pages = [str(out / "game" / g / "index.html") for g in GAMES]
    proc = node("tests/browser_smoke.mjs", *pages)
    if proc.returncode == 3:
        pytest.skip("playwright-core not installed")
    assert proc.returncode == 0, proc.stdout + proc.stderr
