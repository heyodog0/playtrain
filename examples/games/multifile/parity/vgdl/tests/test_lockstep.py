"""Lockstep gate against the py-vgdl reference. Runs only when the oracle is configured:

    VGDL_ORACLE_PY=<python with pygame>  VGDL_LAE=<infer-vgdl checkout root>

Skips, and only skips, when those are absent (multifile README rule).
"""
import os

import pytest
from conftest import node

pytestmark = pytest.mark.skipif(
    not (os.environ.get("VGDL_ORACLE_PY") and os.environ.get("VGDL_LAE")),
    reason="py-vgdl oracle not configured (VGDL_ORACLE_PY, VGDL_LAE)",
)


def test_infer_corpus_trajectory_exact():
    proc = node("tests/gate_oracle.mjs", "infer", "--steps", "300", "--seeds", "42,7,3")
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
