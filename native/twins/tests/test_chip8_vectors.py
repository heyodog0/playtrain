"""T1 (CHIP-8): the C++ CPU replays all 193 opcode vectors recorded from Octax's tests, and threefry split/randint
match jax for 10,000 keys (the same files the JS family's G1/G2 use)."""
import subprocess

from conftest import BUILD, PARITY, ensure_built

VEC = PARITY / "chip8" / "tests" / "vectors"


def test_opcode_vectors_and_randint():
    ensure_built()
    proc = subprocess.run([str(BUILD / "test_vectors"), str(VEC / "octax_tests.json"), str(VEC / "randint_10k.json")], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
    lines = proc.stdout.strip().split("\n")
    assert lines[-2] == "193/193 vectors match (15 legacy-mode)", lines
    assert lines[-1] == "keys ok; randint 10000/10000; split sha1 ok", lines
