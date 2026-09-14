"""Shared helpers for talking to the reference driver (reference/build/cc_ref).

Every gate that needs the C goes through here so there is one definition of
"is the driver present", one of "how do I parse its output", and one place to
change if the protocol changes.
"""

from __future__ import annotations

import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
REFERENCE = GAME / "reference"
CC_REF = REFERENCE / "build" / "cc_ref"
BUILD_SH = REFERENCE / "build.sh"

DRIVER_ABSENT_REASON = (
    f"reference driver not built; run {BUILD_SH.relative_to(GAME.parents[4])}"
)


def have_driver() -> bool:
    return CC_REF.is_file()


def run(*args: str) -> bytes:
    """Run cc_ref and return stdout. Non-zero exit is a hard failure: the
    driver exits non-zero when its own transcription of puf_step disagrees with
    the real puf_step, and that must never be swallowed."""
    proc = subprocess.run([str(CC_REF), *args], capture_output=True)
    if proc.returncode != 0:
        raise AssertionError(
            f"cc_ref {' '.join(args)} exited {proc.returncode}: "
            f"{proc.stderr.decode(errors='replace').strip()}"
        )
    return proc.stdout


@dataclass(frozen=True)
class Step:
    hash: int
    reward_bits: int
    done: bool
    state: bytes | None


@dataclass(frozen=True)
class Run:
    state_bytes: int
    n_actions: int
    steps: list[Step]


def parse_run(blob: bytes) -> Run:
    assert blob[:4] == b"CCR1", f"bad magic {blob[:4]!r}"
    state_bytes, n_actions = struct.unpack("<II", blob[4:12])
    steps: list[Step] = []
    i = 12
    while i < len(blob):
        h, rb, done, has_dump = struct.unpack("<QIBB", blob[i : i + 14])
        i += 14
        state = None
        if has_dump:
            state = blob[i : i + state_bytes]
            i += state_bytes
        steps.append(Step(h, rb, bool(done), state))
    assert i == len(blob), "trailing bytes in cc_ref run output"
    return Run(state_bytes, n_actions, steps)


def layout() -> tuple[list[tuple[int, int, str, int, str]], int]:
    """Parse `cc_ref layout` into (rows, total). Row = (offset, size, type,
    count, field)."""
    rows = []
    total = None
    for line in run("layout").decode().splitlines():
        if line.startswith("#") or line.startswith("offset"):
            continue
        if line.startswith("total "):
            total = int(line.split()[1])
            continue
        off, size, typ, count, field = line.split()
        rows.append((int(off), int(size), typ, int(count), field))
    assert total is not None, "cc_ref layout printed no total"
    return rows, total
