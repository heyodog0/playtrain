"""G4: every bundled game reproduces its committed trajectory hashes (tests/golden.json): six seeds,
500 steps, the full state every step. The hashes were written by an engine tests/gate_oracle.mjs had
just proven exact against Octax; this keeps that checkable without JAX."""
from conftest import node


def test_golden_hashes():
    proc = node("tests/golden.mjs", "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
