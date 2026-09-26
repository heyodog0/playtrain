"""Gate for task 2a: the reference driver itself.

The driver is what every later gate measures the JS against, so it has to be
checked first: it must build, its four modes must work, it must be
deterministic, and — the part that matters most — its in-file transcription of
puf_step must agree with the real puf_step on every step it takes.

That last check lives inside the driver (it steps a shadow env with the real
puf_step and compares full canonical state), and it reports disagreement by
exiting non-zero. So every `run` here that returns cleanly is also an assertion
that the transcription held for all of that episode's steps.
"""

from __future__ import annotations

import random
import struct
import subprocess

import pytest

from ccref import CC_REF, DRIVER_ABSENT_REASON, have_driver, layout, parse_run, run

pytestmark = pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)


def actions_file(tmp_path, seed: int, n: int):
    rng = random.Random(seed)
    path = tmp_path / f"actions_{seed}.bin"
    path.write_bytes(bytes(rng.randrange(17) for _ in range(n)))
    return path


# --- layout ---------------------------------------------------------------

def test_layout_is_packed_and_complete():
    rows, total = layout()
    assert rows, "layout printed no fields"
    off = 0
    for row_off, size, _typ, count, field in rows:
        assert row_off == off, f"{field}: offset {row_off}, expected {off} (padding?)"
        assert count > 0, f"{field}: zero count"
        assert size % count == 0
        off += size
    assert off == total


def test_layout_has_every_state_field():
    """PLAN 1.1 lists what counts as state. Nothing may be dropped from the
    canonical dump, so the field set is asserted explicitly rather than by
    count."""
    rows, _ = layout()
    names = [r[4] for r in rows]
    expected = [
        "pcg", "map_packed",
        "mob_bits", "zombie_bits", "cow_bits", "skel_bits", "arrow_bits",
        "player_r", "player_c", "player_dir",
        "health", "food", "drink", "energy", "is_sleeping",
        "recover", "hunger", "thirst", "fatigue",
        "inv",
        "zombie_r", "zombie_c", "zombie_hp", "zombie_cd", "zombie_mask",
        "cow_r", "cow_c", "cow_hp", "cow_mask",
        "skel_r", "skel_c", "skel_hp", "skel_cd", "skel_mask",
        "arrow_r", "arrow_c", "arrow_dr", "arrow_dc", "arrow_mask",
        "plant_r", "plant_c", "plant_age", "plant_mask",
        "light_level", "achievements", "timestep", "reward",
    ]
    assert names == expected


# --- rng ------------------------------------------------------------------

def test_rng_matches_a_python_reference():
    """PCG-XSH-RR with the C's seeding, reimplemented here from PLAN 1.2. If
    the driver and an independent implementation of the documented algorithm
    disagree, one of them is wrong and the port has no ground truth."""
    seed = 12345
    n = 64
    mask = (1 << 64) - 1
    state = (seed * 0x9E3779B97F4A7C15 + 0x87C37B91114253D5) & mask

    def nxt():
        nonlocal state
        state = (state * 6364136223846793005 + 1442695040888963407) & mask
        x = (((state >> 18) ^ state) >> 27) & 0xFFFFFFFF
        rot = (state >> 59) & 31
        return ((x >> rot) | (x << ((-rot) & 31))) & 0xFFFFFFFF

    for _ in range(8):
        nxt()

    lines = run("rng", str(seed), str(n)).decode().splitlines()
    assert len(lines) == n
    for line in lines:
        out_s, rf_hex, ri4_s, ri8_s, ri64_s = line.split()
        out = nxt()
        assert int(out_s) == out
        rf = struct.unpack("<f", struct.pack("<I", int(rf_hex, 16)))[0]
        assert rf == (out >> 8) * (1.0 / 16777216.0)
        assert int(ri4_s) == out % 4
        assert int(ri8_s) == out % 8
        assert int(ri64_s) == out % 64


def test_rng_is_deterministic():
    assert run("rng", "7", "32") == run("rng", "7", "32")


def test_rng_differs_between_seeds():
    assert run("rng", "7", "32") != run("rng", "8", "32")


# --- world ----------------------------------------------------------------

def test_world_dump_is_the_canonical_size():
    _, total = layout()
    assert len(run("world", "1")) == total


def test_world_is_deterministic_and_seed_dependent():
    a = run("world", "3")
    assert a == run("world", "3")
    assert a != run("world", "4")


