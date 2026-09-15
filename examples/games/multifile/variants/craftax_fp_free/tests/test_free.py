"""craftax_fp_free: Craftax's seventeen actions, plus six that let a human play.

This is the sibling of craftax_fp, and the difference is the whole point of it
existing. craftax_fp keeps Craftax's action space exactly and therefore cannot
turn in place or walk backwards: `movePlayer` sets the facing and then steps,
so every direction action is a turn AND a move. This variant adds six actions
that separate the two.

That makes it Craftax-DERIVED, not a parity port, and an agent trained here is
not comparable to one trained on craftax_classic. What IS still true, and is
the first gate below, is that the original seventeen are untouched: stepped
over the whole committed corpus — whose actions are all in 0..16 — this game
produces craftax_classic's canonical state byte for byte, every step. The new
actions are strictly additional.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
GAME_DIR = HERE.parent
REPO = GAME_DIR.parents[4]
DIST = GAME_DIR / "dist"
CLASSIC = REPO / "examples" / "games" / "multifile" / "parity" / "craftax_classic"
FP = REPO / "examples" / "games" / "multifile" / "variants" / "craftax_fp"
NAME = "craftax_fp_free"

# The six added indices, and what each must do.
MOVE_FORWARD, MOVE_BACK, STRAFE_LEFT, STRAFE_RIGHT, TURN_LEFT, TURN_RIGHT = 17, 18, 19, 20, 21, 22


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")


def test_craftax_s_own_actions_are_untouched():
    """The load-bearing claim. Over 210 episodes / 49,061 corpus steps, all of
    whose actions are in 0..16, this game's canonical state equals
    craftax_classic's byte for byte — so adding actions did not perturb any of
    the existing ones, and the step order (which IS the RNG specification) is
    intact."""
    proc = subprocess.run(
        ["node", str(FP / "tests" / "same_dynamics.cjs"),
         str(DIST / f"{NAME}.js"),
         str(CLASSIC / "dist" / "craftax_classic.js"),
         str(CLASSIC / "traces"),
         str(CLASSIC / "traces" / "corpus.json")],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, f"dynamics diverged:\n{proc.stdout}\n{proc.stderr}"
    out = json.loads(proc.stdout)
    assert out["ok"] is True, out
    assert out["episodes"] == 210 and out["steps"] == 49061, out


def _probe(seed: int, actions: list[int]) -> list[dict]:
    proc = subprocess.run(
        ["node", "tests/free_probe.mjs", f"dist/{NAME}.js", str(seed), *map(str, actions)],
        cwd=GAME_DIR, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    rows = []
    for line in proc.stdout.strip().splitlines():
        parts = line.split()
        rows.append({
            "action": int(parts[1]), "from": parts[3], "to": parts[5],
            "moved": parts[-2].endswith("true"), "turned": parts[-1].endswith("true"),
        })
    return rows


def test_turning_does_not_move_you():
    """Craftax cannot do this: every one of its direction actions turns AND
    steps. It is the reason this variant exists."""
    for act in (TURN_LEFT, TURN_RIGHT):
        row = _probe(1, [act])[0]
        assert row["turned"], f"action {act} did not turn"
        assert not row["moved"], f"action {act} moved the player; turning must be in place"


def test_walking_does_not_turn_you():
    """The other half: walk forward, back, or sideways with your view fixed."""
    for act in (MOVE_FORWARD, MOVE_BACK, STRAFE_LEFT, STRAFE_RIGHT):
        row = _probe(1, [act])[0]
        assert not row["turned"], f"action {act} changed the facing; walking must not turn"


def test_forward_and_back_are_opposites():
    """Walk forward twice then back twice and you are where you started, still
    facing the same way. A back action that secretly turned you would fail the
    facing check; one that moved the wrong way would fail the cell check."""
    rows = _probe(1, [MOVE_FORWARD, MOVE_FORWARD, MOVE_BACK, MOVE_BACK])
    assert all(not r["turned"] for r in rows), rows
    assert rows[0]["from"] == rows[-1]["to"], f"facing drifted: {rows}"


def test_strafe_left_and_right_are_opposites():
    rows = _probe(1, [STRAFE_LEFT, STRAFE_RIGHT])
    assert all(not r["turned"] for r in rows), rows
    assert all(r["moved"] for r in rows), f"a strafe was blocked in this seed: {rows}"


def test_four_turns_return_you_to_the_start():
    for act in (TURN_LEFT, TURN_RIGHT):
        rows = _probe(1, [act] * 4)
        assert rows[0]["from"] == rows[-1]["to"], f"four {act} turns did not come back: {rows}"
        assert len({r["to"] for r in rows}) == 4, f"turning did not visit all four facings: {rows}"


def test_every_action_has_its_own_key():
    """A host drives an action index by pressing that action's keys and letting
    the game read them, so an action with no binding silently becomes a NOOP —
    and the corpus gate above would then be passing for the wrong reason. Every
    action except NOOP must have a distinct binding."""
    sidecar = json.loads((DIST / f"{NAME}.json").read_text())
    actions = sidecar["actions"]
    assert len(actions) == 23, f"expected 23 actions, got {len(actions)}"
    seen = {}
    for i, a in enumerate(actions):
        keys = tuple(sorted(a["held"])) + (a["press"],)
        if i == 0:
            assert keys == (None,), f"NOOP should have no keys, got {keys}"
            continue
        assert keys != (None,), f"action {i} ({a['name']}) has no key binding"
        assert keys not in seen, f"actions {seen[keys]} and {i} share a binding {keys}"
        seen[keys] = i


def test_the_arrows_drive_the_new_actions():
    """What the human actually asked for: up/down walk, left/right turn."""
    by_name = {a["name"]: a for a in json.loads((DIST / f"{NAME}.json").read_text())["actions"]}
    assert by_name["MOVE_FORWARD"]["held"] == [38], "UP is not forward"
    assert by_name["MOVE_BACK"]["held"] == [40], "DOWN is not back"
    assert by_name["TURN_LEFT"]["held"] == [37], "LEFT is not turn-left"
    assert by_name["TURN_RIGHT"]["held"] == [39], "RIGHT is not turn-right"


def test_it_does_not_claim_parity():
    ref = json.loads((DIST / f"{NAME}.json").read_text())["reference"]
    assert "NOT a parity port" in ref["parity"]
    assert any("action space" in s for s in ref["not_matched"])
    assert any("craftax_fp" in s for s in ref["not_matched"]), (
        "the not_matched list should point at craftax_fp for the exact variant"
    )


def test_every_engine_agrees():
    """The frame is the same raycast craftax_fp uses, so the same cross-target
    requirement applies: QuickJS runs the Rust natively, V8 runs it as wasm32,
    and the observation hash is compared every step."""
    host = REPO / "native" / "build" / "qjs_host"
    lib = REPO / "native" / "build"
    if not host.exists() or not any(lib.glob("libqjs_vec.*")):
        pytest.skip("native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(DIST)
    env["PLAYTRAIN_QJS_ACTIONS"] = json.dumps(
        json.loads((DIST / f"{NAME}.json").read_text())["actions"])
    env.pop("PLAYTRAIN_RASTERIZER", None)
    proc = subprocess.run(
        ["./gate_qjs.sh", NAME, "3000"],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
    assert proc.stdout.count("bit-exact") == 3, proc.stdout


def test_the_play_page_builds(tmp_path):
    out = tmp_path / "play"
    proc = subprocess.run(
        ["node", "tools/build-pages.mjs", "--games", str(DIST),
         "--out", str(out), "--title", "Craftax first-person, free movement"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    page = out / "game" / NAME / "index.html"
    assert page.is_file(), f"no page at {page}"
    html = page.read_text()
    assert "1000 / 8" in html, "the page is not paced at the sidecar's 8 steps/s"
    assert "renderInterpolated" in html, "the page lost the smooth-camera hook"
    # This game does NOT want the facing-relative arrow remap: its actions are
    # already relative, so remapping would turn a turn into a turn-and-step.
    assert "relativeArrow" in html, "the page lost the generic remap hook"
    assert "function relativeArrow" not in html, (
        "craftax_fp_free must not define relativeArrow — its actions are already relative"
    )
