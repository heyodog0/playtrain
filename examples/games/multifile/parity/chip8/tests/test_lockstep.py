"""G3: lockstep against Octax, full state every step. Runs only when the oracle is configured:

    CHIP8_ORACLE_PY=<oracle venv python>  CHIP8_OCTAX=<Octax checkout at the pinned commit>

Skips, and only skips, when those are absent (multifile README rule)."""
import pytest
from conftest import node, oracle_configured

pytestmark = pytest.mark.skipif(not oracle_configured(), reason="Octax oracle not configured (CHIP8_ORACLE_PY, CHIP8_OCTAX)")

from pathlib import Path

N_GAMES = len(list((Path(__file__).resolve().parent.parent / "games").glob("*.json")))   # 39: 19 games + 20 levels


def test_every_game_and_level_500_steps_3_seeds_exact():
    assert N_GAMES == 39
    proc = node("tests/gate_oracle.mjs", "--steps", "500", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-3000:]
    assert proc.stdout.strip().endswith(f"{3 * N_GAMES}/{3 * N_GAMES} trajectories exact")
