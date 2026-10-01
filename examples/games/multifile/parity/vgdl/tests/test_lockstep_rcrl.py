"""Lockstep gate for the fMRI originals against tomov/RC_RL's Python 2 py-vgdl, run in the
`rcrl-oracle` docker image. Needs VGDL_RCRL=<RC_RL checkout, branch fmri> and docker; skips otherwise."""
import os
import shutil

import pytest
from conftest import node

pytestmark = pytest.mark.skipif(
    not (os.environ.get("VGDL_RCRL") and shutil.which("docker")),
    reason="RC_RL oracle not configured (VGDL_RCRL + docker image rcrl-oracle)",
)


def test_fmri_corpus_trajectory_exact():
    proc = node("tests/gate_oracle_rcrl.mjs", "--steps", "200", "--seeds", "42,7", "--levels", "0,1")
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
