"""G1: every `execute` call in Octax's own test-suite, replayed on the JS CPU with the full
post-state compared (memory, pc, I, V, sp, stack, timers, keypad, display, rng, mode).
tests/vectors/octax_tests.json is produced by tests/export_vectors.py in the oracle venv."""
import json

from conftest import HERE, run_js

VECTORS = HERE / "vectors" / "octax_tests.json"


def test_octax_test_suite_vectors():
    data = json.loads(VECTORS.read_text())
    assert data["n_vectors"] == len(data["vectors"]) >= 190 and data["n_tests"] >= 69
    proc = run_js(HERE / "replay_vectors.js", str(VECTORS))
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{len(data['vectors'])}/{len(data['vectors'])} vectors match ({data['n_legacy']} legacy-mode)")
