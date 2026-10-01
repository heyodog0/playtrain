"""G4: every bundle reproduces its committed trajectory hashes (tests/golden.json): six seeds, 300 steps, the full
lockstep state every step. Written by bundles tests/gate_oracle.mjs had just proven exact against the checkout."""
from conftest import node


def test_golden_hashes():
    proc = node("tests/golden.mjs", "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
