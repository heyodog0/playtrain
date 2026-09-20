"""T2/T3 (CHIP-8): every snapshot of every bundle identical between the JS bundle and the twin (39 x 3 seeds x 500
steps), and the twin's snapshots hash to the family's committed golden.json (234 entries)."""
from conftest import PARITY, ensure_built, node

N_GAMES = len(list((PARITY / "chip8" / "games").glob("*.json")))


def test_lockstep_js_vs_twin():
    ensure_built()
    assert N_GAMES == 39
    proc = node("tests/lockstep_js_vs_twin.mjs", "chip8", "--steps", "500", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{3 * N_GAMES}/{3 * N_GAMES} trajectories identical")


def test_twin_reproduces_family_goldens():
    ensure_built()
    proc = node("tests/lockstep_js_vs_twin.mjs", "chip8", "--golden")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"golden ok ({6 * N_GAMES} trajectories)")
