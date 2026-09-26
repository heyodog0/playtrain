#!/usr/bin/env python3
"""Write the committed golden hash chains for the corpus.

For each corpus episode, `cc_ref run` emits a per-step FNV-1a 64 of the full
canonical state. This records those chains, one file per episode, so the
parity claim stays checkable in CI on a machine that cannot build the C.

A chain file is binary: the 8-byte little-endian hash for each step, then the
4-byte reward float bits, then a done byte — 13 bytes per step, exactly the
bytes the driver hashes into its own chain digest. Committing the hashes and
not the dumps keeps the tree small (13 bytes a step against 6880) while still
pinning every field of every step: a single changed bit anywhere in the state
changes that step's hash.

    ./build_golden.py [--out DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import subprocess
from pathlib import Path

from ccstate import CC_REF

HERE = Path(__file__).resolve().parent
DEFAULT_TRACES = HERE.parent / "traces"


def chain_for(seed: int, actions_path: Path) -> tuple[bytes, int]:
    proc = subprocess.run(
        [str(CC_REF), "run", str(seed), str(actions_path)], capture_output=True
    )
    if proc.returncode != 0:
        raise SystemExit(f"cc_ref run {seed}: {proc.stderr.decode().strip()}")
    blob = proc.stdout
    assert blob[:4] == b"CCR1"
    state_bytes, _ = struct.unpack("<II", blob[4:12])
    out = bytearray()
    i, steps = 12, 0
    while i < len(blob):
        out += blob[i : i + 13]          # hash (8), reward bits (4), done (1)
        has_dump = blob[i + 13]
        i += 14
        if has_dump:
            i += state_bytes
        steps += 1
    return bytes(out), steps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_TRACES)
    args = ap.parse_args()

    manifest = json.loads((args.out / "corpus.json").read_text())
    golden_dir = args.out / "golden"
    golden_dir.mkdir(parents=True, exist_ok=True)

    index = {}
    for ep in manifest["episodes"]:
        name = Path(ep["file"]).stem + ".fnv"
        chain, steps = chain_for(ep["seed"], args.out / ep["file"])
        assert steps == ep["steps"], f"{ep['file']}: {steps} steps, manifest says {ep['steps']}"
        (golden_dir / name).write_bytes(chain)
        index[name] = {
            "episode": ep["file"],
            "seed": ep["seed"],
            "steps": steps,
            "sha256": hashlib.sha256(chain).hexdigest(),
        }

    (args.out / "golden.json").write_text(json.dumps({
        "record_bytes": 13,
        "note": "per step: u64 FNV-1a of canonical state, u32 reward bits, u8 done",
        "chains": index,
    }, indent=2) + "\n")
    total = sum(v["steps"] for v in index.values())
    print(f"{len(index)} chains, {total} steps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
