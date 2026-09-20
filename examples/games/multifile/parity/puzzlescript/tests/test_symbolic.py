"""The symbolic observation (getObservation) is the multihot level: for every cell and object, 1.0 iff the object's
bit is set in level.objects, laid out [object][row][col] over the largest playable level; dim as the sidecar says."""
import json

from conftest import FAMILY, node

CHECK = FAMILY / "tests" / "symbolic_check.mjs"


def test_symbolic_matches_level_bits_every_game():
    proc = node("tests/symbolic_check.mjs")
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith("17/17 games ok")
    side = json.loads((FAMILY / "dist" / "ps_microban.json").read_text())
    assert side["obs"]["symbolic"] == 5 * 12 * 12
