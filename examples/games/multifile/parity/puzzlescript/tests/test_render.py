"""G8: the reference's own redraw() (graphics.js, run with a recording 2D context) and the prelude's tile list agree
on every cell's ordered sprite ids and on the viewport, over 200 random states per game."""
from conftest import node


def test_reference_draw_list_matches_prelude_tiles():
    proc = node("tests/render_gate.mjs", "--seeds", "10", "--steps", "20")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-3000:]
    assert proc.stdout.strip().endswith("0 mismatches"), proc.stdout[-500:]
