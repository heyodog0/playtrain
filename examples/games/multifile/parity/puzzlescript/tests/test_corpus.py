"""G2: every corpus game compiles in its bundle with zero errors, reports the manifest's playable levels, and
loads + steps for three seeds; and the bundles are ordinary PlayTrain games (discoverable by name)."""
from conftest import node


def test_every_bundle_compiles_and_steps():
    proc = node("tests/corpus_check.mjs")
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-3000:]
    assert proc.stdout.strip().endswith("17/17 bundles ok"), proc.stdout[-500:]


def test_discoverable_by_name():
    from playtrain.runtime import list_available_games
    from playtrain.runtime.env import load_sidecar, resolve_game_file
    names = [n for n in list_available_games() if n.startswith("ps_")]
    assert len(names) == 17 and "ps_sokoban_basic" in names and "ps_midas" in names
    side = load_sidecar(resolve_game_file("ps_microban"))
    assert [a["name"] for a in side["actions"]] == ["UP", "LEFT", "DOWN", "RIGHT", "ACTION", "NOOP"]
    assert side["playable_levels"] == [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] and side["reference"]["commit"].startswith("d236596")
