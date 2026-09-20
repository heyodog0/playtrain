"""U12: the .wasm game format. (a) Every bundle of every family compiled to a .wasm game (native/twins/wasm/build_game.mjs)
produces, through PlayTrain's own node runtime (game-env.mjs + wasm rasterizer), the same reference_trace.mjs output
as the JS bundle and as the native twin, byte for byte (seeds 1, 42; 300 steps). (b) A page built from a .wasm game
plays in headless Chromium (brix, aliens, sokoban_basic). Builds the wasm games when Emscripten is available
(EMSDK env pointing at an emsdk checkout, or em++ on PATH); otherwise skips with that reason, like a library that is
not built. The browser test skips without playwright-core (PLAYWRIGHT_CORE_DIR) like the families' smoke tests."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from conftest import BUILD, PARITY, REPO, TWINS, ensure_built, node

WASM = BUILD / "wasm"
FAMILIES = {"chip8": 39, "vgdl": 26, "puzzlescript": 17}


def _emxx_env() -> dict | None:
    env = os.environ.copy()
    if shutil.which("em++"):
        return env
    emsdk = os.environ.get("EMSDK")
    if emsdk and (Path(emsdk) / "upstream" / "emscripten" / "em++").exists():
        env["EMXX"] = str(Path(emsdk) / "upstream" / "emscripten" / "em++")
        return env
    return None


def _built() -> bool:
    return all((WASM / f"{p.stem}.wasm").exists() for fam in FAMILIES for p in (PARITY / fam / "dist").glob("*.js"))


@pytest.fixture(scope="module")
def wasm_games():
    ensure_built()
    if _built():
        return WASM
    env = _emxx_env()
    if env is None:
        pytest.skip("wasm games not built and no Emscripten (set EMSDK or put em++ on PATH)")
    bundles = [str(p) for fam in FAMILIES for p in sorted((PARITY / fam / "dist").glob("*.js"))]
    proc = subprocess.run(["node", str(TWINS / "wasm" / "build_game.mjs"), *bundles, "--out", str(WASM)], capture_output=True, text=True, env=env, timeout=3600)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    return WASM


@pytest.mark.parametrize("family", list(FAMILIES))
def test_wasm_trace_equals_js_and_native(family, wasm_games):
    proc = node("tests/wasm_trace_gate.mjs", family, "--wasm-dir", str(wasm_games))
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    n = 2 * FAMILIES[family]
    assert proc.stdout.strip().endswith(f"{n}/{n} traces identical (wasm == js == native)"), proc.stdout[-300:]


def _have_playwright() -> bool:
    probe = ("const d=process.env.PLAYWRIGHT_CORE_DIR;"
             "import('playwright-core').then(()=>process.exit(0),()=>{try{require('module').createRequire((d||'/nonexistent').replace(/\\/?$/,'/'))('playwright-core');process.exit(0)}catch(e){process.exit(1)}})")
    return subprocess.run(["node", "-e", probe], cwd=TWINS, capture_output=True, env=os.environ.copy()).returncode == 0


@pytest.mark.skipif(not _have_playwright(), reason="playwright-core not resolvable (PLAYWRIGHT_CORE_DIR)")
def test_wasm_pages_play_in_headless_chromium(wasm_games):
    out = Path(tempfile.mkdtemp(prefix="wasm_pages_"))
    proc = subprocess.run(["node", str(REPO / "tools" / "build-pages.mjs"), "--games", str(wasm_games), "--out", str(out)], cwd=REPO, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    games = ["chip8_brix", "vgdl_aliens", "ps_sokoban_basic"]
    proc = node("tests/wasm_browser_smoke.mjs", *[str(out / "game" / g / "index.html") for g in games], "--games", str(wasm_games))
    if proc.returncode == 3:
        pytest.skip("playwright-core not installed")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.count("PASS") == len(games)
