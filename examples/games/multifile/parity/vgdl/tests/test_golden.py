"""Every bundled game reproduces its committed trajectory hashes (tests/golden.json).

The hashes were produced by an engine that tests/gate_oracle.mjs had just proven
trajectory-exact against py-vgdl; this test keeps that state checkable without
Python-VGDL or pygame installed.
"""
from conftest import node


def test_golden_hashes():
    proc = node("tests/golden.mjs", "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
