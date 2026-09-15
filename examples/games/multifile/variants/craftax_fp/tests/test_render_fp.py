"""The first-person frame: it builds, it boots, and it is not a stub.

FIRST_PERSON_PLAN.md task T3. These are the "does the game exist" gates —
the bundle is fresh, the play page builds, and the 64x64 observation is a real
rendered frame rather than a flat fill. The claims that MATTER (dynamics
unchanged, engines agree) are T4 and T5; nothing here asserts parity with
anything, because a first-person Craftax has nothing to be parity with.

Note the colour counts below are of the WHOLE 64x64 frame, which is what the
plan's gate says. The first-person region on its own runs 20-28 colours at
spawn, and that is honest rather than broken: Craftax's grass.png has exactly
three colours in it, so a player who spawns in open grass is looking at three
shades of green and a sky.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
GAME_DIR = HERE.parent
REPO = GAME_DIR.parents[4]
DIST = GAME_DIR / "dist"
GAME = "craftax_fp"

SKY = (0x87, 0xCE, 0xEB)
VIEW_H = 49
SEEDS = (1, 2, 3, 7, 11)


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")


@pytest.fixture(scope="module")
def env():
    from playtrain.runtime import PlayTrainEnv

    e = PlayTrainEnv(game=GAME, games_dir=str(DIST), obs_size=64, obs_mode="rgb")
    try:
        yield e
    finally:
        e.close()


def test_the_bundle_is_fresh():
    """A stale dist/ is the classic way to gate a build that no longer exists."""
    proc = subprocess.run(
        ["uv", "run", "python", "tools/bundle_multifile.py",
         str((GAME_DIR / "manifest.json").relative_to(REPO)), "--check"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_the_sidecar_ships_the_seventeen_actions():
    """Without the sidecar next to the bundle, GameEnv silently falls back to an
    8-action space and every later comparison looks like a divergence."""
    sidecar = json.loads((DIST / f"{GAME}.json").read_text())
    assert len(sidecar["actions"]) == 17
    assert sidecar["obs"]["symbolic"] == 1345
    assert sidecar["max_steps"] == 10000


def test_the_action_space_reaches_the_env(env):
    assert env.action_space.n == 17


@pytest.mark.parametrize("seed", SEEDS)
def test_the_frame_is_not_a_stub(seed, env):
    """The plan's gate: a 64x64 frame has more than 50 distinct colours."""
    obs, _ = env.reset(seed=seed)
    colours = {tuple(px) for row in obs for px in row}
    assert len(colours) > 50, f"seed {seed}: only {len(colours)} distinct colours"


def test_sky_is_above_the_horizon_and_world_below(env):
    """Pitch is fixed at 0 and the vertical FOV is 90 degrees, so the horizon
    sits at the middle row of the view region. A camera that lost its yaw or
    its eye height would not keep this.

    The sky is NOT raw SKY_RGB here. Craftax's light_level at the reset frame
    is about 0.81, not 1.0, so the dusk pass has already tinted the whole
    region — it runs at any daylight below 1, not just at night. What the sky
    still is, is FLAT: every pixel above the horizon is one colour, because
    nothing is drawn there. The ground is not."""
    obs, _ = env.reset(seed=1)
    band = obs[:8]
    colours = {tuple(px) for row in band for px in row}
    assert len(colours) == 1, f"the sky above the horizon is not flat: {colours}"
    sky = colours.pop()
    assert tuple(obs[46, 32]) != sky, "below the horizon is not world"
    # And it is the sky colour DARKENED, not something unrelated: the tint
    # only ever pulls a channel down or toward blue.
    assert all(c <= s for c, s in zip(sky, SKY)), f"sky {sky} is brighter than SKY_RGB {SKY}"


def test_the_frame_layout_is_the_plan_s(env):
    """Rows 0-48 view, 49-62 inventory, 63 black padding (plan section 4.5)."""
    obs, _ = env.reset(seed=1)
    assert int(obs[63].sum()) == 0, "row 63 is not black padding"
    assert int(obs[VIEW_H:63].sum()) > 0, "the inventory strip is empty"
    # The inventory strip is 63 wide; column 63 of those rows stays padding.
    assert int(obs[VIEW_H:63, 63].sum()) == 0, "inventory wrote into the pad column"


