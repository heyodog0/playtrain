"""T2/T3 (VGDL, both profiles): every snapshot of every level of every bundle identical between the JS bundle
(`__vgdl` hook) and the twin (infer / Colas: 46 levels; vgfmri_rcrl / RC_RL: 126 levels; x 3 seeds x 300 steps),
and the twin reproduces every entry of the family's committed golden.json (138 + 378; reset-snapshot hashes, see the
note in the harness)."""
import json

import pytest
from conftest import PARITY, ensure_built, node

MANIFEST = json.loads((PARITY / "vgdl" / "manifest.json").read_text())
CORPORA = {c: MANIFEST["corpora"][c]["games"] for c in ("infer", "vgfmri_rcrl")}


def n_levels(games):
    return sum(json.loads((PARITY / "vgdl" / "dist" / f"vgdl_{g}.json").read_text())["levels"] for g in games)


def test_corpus_sizes():
    assert len(CORPORA["infer"]) == 12 and len(CORPORA["vgfmri_rcrl"]) == 14
    assert n_levels(CORPORA["infer"]) == 46 and n_levels(CORPORA["vgfmri_rcrl"]) == 126


@pytest.mark.parametrize("corpus", list(CORPORA))
def test_lockstep_js_vs_twin(corpus):
    ensure_built()
    games = CORPORA[corpus]; n = 3 * n_levels(games)
    proc = node("tests/lockstep_js_vs_twin.mjs", "vgdl", ",".join(games), "--steps", "300", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{n}/{n} trajectories identical")


@pytest.mark.parametrize("corpus", list(CORPORA))
def test_twin_reproduces_family_goldens(corpus):
    ensure_built()
    games = CORPORA[corpus]; n = 3 * n_levels(games)
    proc = node("tests/lockstep_js_vs_twin.mjs", "vgdl", ",".join(games), "--golden")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"golden ok ({n} trajectories)")
