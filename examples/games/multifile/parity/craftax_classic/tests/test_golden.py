"""Gate: the committed golden chains, and the C's agreement with them.

This is the half of the parity claim that survives without a compiler. CI
cannot build PufferLib's C, so what CI checks is that the committed chains are
intact and self-consistent; a machine that *can* build the reference also
checks that the C still reproduces them step for step.

A chain is 13 bytes per step: the FNV-1a 64 of the full canonical state, the
reward's float bits, and the done flag. One flipped bit anywhere in the 6880
byte state changes that step's hash, so the chains pin every field without
committing a gigabyte of dumps.
"""

from __future__ import annotations

import hashlib
import json
import struct

import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver, parse_run, run

TRACES = GAME / "traces"
GOLDEN = TRACES / "golden"
RECORD = 13


@pytest.fixture(scope="module")
def index():
    path = TRACES / "golden.json"
    assert path.is_file(), f"{path} missing; run reference/build_golden.py"
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def corpus():
    return json.loads((TRACES / "corpus.json").read_text())


def test_there_is_a_chain_for_every_episode(index, corpus):
    expected = {__import__("pathlib").Path(ep["file"]).stem + ".fnv" for ep in corpus["episodes"]}
    assert set(index["chains"]) == expected


def test_chains_are_present_and_unmodified(index):
    for name, meta in index["chains"].items():
        path = GOLDEN / name
        assert path.is_file(), f"{name} missing"
        blob = path.read_bytes()
        assert hashlib.sha256(blob).hexdigest() == meta["sha256"], f"{name} changed"
        assert len(blob) == meta["steps"] * RECORD, f"{name}: {len(blob)} bytes for {meta['steps']} steps"


def test_chain_lengths_match_the_corpus(index, corpus):
    by_file = {ep["file"]: ep for ep in corpus["episodes"]}
    for name, meta in index["chains"].items():
        assert meta["steps"] == by_file[meta["episode"]]["steps"], name


def test_done_appears_only_on_the_last_step(index):
    for name, meta in index["chains"].items():
        blob = (GOLDEN / name).read_bytes()
        dones = [blob[i * RECORD + 12] for i in range(meta["steps"])]
        assert all(d == 0 for d in dones[:-1]), f"{name}: done set before the last step"


def test_hashes_are_not_degenerate(index):
    """A chain of repeated hashes would mean the state stopped changing, and
    would still pass a naive length check."""
    for name, meta in index["chains"].items():
        blob = (GOLDEN / name).read_bytes()
        hashes = {blob[i * RECORD : i * RECORD + 8] for i in range(meta["steps"])}
        assert len(hashes) == meta["steps"], f"{name}: {meta['steps'] - len(hashes)} repeated states"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_c_still_reproduces_every_chain(index, corpus):
    """The load-bearing one, on a machine with the reference: replay each
    episode and compare the whole chain byte for byte."""
    by_file = {ep["file"]: ep for ep in corpus["episodes"]}
    for name, meta in index["chains"].items():
        ep = by_file[meta["episode"]]
        parsed = parse_run(run("run", str(ep["seed"]), str(TRACES / ep["file"])))
        want = (GOLDEN / name).read_bytes()
        got = bytearray()
        for step in parsed.steps:
            got += struct.pack("<QIB", step.hash, step.reward_bits, 1 if step.done else 0)
        if bytes(got) != want:
            for i in range(min(len(got), len(want)) // RECORD):
                a = bytes(got[i * RECORD : (i + 1) * RECORD])
                b = want[i * RECORD : (i + 1) * RECORD]
                if a != b:
                    pytest.fail(
                        f"{name} (seed {ep['seed']}) diverges at step {i + 1}: "
                        f"C {a.hex()} vs golden {b.hex()}"
                    )
            pytest.fail(f"{name}: chain length {len(got)} vs golden {len(want)}")