def test_facing_alone_changes_the_view():
    """Yaw is wired up: change ONLY the facing and the view changes.

    This has to go through fp_probe.mjs rather than env.step(). A move action
    changes the player's position as well as its facing, so stepping the four
    move actions gives four different frames even when the yaw mapping is
    replaced by a constant — mutation-checked, it passes. Setting playerDir by
    hand is the only thing that isolates it."""
    proc = subprocess.run(
        ["node", "tests/fp_probe.mjs", "dist/craftax_fp.js", "1", "1", "2", "3", "4"],
        cwd=GAME_DIR, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    hashes = [ln.split()[2] for ln in proc.stdout.strip().splitlines()]
    assert len(hashes) == 4, proc.stdout
    assert len(set(hashes)) == 4, f"facings did not all differ: {proc.stdout}"


@pytest.mark.parametrize("seed", SEEDS)
def test_solid_blocks_are_actually_cubes(seed):
    """The solid set is derived from isSolid() in 40_player.js — the set that
    refuses a move is the set that stops a ray — minus water, which the plan
    renders as a floor you cannot walk into.

    Only a cube can put anything above the horizon: floors all sit at y=0,
    below eye height. So an all-floor world shows exactly ONE colour up there,
    the sky, and any block in view makes it more than one. Measured across
    these seeds and all four facings it is always more than one — Craftax
    scatters trees and stone densely enough that something is always in view.

    The metric counts COLOURS, not "pixels unlike SKY_RGB". The dusk pass
    tints the sky at any light_level below 1 and the reset frame sits at about
    0.81, so the sky on screen is never the raw constant; the earlier version
    of this test compared against it and passed for the wrong reason from T6b
    until T7 caught it."""
    proc = subprocess.run(
        ["node", "tests/fp_probe.mjs", "dist/craftax_fp.js", str(seed), "1", "2", "3", "4"],
        cwd=GAME_DIR, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    counts = [int(ln.split("abovecolours=")[1]) for ln in proc.stdout.strip().splitlines()]
    assert len(counts) == 4, proc.stdout
    assert all(c > 1 for c in counts), (
        f"seed {seed}: no block rises above the horizon in some facing: {counts}"
    )


def test_moving_changes_the_view(env):
    """The weaker companion to the above: the frame tracks the world, not just
    the camera."""
    frames = set()
    for action in (1, 2, 3, 4):     # LEFT, RIGHT, UP, DOWN
        env.reset(seed=1)
        frames.add(env.step(action)[0][:VIEW_H].tobytes())
    assert len(frames) == 4, f"expected 4 distinct frames, got {len(frames)}"


def _mob_pixels(seed: int, facing: int, drow: int, dcol: int) -> int:
    proc = subprocess.run(
        ["node", "tests/fp_probe.mjs", "--mob", str(drow), str(dcol),
         "dist/craftax_fp.js", str(seed), str(facing)],
        cwd=GAME_DIR, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return int(proc.stdout.strip().split("mobpixels=")[1])


def test_a_mob_in_front_of_the_player_is_drawn():
    """Mobs are billboards drawn after the world pass (plan section 4.3).

    The probe injects a zombie, because mobs are rare and never where a test
    wants them: it renders once with every mob mask cleared and once with one
    zombie placed, and counts the pixels that changed. Facing 3 is up, i.e.
    decreasing row, so a negative row offset is straight ahead."""
    assert _mob_pixels(1, 3, -1, 0) > 0, "a zombie one cell ahead drew nothing"
    assert _mob_pixels(1, 3, -2, 0) > 0, "a zombie two cells ahead drew nothing"


def test_a_nearer_mob_covers_more_of_the_frame():
    near = _mob_pixels(1, 3, -1, 0)
    far = _mob_pixels(1, 3, -2, 0)
    assert near > far, f"near mob {near} px is not bigger than far mob {far} px"


def test_a_mob_behind_the_player_is_not_drawn():
    assert _mob_pixels(1, 3, 2, 0) == 0, "a zombie behind the player drew"


def _night(driver_seed=None) -> dict:
    args = ["node", "tests/fp_probe.mjs", "--night"]
    if driver_seed is not None:
        args.append(str(driver_seed))
    args += ["dist/craftax_fp.js", "1", "3"]
    proc = subprocess.run(args, cwd=GAME_DIR, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return dict(kv.split("=", 1) for kv in proc.stdout.strip().split())


def test_a_night_frame_differs_from_its_daylight_twin():
    """The plan's gate for the dusk pass, and the non-vacuous version of it.

    The probe walks forward until light_level drops below 0.5, renders, then
    renders the SAME state with light_level forced to 1.0 — where the dusk
    pass is a no-op — and diffs. Comparing two different states would prove
    nothing; comparing one state at two light levels isolates the pass."""
    out = _night()
    assert float(out["light"]) < 0.5, f"never reached night: {out}"
    assert int(out["nightvsday"]) > 0, f"the dusk pass changed nothing: {out}"


def test_the_night_static_needs_a_driver_seed_and_depends_on_it():
    """Below light_level 0.5 Craftax adds per-pixel static drawn from
    state_rng, which the game derives from the DRIVER's seed. With no seed
    there is no key and the static is skipped — which is what every host does
    today — so these three frames must all differ."""
    none = _night()["nighthash"]
    seven = _night(7)["nighthash"]
    ninetynine = _night(99)["nighthash"]
    assert none != seven, "installing a driver seed did not add static"
    assert seven != ninetynine, "two different driver seeds gave the same static"


def test_the_play_page_builds(tmp_path):
    out = tmp_path / "play"
    proc = subprocess.run(
        ["node", "tools/build-pages.mjs", "--games", str(DIST),
         "--out", str(out), "--title", "Craftax first-person"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "built 1 games" in proc.stdout, proc.stdout
    page = out / "game" / GAME / "index.html"
    assert page.is_file(), f"no page at {page}"
    html = page.read_text()
    assert "first-person" in html, "the parity label lost the variant caveat"
    # The browser runs the PURE-JS rasterizer, not wasm: play-templates.mjs
    # inlines rasterizer.wasm only for games whose source mentions WEBGL, and
    # this one does not — it calls voxelView/voxelSprite/voxelDusk instead. So
    # the page must carry the JS port of all three, or the human gets a blank
    # canvas and a console error.
    for fn in ("voxelView(grid, gw, gh,", "voxelSprite(eyeX, eyeY, eyeZ,",
               "voxelDusk(x, y, w, h, daylight"):
        assert fn in html, f"the play page is missing the JS {fn.split('(')[0]}"
    # Turn-based pacing from the sidecar; 60 fps would be unplayable.
    assert "1000 / 8" in html, "the page is not paced at the sidecar's 8 steps/s"