def test_world_map_bytes_are_legal_block_ids():
    rows, _ = layout()
    off, size = next((r[0], r[1]) for r in rows if r[4] == "map_packed")
    blob = run("world", "11")
    assert set(blob[off : off + size]) <= set(range(17))


def test_world_starts_at_timestep_zero_with_full_intrinsics():
    rows, _ = layout()
    idx = {r[4]: (r[0], r[1]) for r in rows}
    blob = run("world", "5")
    assert struct.unpack_from("<i", blob, idx["timestep"][0])[0] == 0
    for field in ("health", "food", "drink", "energy"):
        assert blob[idx[field][0]] == 9
    assert blob[idx["is_sleeping"][0]] == 0
    ach_off, ach_size = idx["achievements"]
    assert blob[ach_off : ach_off + ach_size] == bytes(ach_size)


# --- run ------------------------------------------------------------------

def test_run_is_deterministic(tmp_path):
    path = actions_file(tmp_path, 1, 2000)
    assert run("run", "1", str(path)) == run("run", "1", str(path))


def test_run_shape_and_terminal_dump(tmp_path):
    _, total = layout()
    path = actions_file(tmp_path, 2, 4000)
    parsed = parse_run(run("run", "2", str(path), "--dump-every", "100"))

    assert parsed.state_bytes == total
    assert parsed.n_actions == 4000
    assert parsed.steps, "no steps recorded"

    # Stepping stops at the first terminal step and nowhere else.
    assert parsed.steps[-1].done
    assert not any(s.done for s in parsed.steps[:-1])

    # The terminal step always carries a full dump — that is the step the
    # reference's auto-reset would otherwise destroy, and the whole reason the
    # driver transcribes puf_step.
    assert parsed.steps[-1].state is not None
    assert len(parsed.steps[-1].state) == total

    for i, step in enumerate(parsed.steps, start=1):
        want_dump = step.done or i % 100 == 0
        assert (step.state is not None) == want_dump, f"step {i}"


def test_run_hash_matches_the_dumped_state(tmp_path):
    """The per-step hash is what the committed golden chains will hold, so it
    has to be the hash of exactly the bytes the dump contains."""
    path = actions_file(tmp_path, 3, 3000)
    parsed = parse_run(run("run", "3", str(path), "--dump-every", "1"))
    for i, step in enumerate(parsed.steps, start=1):
        assert step.state is not None
        h = 1469598103934665603
        for byte in step.state:
            h = ((h ^ byte) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
        assert step.hash == h, f"step {i}"


def test_run_state_advances_every_step(tmp_path):
    """A stuck driver that re-dumped the same state would pass a lot of weaker
    checks. timestep must increase by exactly one per step."""
    rows, _ = layout()
    ts_off = next(r[0] for r in rows if r[4] == "timestep")
    path = actions_file(tmp_path, 4, 500)
    parsed = parse_run(run("run", "4", str(path), "--dump-every", "1"))
    for i, step in enumerate(parsed.steps, start=1):
        assert struct.unpack_from("<i", step.state, ts_off)[0] == i


def test_transcription_agrees_with_puf_step_over_many_episodes(tmp_path):
    """The load-bearing one. cc_step_no_reset exists only because puf_step
    auto-resets over the terminal state; the driver checks the two against each
    other on every non-terminal step and exits non-zero on the first
    disagreement. Run enough episodes that the check has real coverage."""
    total_steps = 0
    for seed in range(40):
        path = actions_file(tmp_path, 100 + seed, 10000)
        parsed = parse_run(run("run", str(seed), str(path)))
        total_steps += len(parsed.steps)
    assert total_steps > 2000, f"only {total_steps} steps cross-checked"


# --- the build's own invariant --------------------------------------------

def test_no_libm_cosf_or_sinf_survives():
    """PLAN 1.4: the C's transcendentals must be V8's ieee754, not the
    platform libm. build.sh checks this too; the gate checks the artifact that
    actually shipped."""
    out = subprocess.run(["nm", str(CC_REF)], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    bad = [
        line
        for line in out.stdout.splitlines()
        if line.split()[-1] in ("_cosf", "cosf", "_sinf", "sinf")
    ]
    assert not bad, "platform cosf/sinf linked into cc_ref:\n" + "\n".join(bad)
