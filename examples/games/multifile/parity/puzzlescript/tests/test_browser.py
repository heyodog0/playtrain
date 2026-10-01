"""G9: the bundles play in a real browser: the built page loads, steps, takes arrow keys and draws the level with
the sidecar's controls overlay. Skips unless playwright-core and a Chromium are available: playwright-core
resolvable from the family dir or from PLAYWRIGHT_CORE_DIR, and PLAYWRIGHT_CHROMIUM pointing at a
chrome-headless-shell binary when playwright's own browser install is absent."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from conftest import FAMILY, REPO, node

GAMES = ["ps_microban", "ps_kettle", "ps_midas"]


def _have_playwright() -> bool:
    if shutil.which("node") is None:
        return False
    probe = ("const d=process.env.PLAYWRIGHT_CORE_DIR;"
             "import('playwright-core').then(()=>process.exit(0),()=>{try{require('module').createRequire((d||'/nonexistent').replace(/\\/?$/,'/'))('playwright-core');process.exit(0)}catch(e){process.exit(1)}})")
    return subprocess.run(["node", "-e", probe], cwd=FAMILY, capture_output=True, env=os.environ.copy()).returncode == 0


@pytest.mark.skipif(not _have_playwright(), reason="playwright-core not resolvable (family dir or PLAYWRIGHT_CORE_DIR)")
def test_pages_play_in_headless_chromium():
    out = Path(tempfile.mkdtemp(prefix="ps_pages_"))
    proc = subprocess.run(["node", str(REPO / "tools" / "build-pages.mjs"), "--games", str(FAMILY / "dist"), "--out", str(out)],
                          cwd=REPO, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    pages = [str(out / "game" / g / "index.html") for g in GAMES]
    proc = node("tests/browser_smoke.mjs", *pages)
    if proc.returncode == 3:
        pytest.skip("playwright-core not installed")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.count("PASS") == len(GAMES)
