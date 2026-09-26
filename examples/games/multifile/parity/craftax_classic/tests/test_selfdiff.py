"""Gate for task 2b: the C must agree with itself across machines.

PLAN 4.2: "Run the driver on both and diff: the C must agree with itself across
machines before it is allowed to judge the JS." A reference that depends on
where it was compiled cannot arbitrate a bit-exactness claim.

`reference/selfdiff.py` runs 100 fixed episodes and digests them. Its output
for each machine we have built on is committed under `traces/`. This gate
does two things:

  1. regenerates the digest here and compares it to the committed file for this
     machine's architecture — catches a local build that drifted;
  2. compares the committed files for every architecture against each other —
     catches a reference that is not machine-independent.

Check 2 needs no C driver and runs anywhere, which is the point: CI keeps
holding the cross-machine claim after the driver is gone.
"""

from __future__ import annotations

import platform
import subprocess
import sys

import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver

TRACES = GAME / "traces"
SELFDIFF = GAME / "reference" / "selfdiff.py"


def digest_rows(text: str) -> list[str]:
    return [line for line in text.splitlines() if line and not line.startswith("#")]


def committed() -> dict[str, list[str]]:
    out = {}
    for path in sorted(TRACES.glob("selfdiff_*.txt")):
        arch = path.stem[len("selfdiff_") :]
        out[arch] = digest_rows(path.read_text())
    return out


def test_at_least_two_architectures_are_committed():
    """One machine's digest proves nothing about portability. If this fails,
    someone deleted a machine's file rather than adding one."""
    archs = committed()
    assert len(archs) >= 2, f"only {sorted(archs)} committed; need at least two"


def test_every_architecture_agrees_episode_for_episode():
    archs = committed()
    base_arch, base_rows = sorted(archs.items())[0]
    for arch, rows in sorted(archs.items())[1:]:
        assert len(rows) == len(base_rows), f"{arch} has {len(rows)} episodes, {base_arch} has {len(base_rows)}"
        for a, b in zip(base_rows, rows):
            assert a == b, f"{base_arch} vs {arch}: {a!r} != {b!r}"


def test_the_digest_covers_a_hundred_episodes_and_real_play():
    """Guards the corpus size named in PLAN 4.2 and catches a digest
    regenerated with a truncated episode count."""
    for arch, rows in committed().items():
        assert len(rows) == 100, f"{arch}: {len(rows)} episodes, expected 100"
        steps = sum(int(r.split()[1]) for r in rows)
        assert steps > 10000, f"{arch}: only {steps} steps across the digest"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_this_machine_reproduces_its_committed_digest():
    arch = platform.machine()
    path = TRACES / f"selfdiff_{arch}.txt"
    if not path.is_file():
        pytest.skip(f"no committed digest for {arch}; run reference/selfdiff.py --out {path}")
    proc = subprocess.run(
        [sys.executable, str(SELFDIFF), "--episodes", "100"], capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stderr
    assert digest_rows(proc.stdout) == digest_rows(path.read_text())
