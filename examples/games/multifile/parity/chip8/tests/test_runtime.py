"""G7 (part): the bundles are ordinary PlayTrain games, discoverable by name with the sidecar honoured.
NativeVecEnv stepping is added in U07."""
from playtrain.runtime import list_available_games
from playtrain.runtime.env import load_sidecar, resolve_game_file


def test_discoverable_by_name():
    names = list_available_games()
    assert "chip8_brix" in names and "chip8_pong" in names and "chip8_tetris" in names


def test_sidecar_declares_per_game_space_and_reference():
    side = load_sidecar(resolve_game_file("chip8_brix"))
    assert side["family"] == "chip8" and side["action_set"] == [4, 6]
    assert [a["name"] for a in side["actions"]] == ["KEY_4", "KEY_6", "NOOP"]
    assert side["actions"][0]["held"] == [81] and side["actions"][2]["held"] == []
    assert side["max_steps"] == 4500 and side["parity"] is True
    assert side["reference"]["commit"] == "3aa53b516152e97f2ed91eae6e33b6ee9a97596b"
    assert side["rom"]["sha1"] == "f13766c14aeb02ad8d4d103cb5eadd282d20cddc"
    side = load_sidecar(resolve_game_file("chip8_tetris"))
    assert len(side["actions"]) == 5 and side["disable_delay"] is False
