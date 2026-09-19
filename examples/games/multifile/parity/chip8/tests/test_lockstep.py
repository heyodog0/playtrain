"""G3: lockstep against Octax, full state every step. Runs only when the oracle is configured:

    CHIP8_ORACLE_PY=<oracle venv python>  CHIP8_OCTAX=<Octax checkout at the pinned commit>

Skips, and only skips, when those are absent (multifile README rule)."""
import pytest
from conftest import node, oracle_configured

pytestmark = pytest.mark.skipif(not oracle_configured(), reason="Octax oracle not configured (CHIP8_ORACLE_PY, CHIP8_OCTAX)")

U04_GAMES = "brix,pong,tetris"


def test_brix_pong_tetris_500_steps_3_seeds_exact():
    proc = node("tests/gate_oracle.mjs", U04_GAMES, "--steps", "500", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-3000:]
    assert proc.stdout.strip().endswith("9/9 trajectories exact")
