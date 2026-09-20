"""G0: the vendored reference is the pinned commit, byte for byte, and the reference's own test-suite passes
on that checkout. The sha256 half runs everywhere; the byte comparison and the 770-test run need PS_REF."""
import hashlib
import os
import subprocess
from pathlib import Path

import pytest
from conftest import FAMILY, MANIFEST, oracle, ref_configured

PIN = "d236596d993b6ebb7988f1a078f582c0840ccbca"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_vendored_files_match_manifest_sha256():
    for rel, v in MANIFEST["vendored"].items():
        assert sha256(FAMILY / "reference" / rel) == v["sha256"], rel
    assert set(MANIFEST["reference"]["engine_load_order"]) <= set(MANIFEST["vendored"])


def test_corpus_texts_match_manifest_sha256():
    games = MANIFEST["corpus"]["games"]
    assert len(games) == 17 and set(games) == {p.stem for p in (FAMILY / "games").glob("*.txt")}
    for g, v in games.items():
        assert sha256(FAMILY / "games" / f"{g}.txt") == v["sha256"], g
        assert v["compile_errors"] == 0 and len(v["playable_levels"]) >= 1


@pytest.mark.skipif(not ref_configured(), reason="PuzzleScript checkout not configured (PS_REF)")
def test_checkout_is_the_pin_and_vendored_bytes_are_identical():
    ref = Path(os.environ["PS_REF"])
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ref, capture_output=True, text=True).stdout.strip()
    assert head == PIN == MANIFEST["reference"]["commit"]
    for rel, v in MANIFEST["vendored"].items():
        assert (ref / v["source"]).read_bytes() == (FAMILY / "reference" / rel).read_bytes(), rel
    for g, v in MANIFEST["corpus"]["games"].items():
        assert (ref / v["source"]).read_bytes() == (FAMILY / "games" / f"{g}.txt").read_bytes(), g


def test_reference_suite_passes_on_the_checkout():
    proc = oracle("--selftest")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "Total:   770 tests" in proc.stdout or "770 tests" in proc.stdout, proc.stdout
