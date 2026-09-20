"""T2/T3 (VGDL, Colas profile / infer corpus): every snapshot of every level of every infer bundle identical between
the JS bundle (`__vgdl` hook) and the twin (46 levels x 3 seeds x 300 steps), and the twin reproduces the infer
entries of the family's committed golden.json (138 entries; reset-snapshot hashes, see the note in the harness)."""
import json

from conftest import PARITY, ensure_built, node

MANIFEST = json.loads((PARITY / "vgdl" / "manifest.json").read_text())
GAMES = MANIFEST["corpora"]["infer"]["games"]
N_LEVELS = sum(json.loads((PARITY / "vgdl" / "dist" / f"vgdl_{g}.json").read_text())["levels"] for g in GAMES)


def test_lockstep_js_vs_twin():
    ensure_built()
    assert len(GAMES) == 12
    proc = node("tests/lockstep_js_vs_twin.mjs", "vgdl", ",".join(GAMES), "--steps", "300", "--seeds", "1,2,3")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"{3 * N_LEVELS}/{3 * N_LEVELS} trajectories identical")


def test_twin_reproduces_family_goldens():
    ensure_built()
    proc = node("tests/lockstep_js_vs_twin.mjs", "vgdl", ",".join(GAMES), "--golden")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"golden ok ({3 * N_LEVELS} trajectories)")
