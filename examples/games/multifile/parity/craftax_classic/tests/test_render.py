"""Gate for task 8a: the renderer.

The pixels are deliberately NOT part of the parity claim, so there is no C
to compare against. What is checkable is that the render is a faithful,
deterministic, obs-aligned view of the state:

  - frames are deterministic for a given seed and action sequence
  - they change when the state changes, and track the player
  - tiles arrive UNRESAMPLED: a rendered tile is byte-identical to the
    baked atlas sprite, which is what makes the frame Craftax's image
    rather than an approximation of it
  - it reads state only: rendering twice from the same state must not
    change the state or the RNG

That last one matters more than it looks. A render that drew from the RNG
would desynchronise the game from the reference without failing any of the
dynamics gates, because those never call draw().
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from playtrain.runtime import PlayTrainEnv

GAME = "craftax_classic"
OBS = 64
# BLOCK_PIXEL_SIZE_AGENT. The canvas is 64 and the device scale is 1:1, so a
# 7px tile is 7 obs px and every blit is a straight copy.
TILE_OBS = 7
VIEW_ROWS, VIEW_COLS = 7, 9
# Craftax's frame is 63x63 in the top-left; col/row 63 is padding.
CRAFTAX_W = CRAFTAX_H = 63


@pytest.fixture(scope="module")
def frames():
    env = PlayTrainEnv(game=GAME, obs_size=OBS)
    try:
        out = []
        obs, _ = env.reset(seed=11)
        out.append(obs.copy())
        for action in (4, 4, 2, 5, 3, 1, 5, 4):
            obs, _, _, _, _ = env.step(action)
            out.append(obs.copy())
        yield out
    finally:
        env.close()


def test_frames_have_the_right_shape_and_are_not_blank(frames):
    for i, f in enumerate(frames):
        assert f.shape == (OBS, OBS, 3)
        assert f.dtype == np.uint8
        colours = np.unique(f.reshape(-1, 3), axis=0)
        assert len(colours) >= 8, f"frame {i} has only {len(colours)} colours"


def test_the_view_changes_as_the_player_moves(frames):
    view = [f[: VIEW_ROWS * TILE_OBS] for f in frames]
    assert not np.array_equal(view[0], view[-1]), "the world view never changed"


def test_rendering_is_deterministic():
    """Same seed, same actions, same pixels — twice, in separate processes."""
    def run():
        env = PlayTrainEnv(game=GAME, obs_size=OBS)
        try:
            obs, _ = env.reset(seed=99)
            for action in (4, 2, 5, 3, 5):
                obs, _, _, _, _ = env.step(action)
            return obs.copy()
        finally:
            env.close()

    assert np.array_equal(run(), run())


def test_different_seeds_render_differently():
    def run(seed):
        env = PlayTrainEnv(game=GAME, obs_size=OBS)
        try:
            obs, _ = env.reset(seed=seed)
            return obs.copy()
        finally:
            env.close()

    assert not np.array_equal(run(1), run(2))


def atlas_sprites():
    """Decode the baked atlas the game ships, as {name: (7,7,4) uint8}."""
    import base64
    import re

    src = (Path(__file__).resolve().parent.parent / "src" / "15_atlas.js").read_text()
    tile = int(re.search(r"const ATLAS_TILE = (\d+)", src).group(1))
    body = src.split("const ATLAS = {", 1)[1].split("};", 1)[0]
    index = {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+),", body)}
    b64 = "".join(re.findall(r"'([A-Za-z0-9+/=]*)'", src.split("ATLAS_B64 =", 1)[1]))
    raw = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
    stride = tile * tile * 4
    return {
        name: raw[i * stride : (i + 1) * stride].reshape(tile, tile, 4)
        for name, i in index.items()
    }, tile


def test_tiles_are_byte_identical_to_the_atlas():
    """The claim the whole baked-atlas design exists to support.

    Craftax downsamples its 16x16 assets to 7x7 with PIL NEAREST, whose index
    mapping differs from the rasterizer's blit. So the downscale is done at
    build time and the runtime blit is 1:1 — which means a rendered tile must
    equal the atlas sprite EXACTLY, not approximately. If this drifts, the
    frame is no longer Craftax's image.

    Checked on an all-grass corner of the view, away from the player and any
    mob overlay.
    """
    sprites, tile = atlas_sprites()
    grass = sprites["block_2"][:, :, :3]

    env = PlayTrainEnv(game=GAME, obs_size=OBS)
    try:
        obs, _ = env.reset(seed=3)
    finally:
        env.close()

    matches = 0
    for vr in range(VIEW_ROWS):
        for vc in range(VIEW_COLS):
            if (vr, vc) == (3, 4):
                continue                      # the player tile
            got = obs[vr * tile : (vr + 1) * tile, vc * tile : (vc + 1) * tile]
            if np.array_equal(got, grass):
                matches += 1
    assert matches >= 10, (
        f"only {matches} tiles are byte-identical to the grass sprite; "
        "blits are being resampled or the atlas is stale"
    )


def test_the_padding_column_and_row_are_black(frames):
    """Craftax's frame is 63x63; ours is 64x64 because every harness fixes
    the observation at 64. The extra row and column must be inert padding,
    not a smeared edge — obs[:63, :63] is the Craftax frame."""
    frame = frames[0]
    assert frame[:, CRAFTAX_W:].sum() == 0, "the padding column is not black"
    assert frame[CRAFTAX_H:, :].sum() == 0, "the padding row is not black"


def test_the_inventory_rows_sit_below_the_map(frames):
    """7 map rows of 7px = 49, then 2 inventory rows = 63, then 1 pad row."""
    frame = frames[-1]
    view = frame[: VIEW_ROWS * TILE_OBS]
    inv = frame[VIEW_ROWS * TILE_OBS : CRAFTAX_H]
    assert inv.shape[0] == 2 * TILE_OBS == 14
    assert inv.mean() != view.mean(), "the inventory band looks like the world view"
    # Intrinsics are always non-zero, so the band is never fully black.
    assert inv.sum() > 0


def test_render_does_not_touch_the_state_or_the_rng():
    """Rendering must be a pure read. If draw() drew from the RNG, the game
    would desynchronise from the reference without failing any dynamics gate,
    because those never call draw().

    Checked at the source level, because the runtime always renders: the
    render module must not mention the RNG or assign into the state.
    """
    import re
    from pathlib import Path

    src = Path(__file__).resolve().parent.parent / "src" / "80_render.js"
    code = "\n".join(line.split("//")[0] for line in src.read_text().splitlines())
    for name in ("crRf", "crRi", "crPcg", "pcgSeed", "Math.random"):
        assert name not in code, f"80_render.js calls {name}"
    # No assignment into a state field: st.<field>[i] = ...
    writes = re.findall(r"\bst\.\w+\[[^\]]*\]\s*=[^=]", code)
    assert not writes, f"80_render.js writes to the state: {writes}"
    for name in ("mapSet", "mbSet", "mbClear", "stepGame", "newEpisode"):
        assert name not in code, f"80_render.js calls the mutator {name}"
