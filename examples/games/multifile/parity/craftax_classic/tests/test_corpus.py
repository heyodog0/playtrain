"""Gate for task 3a: the parity corpus.

The corpus is the input to every later gate, so what matters is that the
committed action files are intact, match the manifest, and still replay
through the C to the episodes the manifest claims. The policies that produced
them are not ground truth and are not tested here — an action file is just
bytes, and `cc_ref run <seed> <file>` needs no Python to replay it.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver, parse_run, run

TRACES = GAME / "traces"
MANIFEST = TRACES / "corpus.json"

# PLAN 4.3's table. Hard-coded so shrinking the corpus fails the gate rather
# than silently redefining it.
EXPECTED_EPISODES = {
    "uniform": 100,
    "sticky": 50,
    "forager": 30,
    "adversarial": 20,
    "lava": 10,
}


@pytest.fixture(scope="module")
def manifest():
    assert MANIFEST.is_file(), f"{MANIFEST} missing; run reference/build_corpus.py"
    return json.loads(MANIFEST.read_text())


def test_policy_mix_matches_the_plan(manifest):
    assert manifest["policies"] == EXPECTED_EPISODES
    counts = {}
    for ep in manifest["episodes"]:
        counts[ep["policy"]] = counts.get(ep["policy"], 0) + 1
    assert counts == EXPECTED_EPISODES
    assert manifest["totals"]["episodes"] == sum(EXPECTED_EPISODES.values())


def test_every_action_file_is_present_and_unmodified(manifest):
    for ep in manifest["episodes"]:
        path = TRACES / ep["file"]
        assert path.is_file(), f"{ep['file']} missing"
        blob = path.read_bytes()
        assert len(blob) == ep["steps"], f"{ep['file']}: {len(blob)} bytes, manifest says {ep['steps']}"
        assert hashlib.sha256(blob).hexdigest() == ep["sha256"], f"{ep['file']} changed"


def test_actions_are_in_range(manifest):
    """The C clamps out-of-range actions, so an out-of-range byte would be a
    silently different episode rather than an error."""
    for ep in manifest["episodes"]:
        blob = (TRACES / ep["file"]).read_bytes()
        assert max(blob, default=0) < 17, f"{ep['file']} has an action >= 17"


def test_no_episode_is_trivial(manifest):
    for ep in manifest["episodes"]:
        assert ep["steps"] >= 10, f"{ep['file']}: only {ep['steps']} steps"


def test_totals_agree_with_the_episode_list(manifest):
    eps = manifest["episodes"]
    assert manifest["totals"]["steps"] == sum(e["steps"] for e in eps)
    reached = set()
    for ep in eps:
        reached.update(ep["achievements"])
    assert sorted(reached) == manifest["totals"]["achievements_reached"]


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_every_episode_replays_through_the_c(manifest):
    """The load-bearing one: each committed action file, replayed against the
    reference, still produces the episode the manifest describes. A driver
    change that altered dynamics would show up here as a length or terminal
    mismatch across the whole corpus."""
    for ep in manifest["episodes"]:
        parsed = parse_run(run("run", str(ep["seed"]), str(TRACES / ep["file"])))
        assert len(parsed.steps) == ep["steps"], (
            f"{ep['file']}: replayed {len(parsed.steps)} steps, manifest says {ep['steps']}"
        )
        assert parsed.steps[-1].done == (ep["terminal"] != "step-cap"), ep["file"]
