"""The bitmap path: getting a texture INTO the rasterizer, and blitting it.

Canvases were always RGBA buffers and rs_draw_image always blitted between
them; the one missing piece was writing bytes in. rs_load_rgba adds that, and
createBitmap/loadBitmap expose it to a game.

Why this is safe for bit-exactness, and what these tests hold to it:
rs_draw_image samples with INTEGER nearest-neighbour —
``((y * sh) / dhi).min(sh - 1)`` — and copies bytes with no blending. There is
no floating point in the sampling, so a blit is identical across native, wasm
and the pure-JS backend by construction rather than by tuning.

The point of the whole path is Craftax-Classic-Pixels: 7x9 tiles at
BLOCK_PIXEL_SIZE_AGENT = 7, so a 16x16 texture has to downscale to 7x7. That
case is tested explicitly below.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
GAMES = Path(__file__).resolve().parent / "games"
GAME = "bitmap_blit"

# The texture the fixture game uploads: a 4x4 checker.
ON = (220, 60, 40)
OFF = (30, 120, 200)


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")


@pytest.fixture(scope="module")
def frame() -> np.ndarray:
    from playtrain.runtime import PlayTrainEnv

    env = PlayTrainEnv(game=GAME, games_dir=str(GAMES), obs_size=64, obs_mode="rgb")
    try:
        obs, _ = env.reset(seed=1)
        return obs.copy()
    finally:
        env.close()


def test_the_texture_actually_reaches_the_canvas(frame):
    """Without this the differential gate below would pass vacuously: two
    backends that both silently drew nothing still agree."""
    assert tuple(frame[2, 2]) == ON, "texel (0,0) is not the uploaded colour"
    assert tuple(frame[2, 6]) == OFF, "texel (1,0) is not the uploaded colour"


def test_upscale_and_downscale_both_land(frame):
    # 4x4 texture blitted at 16x16 (4x up), 28x28 (7x up) and 7x7 (down).
    assert tuple(frame[3, 23]) == ON, "28x28 upscale blit missing"
    assert tuple(frame[33, 0]) == ON, "7x7 downscale blit missing"


def test_the_seven_pixel_tile_is_the_craftax_case(frame):
    """Craftax-Classic-Pixels renders tiles at BLOCK_PIXEL_SIZE_AGENT = 7, so
    a texture atlas has to survive a downscale to 7x7. Check the 7x7 blit is
    a full, opaque tile and not a partial write."""
    tile = frame[32:39, 0:7]
    assert tile.shape == (7, 7, 3)
    assert (tile.sum(axis=2) > 0).all(), "the 7x7 tile has holes"
    colours = {tuple(px) for row in tile for px in row}
    assert colours <= {ON, OFF}, f"unexpected colours in the tile: {colours}"


def test_blits_do_not_bleed(frame):
    """16^2 + 28^2 + 7^2 = 1089. Anything else means a blit wrote outside its
    destination rect."""
    non_black = int((frame.sum(axis=2) > 0).sum())
    assert non_black == 16 * 16 + 28 * 28 + 7 * 7 == 1089


def test_v8_and_quickjs_agree_on_a_bitmap_blit():
    """The load-bearing one. Two independent rasterizer implementations (the
    Rust one under QuickJS, the wasm/JS one under node) must produce the same
    bytes, or the bitmap path cannot be used by a gated game."""
    host = REPO / "native" / "build" / "qjs_host"
    if not host.exists():
        pytest.skip("native backend not built (run native/build_qjs.sh)")
    import os

    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(GAMES)
    proc = subprocess.run(
        ["./gate_qjs.sh", GAME, "200"],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
