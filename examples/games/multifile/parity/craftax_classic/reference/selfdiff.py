#!/usr/bin/env python3
"""selfdiff.py — run a fixed set of episodes through cc_ref and print a digest.

PLAN 4.2: "Run the driver on both and diff: the C must agree with itself across
machines before it is allowed to judge the JS." This produces the thing to
diff. It is deliberately dependency-free and deterministic in its inputs:
actions come from random.Random(seed), whose Mersenne Twister is stable across
Python versions and platforms, so both machines step the identical action
sequence without shipping any files between them.

Output, one line per episode:

    <seed> <steps> <chain_hash_hex> <final_state_hash_hex>

chain_hash is FNV-1a 64 over the concatenated per-step (hash, reward, done)
records, so a divergence anywhere in the episode changes it. final_state_hash
is the driver's own hash of the terminal canonical state.

    ./selfdiff.py [--episodes N] [--steps N] [--out FILE]
"""

from __future__ import annotations

import argparse
import platform
import random
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CC_REF = HERE / "build" / "cc_ref"

FNV_OFFSET = 1469598103934665603
FNV_PRIME = 1099511628211
MASK64 = 0xFFFFFFFFFFFFFFFF


def fnv1a64(data: bytes) -> int:
    h = FNV_OFFSET
    for byte in data:
        h = ((h ^ byte) * FNV_PRIME) & MASK64
    return h


def actions_for(seed: int, n: int) -> bytes:
    return bytes(random.Random(seed).randrange(17) for _ in range(n))


def episode(seed: int, steps: int, tmpdir: Path) -> tuple[int, int, int]:
    path = tmpdir / f"a{seed}.bin"
    path.write_bytes(actions_for(seed, steps))
    proc = subprocess.run([str(CC_REF), "run", str(seed), str(path)], capture_output=True)
    if proc.returncode != 0:
        sys.exit(f"cc_ref run {seed} exited {proc.returncode}: {proc.stderr.decode().strip()}")
    blob = proc.stdout
    assert blob[:4] == b"CCR1", "bad magic from cc_ref"
    state_bytes, _ = struct.unpack("<II", blob[4:12])

    records = bytearray()
    i, n_steps, final_hash = 12, 0, 0
    while i < len(blob):
        h, rb, done, has_dump = struct.unpack("<QIBB", blob[i : i + 14])
        records += blob[i : i + 13]          # hash, reward, done — not has_dump
        i += 14
        if has_dump:
            i += state_bytes
        n_steps += 1
        final_hash = h
    return n_steps, fnv1a64(bytes(records)), final_hash


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=100)
    ap.add_argument("--steps", type=int, default=10000)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    if not CC_REF.is_file():
        sys.exit(f"selfdiff: {CC_REF} not built; run ./build.sh")

    lines = [f"# machine {platform.machine()}", f"# episodes {args.episodes} steps {args.steps}"]
    with tempfile.TemporaryDirectory() as td:
        tmpdir = Path(td)
        for seed in range(args.episodes):
            n, chain, final = episode(seed, args.steps, tmpdir)
            lines.append(f"{seed} {n} {chain:016x} {final:016x}")

    text = "\n".join(lines) + "\n"
    if args.out:
        args.out.write_text(text)
        print(f"wrote {args.out} ({args.episodes} episodes)")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
