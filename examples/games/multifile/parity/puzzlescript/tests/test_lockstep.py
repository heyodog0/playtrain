"""G3: lockstep against the unmodified PuzzleScript checkout, full state every step. Runs only when PS_REF points at
the checkout at the pinned commit; skips, and only skips, otherwise."""
from pathlib import Path

import pytest
from conftest import node, ref_configured

pytestmark = pytest.mark.skipif(not ref_configured(), reason="PuzzleScript checkout not configured (PS_REF)")
N_GAMES = len(list((Path(__file__).resolve().parent.parent / "games").glob("*.json")))


def test_every_game_300_steps_3_seeds_exact():
    assert N_GAMES == 17
    proc = node("tests/gate_oracle.mjs", "--steps", "300", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-3000:]
    assert proc.stdout.strip().endswith(f"{3 * N_GAMES}/{3 * N_GAMES} trajectories exact")
