"""T4: the variant's dynamics are craftax_classic's, to the byte.

This is the gate the whole "same task, different observation" claim rests on.
craftax_fp reuses classic's dynamics sources by manifest path, so in principle
the two cannot disagree — but "in principle" is exactly what a gate is for. A
stray global in the first-person renderer that shadowed a dynamics name, or a
source quietly dropped from the manifest, would show up here and nowhere else.

What is compared, every step of all 210 corpus episodes:

* the full 6880-byte canonical dump, byte for byte, no tolerance;
* the 1345-float symbolic observation, as bytes;
* the reward bits and the done flag, against the chains committed for
  craftax_classic in traces/golden/.

Where the C fits in. This file compares fp against classic. classic against
PufferLib's C is G2, craftax_classic/tests/test_lockstep.py, which needs the
reference driver built (reference/build.sh) and was green on this machine when
this gate was written: 210 episodes, 49,061 steps. The two together are what
make "fp has the C's dynamics" a measured statement rather than an inference
from the manifest.

One thing this does NOT check, deliberately: the state-hash column of the
golden chains. See the long comment in same_dynamics.cjs — that column cannot
be reproduced from the canonical state by anyone, including the C driver that
wrote it, and chasing it would mean gating on a reference-driver quirk instead
of on this variant.
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
CLASSIC = REPO / "examples" / "games" / "multifile" / "parity" / "craftax_classic"
TRACES = CLASSIC / "traces"

FP_DIST = GAME_DIR / "dist"
CL_DIST = CLASSIC / "dist"

VIEW_H = 49


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")


@pytest.fixture(scope="module")
def comparison():
    """Step both bundles over the whole corpus and compare, in one node run."""
    proc = subprocess.run(
        ["node", str(HERE / "same_dynamics.cjs"),
         str(FP_DIST / "craftax_fp.js"),
         str(CL_DIST / "craftax_classic.js"),
         str(TRACES),
         str(TRACES / "corpus.json")],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        pytest.fail(f"dynamics diverged:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


def test_the_whole_corpus_was_actually_stepped(comparison):
    """A gate that silently compared nothing would pass. These are the corpus's
    own totals, so a truncated run or a missing episode fails here."""
    totals = json.loads((TRACES / "corpus.json").read_text())["totals"]
    assert comparison["episodes"] == 210, comparison
    assert comparison["steps"] == totals["steps"] == 49061, comparison
    assert comparison["state_bytes"] == 6880, comparison


def test_canonical_state_is_identical_every_step(comparison):
    assert comparison["ok"] is True, comparison


def test_symbolic_observation_is_identical_every_step(comparison):
    """85_obs_symbolic.js is reused verbatim, and this says so in bytes."""
    assert comparison["symbolic_steps"] == comparison["steps"], comparison


def test_reward_and_done_match_the_committed_chains(comparison):
    assert comparison["chain_steps"] == comparison["steps"], comparison


@pytest.fixture(scope="module")
def envs():
    from playtrain.runtime import PlayTrainEnv

    fp = PlayTrainEnv(game="craftax_fp", games_dir=str(FP_DIST), obs_size=64, obs_mode="rgb")
    cl = PlayTrainEnv(game="craftax_classic", games_dir=str(CL_DIST), obs_size=64, obs_mode="rgb")
    try:
        yield fp, cl
    finally:
        fp.close()
        cl.close()


def test_the_inventory_strip_is_byte_identical_to_classic(envs):
    """Rows 49-62 must be classic's pixels exactly (plan section 4.5).

    The first-person renderer reuses classic's icon and digit atlases, its
    float buffer and its upload path, but the ~20-line slot loop is a COPY —
    that code is inline in a function the variant has to replace, and
    extracting it would mean editing craftax_classic, which the plan forbids.
    A copy is only safe if something keeps it honest. This is that something.
    """
    fp, cl = envs
    a, _ = fp.reset(seed=1)
    b, _ = cl.reset(seed=1)
    # Walk a trajectory that changes the inventory: collect wood, place things.
    for step, action in enumerate([5, 3, 5, 1, 5, 2, 5, 4, 5, 8, 5, 7, 5, 12, 5, 6] * 4):
        a = fp.step(action)[0]
        b = cl.step(action)[0]
        strip_fp = a[VIEW_H:63, :63]
        strip_cl = b[VIEW_H:63, :63]
        if not np.array_equal(strip_fp, strip_cl):
            bad = np.argwhere(np.any(strip_fp != strip_cl, axis=2))
            y, x = bad[0]
            pytest.fail(
                f"step {step}: inventory strip differs at row {VIEW_H + y}, col {x}: "
                f"fp={tuple(strip_fp[y, x])} classic={tuple(strip_cl[y, x])} "
                f"({len(bad)} pixels differ)"
            )


def test_the_inventory_strip_is_not_vacuously_equal(envs):
    """The comparison above would pass on two blank strips. It must not be
    blank, and it must change as the inventory changes."""
    fp, _ = envs
    seen = set()
    fp.reset(seed=1)
    for action in [5, 3, 5, 1, 5, 2, 5, 4, 5, 8] * 4:
        obs = fp.step(action)[0]
        seen.add(obs[VIEW_H:63, :63].tobytes())
    assert len(seen) > 1, "the inventory strip never changed over the trajectory"
