"""G2: the JS threefry (shared ../../common/threefry2x32.js + src/10_threefry.js) reproduces
jax.random.split and randint(key, (), 0, 256, uint8) for 10,000 keys. The reference file is
committed (tests/export_randint.py); with the oracle configured it is also regenerated and
must be byte-identical, so a JAX upgrade that changed the stream would show here first."""
import json
import os
import subprocess

import pytest
from conftest import HERE, oracle_configured, run_js

REF = HERE / "vectors" / "randint_10k.json"


def test_10k_keys_randint_and_split():
    ref = json.loads(REF.read_text())
    assert ref["n"] == 10_000 and ref["partitionable"] is True
    proc = run_js(HERE / "replay_randint.js", str(REF))
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    assert proc.stdout.strip() == "keys ok; randint 10000/10000; split sha1 ok"


@pytest.mark.skipif(not oracle_configured(), reason="Octax oracle not configured (CHIP8_ORACLE_PY, CHIP8_OCTAX)")
def test_reference_file_is_what_the_oracle_jax_produces(tmp_path):
    out = tmp_path / "randint_10k.json"
    proc = subprocess.run([os.environ["CHIP8_ORACLE_PY"], str(HERE / "export_randint.py"), "--out", str(out)],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[-3000:]
    assert json.loads(out.read_text()) == json.loads(REF.read_text())
