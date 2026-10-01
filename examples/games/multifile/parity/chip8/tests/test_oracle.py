"""G0: the Octax reference runs locally and dumps full state per step. Skips, and only skips,
when the oracle is not configured (CHIP8_ORACLE_PY, CHIP8_OCTAX)."""
import json

from conftest import BRIX_ROM, oracle

FIELDS = {"t", "pc", "I", "V", "sp", "stack", "delay", "sound", "keypad", "display_sha1", "rng",
          "score", "reward", "terminated", "truncated"}


def test_brix_100_steps_full_state():
    proc = oracle(str(BRIX_ROM), "--game", "brix", "--seed", "1", "--random", "100", "--no-stop", "--json")
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-4000:]
    out = json.loads(proc.stdout)
    c = out["constants"]
    assert c["instructions_per_env_step"] == 44 and c["instructions_per_step"] == 11 and c["frame_skip"] == 4
    assert c["action_set"] == [4, 6] and c["noop_index"] == 2 and c["startup_instructions"] == 500
    assert c["disable_delay"] is True and c["startup_rng"] == [0, 0] and c["keypad_clear_in_every_state"]
    traj = out["traj"]
    assert len(traj) == 101, len(traj)   # reset + 100 steps (--no-stop: Octax itself keeps stepping)
    assert any(r["terminated"] for r in traj)   # random brix loses a life inside 100 steps
    for row in traj:
        assert FIELDS <= set(row), sorted(FIELDS - set(row))
        assert len(row["V"]) == 16 and len(row["stack"]) == 16 and len(row["keypad"]) == 16
        assert len(row["display_sha1"]) == 40 and len(row["rng"]) == 2
    assert traj[0]["rng"] == [0, 1] and traj[0]["t"] == 0 and traj[0]["pc"] != 0x200
    assert traj[1]["delay"] == 0 and traj[1]["sound"] == 0


def test_explicit_actions_print_five_states():
    proc = oracle(str(BRIX_ROM), "--game", "brix", "--seed", "1", "--actions", "1,0,1,2", "--json")
    assert proc.returncode == 0, proc.stderr[-4000:]
    assert len(json.loads(proc.stdout)["traj"]) == 5
