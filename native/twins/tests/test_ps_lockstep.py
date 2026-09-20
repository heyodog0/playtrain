"""T2/T3/T6 (PuzzleScript): every snapshot of every bundle identical between the JS bundle (`__ps` hook) and the
twin (17 games x seeds 1,2,3 x 300 steps, stopping at winning); the twin's snapshots hash to the family's committed
golden.json (102 entries); the twin's tile lists (`__ps.tiles()`: viewport, kinds, atlas keys) equal the prelude's
for 17 x 3 x 100 states."""
from conftest import PARITY, ensure_built, node

N_GAMES = len(list((PARITY / "puzzlescript" / "games").glob("*.json")))


def test_lockstep_js_vs_twin():
    ensure_built()
    assert N_GAMES == 17
    proc = node("tests/lockstep_js_vs_twin.mjs", "puzzlescript", "--steps", "300", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{3 * N_GAMES}/{3 * N_GAMES} trajectories identical")


def test_twin_reproduces_family_goldens():
    ensure_built()
    proc = node("tests/lockstep_js_vs_twin.mjs", "puzzlescript", "--golden")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"golden ok ({6 * N_GAMES} trajectories)")


def test_render_tiles_equal_prelude():
    ensure_built()
    proc = node("tests/lockstep_js_vs_twin.mjs", "puzzlescript", "--tiles", "--steps", "100", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{3 * N_GAMES}/{3 * N_GAMES} trajectories identical")
