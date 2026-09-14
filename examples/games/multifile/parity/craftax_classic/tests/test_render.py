"""Gate for task 8a: the renderer.

The pixels are deliberately NOT part of the parity claim, so there is no C
to compare against. What is checkable is that the render is a faithful,
deterministic, obs-aligned view of the state:

  - frames are deterministic for a given seed and action sequence
  - they change when the state changes, and track the player
  - the 56px tile grid lands on obs pixel boundaries, which is the whole
    reason for the 512 canvas and the 9x7 layout (PLAN 6)
  - it reads state only: rendering twice from the same state must not
    change the state or the RNG

That last one matters more than it looks. A render that drew from the RNG
would desynchronise the game from the reference without failing any of the
dynamics gates, because those never call draw().
"""

from __future__ import annotations

import numpy as np
import pytest

from playtrain.runtime import PlayTrainEnv

GAME = "craftax_classic"
OBS = 64
# 56 canvas px per tile / (512 canvas px / 64 obs px) = 7 obs px per tile.
TILE_OBS = 7
VIEW_ROWS, VIEW_COLS = 7, 9


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


def test_tiles_land_on_obs_pixel_boundaries(frames):
    """PLAN 6's reason for the 512 canvas: a tile is 56 canvas px = exactly 7
    obs px, so each block is a crisp 7x7 block in the observation rather than
    a smeared 6.8. Check by looking at the flat interior of each tile: the
    3x3 centre of every tile must be one uniform colour.

    The player tile is skipped — it is the one tile that always has a glyph
    through its middle.
    """
    frame = frames[0]
    ragged = []
    for vr in range(VIEW_ROWS):
        for vc in range(VIEW_COLS):
            if (vr, vc) == (3, 4):
                continue  # the player
            r0 = vr * TILE_OBS
            c0 = vc * TILE_OBS
            centre = frame[r0 + 2 : r0 + 5, c0 + 2 : c0 + 5]
            if len(np.unique(centre.reshape(-1, 3), axis=0)) > 2:
                ragged.append((vr, vc))
    # A tile with a glyph through its centre is legitimate; a majority being
    # ragged would mean the grid is misaligned.
    assert len(ragged) < (VIEW_ROWS * VIEW_COLS) // 2, (
        f"{len(ragged)} of {VIEW_ROWS * VIEW_COLS} tiles have a ragged centre: {ragged[:10]}"
    )


def test_the_hud_occupies_the_bottom_two_tile_rows(frames):
    """The view is 7 rows of 56px = 392 canvas px = 49 obs rows; the two HUD
    rows follow. Check the HUD band is not just a copy of the world."""
    frame = frames[-1]
    view = frame[: VIEW_ROWS * TILE_OBS]
    hud = frame[VIEW_ROWS * TILE_OBS :]
    assert hud.shape[0] == OBS - VIEW_ROWS * TILE_OBS == 15
    assert hud.mean() != view.mean(), "the HUD band looks like the world view"
    assert len(np.unique(hud.reshape(-1, 3), axis=0)) >= 3


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
