#!/usr/bin/env python
"""Export opcode vectors from Octax's own test-suite: every `execute(state, instruction)` call
the tests make is recorded as (pre-state, instruction, post-state) while pytest runs them.

    CHIP8_OCTAX=<octax checkout> python export_vectors.py --out vectors/octax_tests.json

Runs in the oracle venv. Nothing in the checkout is modified: `octax.execute` is wrapped in
this process only. Memory is stored sparse ([addr, byte] for every nonzero byte); the display
is 256 bytes hex, packbits of display[x][y] in C order (x-major), like tests/oracle.py.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.environ["CHIP8_OCTAX"])
import jax  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
import octax  # noqa: E402
import octax.emulator  # noqa: E402

REAL_EXECUTE = octax.emulator.execute
VECTORS = []
CURRENT = {"test": None}


def dump(st):
    mem = np.asarray(st.memory, dtype=np.uint8)
    nz = np.nonzero(mem)[0]
    return {
        "memory": [[int(a), int(mem[a])] for a in nz],
        "pc": int(st.pc), "I": int(st.I),
        "V": [int(v) for v in np.asarray(st.V)],
        "sp": int(st.stack.pointer),
        "stack": [int(v) for v in np.asarray(st.stack.data)],
        "delay": int(st.delay_timer), "sound": int(st.sound_timer),
        "keypad": [int(k) for k in np.asarray(st.keypad)],
        "display": np.packbits(np.asarray(st.display, dtype=np.bool_).reshape(-1)).tobytes().hex(),
        "rng": [int(v) for v in np.asarray(jax.random.key_data(st.rng)).reshape(-1)],
        "modern": bool(st.modern_mode),
    }


def recording_execute(state, instruction):
    pre = dump(state)
    post_state = REAL_EXECUTE(state, instruction)
    VECTORS.append({"test": CURRENT["test"], "instruction": int(instruction), "pre": pre, "post": dump(post_state)})
    return post_state


class Recorder:
    def pytest_runtest_setup(self, item):
        CURRENT["test"] = item.nodeid


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    octax.execute = recording_execute          # `from octax import execute` in the tests binds this
    octax.emulator.execute = recording_execute
    tests_dir = os.path.join(os.environ["CHIP8_OCTAX"], "tests")
    rc = pytest.main(["-q", "-p", "no:cacheprovider", "--rootdir", os.environ["CHIP8_OCTAX"], tests_dir], plugins=[Recorder()])
    if rc != 0:
        raise SystemExit(f"Octax's own tests did not pass (rc={rc}); vectors not written")
    tests = sorted({v["test"] for v in VECTORS})
    out = {"octax_commit": open(os.path.join(os.environ["CHIP8_OCTAX"], ".git", "HEAD")).read().strip(),
           "jax": jax.__version__, "n_tests": len(tests), "n_vectors": len(VECTORS),
           "n_legacy": sum(1 for v in VECTORS if not v["pre"]["modern"]), "vectors": VECTORS}
    with open(a.out, "w") as f:
        json.dump(out, f, sort_keys=True)
        f.write("\n")
    print(f"{len(VECTORS)} vectors from {len(tests)} tests -> {a.out}")
