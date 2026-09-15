"""The voxel path: one Rust primitive, four backends, one image.

``rs_voxel_view`` (crates/rasterizer/src/voxel.rs) casts one DDA ray per pixel
through a grid of unit blocks and textures the hit face. Unlike the bitmap
blit, which is integer nearest-neighbour and therefore identical across
backends by construction, this is *floating point* — so identity has to be
tested, not argued. FIRST_PERSON_PLAN.md §6 is the contract: f32 only, no
libm, and native == wasm == the pure-JS port, byte for byte.

The four backends, and what each one proves:

* ``PLAYTRAIN_RASTERIZER=wasm`` — the Rust compiled to wasm32, under node.
* ``PLAYTRAIN_RASTERIZER=js``   — the hand port in runtime/p5/raster.mjs. This
  is the browser fallback, and the one that can silently drift: a missing
  ``Math.fround`` is not a rounding difference, it is a different image.
* ``qjs_host``                  — the Rust compiled natively, under QuickJS.
* ``gate_qjs.sh``               — V8 vs QuickJS over a whole trajectory, which
  is the only one that would catch a divergence that needs a few frames to
  show up.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
GAMES = Path(__file__).resolve().parent / "games"
GAME = "voxel_smoke"

SKY = (0x87, 0xCE, 0xEB)
VIEW_H = 49


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")


def frame_with(backend: str, steps: int = 0) -> np.ndarray:
    """One observation from the smoke game, rendered by `backend`."""
    from playtrain.runtime import PlayTrainEnv

    prev = os.environ.get("PLAYTRAIN_RASTERIZER")
    os.environ["PLAYTRAIN_RASTERIZER"] = backend
    try:
        env = PlayTrainEnv(game=GAME, games_dir=str(GAMES), obs_size=64, obs_mode="rgb")
        try:
            obs, _ = env.reset(seed=1)
            for _ in range(steps):
                obs = env.step(0)[0]
            return obs.copy()
        finally:
            env.close()
    finally:
        if prev is None:
            os.environ.pop("PLAYTRAIN_RASTERIZER", None)
        else:
            os.environ["PLAYTRAIN_RASTERIZER"] = prev


@pytest.fixture(scope="module")
def wasm_frame() -> np.ndarray:
    return frame_with("wasm")


def test_the_view_actually_reaches_the_canvas(wasm_frame):
    """Without this every comparison below passes vacuously: two backends that
    both drew nothing still agree."""
    assert tuple(wasm_frame[2, 32]) == SKY, "above the horizon is not sky"
    assert tuple(wasm_frame[46, 32]) != SKY, "below the horizon is not textured"
    colours = {tuple(px) for row in wasm_frame[:VIEW_H] for px in row}
    assert len(colours) > 50, f"only {len(colours)} distinct colours — this is a stub"


def test_the_view_stays_inside_its_rect(wasm_frame):
    """§4.5 gives rows 0..48 to the view and everything below to the inventory
    strip. A primitive that scribbled past its dst rect would corrupt it."""
    below = wasm_frame[VIEW_H:]
    assert int(below.sum()) == 0, "the voxel view wrote below its dst rect"


def test_pure_js_port_is_bit_identical_to_wasm(wasm_frame):
    """The load-bearing one for the browser fallback. raster.mjs is a hand port
    of the Rust; these must be the same bytes, with no tolerance."""
    js_frame = frame_with("js")
    assert js_frame.shape == wasm_frame.shape
    if not np.array_equal(js_frame, wasm_frame):
        bad = np.argwhere(np.any(js_frame != wasm_frame, axis=2))
        y, x = bad[0]
        raise AssertionError(
            f"{len(bad)} pixels differ; first at (row {y}, col {x}): "
            f"wasm={tuple(wasm_frame[y, x])} js={tuple(js_frame[y, x])}"
        )


def test_the_four_yaws_are_four_different_frames():
    """The smoke game turns a quarter every 8 steps. If yaw were dropped on the
    way through a binding, every frame would be the same one."""
    seen = {frame_with("wasm", steps=s).tobytes() for s in (0, 8, 16, 24)}
    assert len(seen) == 4, f"expected 4 distinct yaw frames, got {len(seen)}"


def test_v8_and_quickjs_agree_over_a_trajectory():
    """Native Rust under QuickJS vs wasm Rust under V8, every step, including
    the observation hash. This is the gate an f32 leak would fail."""
    host = REPO / "native" / "build" / "qjs_host"
    if not host.exists():
        pytest.skip("native backend not built (run native/build_qjs.sh)")

    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(GAMES)
    env.pop("PLAYTRAIN_RASTERIZER", None)
    proc = subprocess.run(
        ["./gate_qjs.sh", GAME, "200"],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
