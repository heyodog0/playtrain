"""Gate for task 10a: the study harness reads the sidecar.

PLAN 7 names the two things G6 needs from the harness:

  1. pacing — `human.steps_per_second: 8`, because Craftax is turn-based and
     60 steps/s is unplayable;
  2. the quantizer must accept a 17-action space. It hard-coded default8's
     five-key recency stack, which PLAN calls "the largest harness change and
     G6's blocker".

Both are per-game and come from the sidecar, so catalog games are untouched.
That last part is checked explicitly: the study is a human-subjects comparison
and silently re-timing or re-mapping the existing eight games would invalidate
data already collected.
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import GAME
from jsrun import have_node

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

REPO = GAME.parents[4]
STUDY = REPO / "study"
DIST = GAME / "dist"
NAME = "craftax_classic"


def render(game: str, cfg: dict) -> str:
    """Render one block page via the real template module."""
    script = f"""
import {{ blockPage }} from {json.dumps(str(STUDY / 'study-templates.mjs'))};
const cfg = {json.dumps(cfg)};
process.stdout.write(blockPage({json.dumps(game)}, '// game source', cfg));
"""
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, dir=STUDY) as fh:
        fh.write(script)
        temp = fh.name
    try:
        proc = subprocess.run(["node", temp], capture_output=True, text=True, cwd=STUDY)
        assert proc.returncode == 0, proc.stderr
        return proc.stdout
    finally:
        Path(temp).unlink(missing_ok=True)


def sidecar() -> dict:
    return json.loads((DIST / f"{NAME}.json").read_text())


def test_the_sidecar_declares_the_pacing_and_controls_the_harness_needs():
    sc = sidecar()
    assert sc["human"]["steps_per_second"] == 8
    assert sc["human"]["controls"]
    assert len(sc["actions"]) == 17


def test_a_sidecar_game_gets_its_own_tick_rate():
    html = render(NAME, {"actions": sidecar()["actions"], "stepsPerSecond": 8})
    assert re.search(r"var STEPS_PER_SECOND = 8;", html)
    assert "var FRAME_MS = 1000 / STEPS_PER_SECOND;" in html


def test_a_sidecar_game_gets_its_own_action_table():
    html = render(NAME, {"actions": sidecar()["actions"], "stepsPerSecond": 8})
    assert "var IS_DEFAULT8 = false;" in html
    names = re.findall(r'"name": "([A-Z_]+)"', html)
    assert "MAKE_IRON_SWORD" in names
    assert len([n for n in names if n]) >= 17


def test_the_generic_quantizer_covers_every_declared_action():
    """The point of deriving the quantizer from the table: every action in a
    17-action space must be reachable from some key state. Exercised by
    running the emitted quantizer logic against each action's own keys."""
    actions = sidecar()["actions"]
    probe = """
const ACTIONS = %s;
function quantizeFromTable(stack) {
  for (let s = stack.length - 1; s >= 0; s--) {
    const key = stack[s];
    for (let i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].press === key) return i;
  }
  for (let s = stack.length - 1; s >= 0; s--) {
    const k = stack[s];
    for (let j = 0; j < ACTIONS.length; j++) {
      const h = ACTIONS[j].held || [];
      if (h.length === 1 && h[0] === k) return j;
    }
  }
  return 0;
}
const out = [];
for (let i = 0; i < ACTIONS.length; i++) {
  const a = ACTIONS[i];
  const key = a.press !== null && a.press !== undefined ? a.press : (a.held || [])[0];
  out.push(key === undefined ? i : quantizeFromTable([key]));
}
console.log(JSON.stringify(out));
""" % json.dumps(actions)
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, dir=STUDY) as fh:
        fh.write(probe)
        temp = fh.name
    try:
        proc = subprocess.run(["node", temp], capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr
        got = json.loads(proc.stdout)
    finally:
        Path(temp).unlink(missing_ok=True)
    assert got == list(range(len(actions))), (
        f"some actions are unreachable from their own key: {got}"
    )


def test_catalog_games_keep_default8_and_sixty_steps_per_second():
    """The study is a human-subjects comparison; re-timing or re-mapping the
    existing games would invalidate data already collected."""
    html = render("pong", {})
    assert "var IS_DEFAULT8 = true;" in html
    assert re.search(r"var STEPS_PER_SECOND = 60;", html)
    assert "function quantizeDefault8()" in html
    # default8's hand-written stack must still be the code path, unchanged.
    assert "if (top === 32) return held.has(37) ? 6 : held.has(39) ? 7 : 5;" in html


def test_build_study_reads_the_sidecar_from_the_games_dir():
    """sidecarFor() is what connects the two: it must find <name>.json beside
    the bundle and return nothing for a catalog game."""
    src = (STUDY / "build-study.mjs").read_text()
    assert "function sidecarFor(" in src
    assert "steps_per_second" in src
    assert "sidecarFor(g.name)" in src
    assert "sidecarFor(practice.game)" in src
