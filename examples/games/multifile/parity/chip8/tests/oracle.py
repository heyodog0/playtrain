#!/usr/bin/env python
"""Octax reference oracle: step a CHIP-8 game from a ROM + seed + action list and dump the
full emulator state after reset and after every step as JSON.

    CHIP8_OCTAX=<octax checkout> python oracle.py "roms/Brix [Andreas Gustafsson, 1990].ch8" \
        --game brix --seed 1 --actions 1,0,1,2 --json

Runs in its own venv (jax[cpu] pinned in manifest.json reference.oracle_jax), never in the
playtrain one. `--game` is the Octax env_id as create_environment takes it (`brix`,
`cavern1`, `space_flight10`); the environment is built exactly as create_environment
builds it (same getattr defaults, disable_delay False unless the module says otherwise).
The ROM given on the command line must be byte-identical to the checkout's copy.

Action indices are Octax's: 0..len(action_set)-1 press action_set[i], len(action_set) is NOOP.
Display hash: the (64, 32) bool array as Octax stores it (display[x][y]), flattened in C order
(x-major), packed to 256 bytes with np.packbits (MSB first), sha1 hex.
"""
import hashlib
import importlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.environ["CHIP8_OCTAX"])
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpy as np  # noqa: E402
from octax.env import OctaxEnv  # noqa: E402


def sha1_file(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def display_bytes(display) -> bytes:
    return np.packbits(np.asarray(display, dtype=np.bool_).reshape(-1)).tobytes()


def resolve(env_id):
    """Mirror octax.environments.create_environment's module/rom resolution."""
    env_id = env_id.replace("-", "_")
    m = re.match(r"^(.*?)(\d+)$", env_id)
    if m:
        module = importlib.import_module(f"octax.environments.{m.group(1)}")
        rom_file = env_id + ".ch8"
    else:
        module = importlib.import_module(f"octax.environments.{env_id}")
        rom_file = module.rom_file
    return module, rom_file


def build(rom_path, env_id):
    module, rom_file = resolve(env_id)
    ref_rom = os.path.join(os.environ["CHIP8_OCTAX"], "roms", rom_file)
    if sha1_file(rom_path) != sha1_file(ref_rom):
        raise SystemExit(f"ROM mismatch: {rom_path} sha1 {sha1_file(rom_path)} != checkout {rom_file} {sha1_file(ref_rom)}")
    env = OctaxEnv(
        rom_path=rom_path,
        score_fn=getattr(module, "score_fn", lambda _: 0),
        terminated_fn=getattr(module, "terminated_fn", lambda _: False),
        action_set=getattr(module, "action_set", None),
        startup_instructions=getattr(module, "startup_instructions", 0),
        custom_startup=getattr(module, "custom_startup", None),
        disable_delay=getattr(module, "disable_delay", False),
        render_mode=None,
    )
    return env, module, rom_file


def snapshot(st, t, reward, terminated, truncated, with_display):
    row = {
        "t": int(t),
        "pc": int(st.pc), "I": int(st.I),
        "V": [int(v) for v in np.asarray(st.V)],
        "sp": int(st.stack.pointer),
        "stack": [int(v) for v in np.asarray(st.stack.data)],
        "delay": int(st.delay_timer), "sound": int(st.sound_timer),
        "keypad": [int(k) for k in np.asarray(st.keypad)],
        "display_sha1": hashlib.sha1(display_bytes(st.display)).hexdigest(),
        "rng": [int(v) for v in np.asarray(jax.random.key_data(st.rng)).reshape(-1)],
        "score": float(st.current_score),
        "reward": float(reward),
        "terminated": bool(terminated), "truncated": bool(truncated),
    }
    if with_display:
        row["display"] = display_bytes(st.display).hex()
    return row


def run(rom_path, env_id, seed, actions, with_display=False, stop_on_end=True):
    env, module, rom_file = build(rom_path, env_id)
    cached = env.cached_reset_state
    state, obs, info = env.reset(jax.random.PRNGKey(seed))
    traj = [snapshot(state, 0, 0.0, False, False, with_display)]
    for a in actions:
        state, obs, reward, terminated, truncated, info = env.step(state, jnp.int32(a))
        traj.append(snapshot(state, state.time, reward, terminated, truncated, with_display))
        if stop_on_end and (bool(terminated) or bool(truncated)):
            break
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=os.environ["CHIP8_OCTAX"],
                            capture_output=True, text=True).stdout.strip()
    constants = {
        "octax_commit": commit,
        "jax": jax.__version__,
        "jax_threefry_partitionable": bool(jax.config.jax_threefry_partitionable),
        "game": env_id, "module": module.__name__, "rom_file": rom_file, "rom_sha1": sha1_file(rom_path),
        "instructions_per_step": int(env.instructions_per_step),
        "frame_skip": int(env.frame_skip),
        "instructions_per_env_step": int(env.instructions_per_step * env.frame_skip),
        "disable_delay": bool(env.disable_delay),
        "timer_rule": "zeroed after the instructions" if env.disable_delay
                      else "max(t - 1, 0) in uint8 once per env step (0 -> 255)",
        "startup_instructions": int(env.startup_instructions),
        "custom_startup": env.custom_startup is not None,
        "action_set": [int(k) for k in np.asarray(env.action_set)],
        "num_actions": int(env.num_actions), "noop_index": int(env.num_actions - 1),
        "max_num_steps_per_episodes": int(env.max_num_steps_per_episodes),
        "startup_rng": [int(v) for v in np.asarray(jax.random.key_data(cached.rng)).reshape(-1)],
        "startup_pc": int(cached.pc),
        "initial_score": float(cached.current_score),
        "key_timing": "keypad[action_set[a]] set before the instructions, cleared after the timers (keypad is all zero in every recorded state)",
        "keypad_clear_in_every_state": all(not any(r["keypad"]) for r in traj),
        "obs": "display after instruction 11, 22, 33, 44 of the step (frame stack of 4)",
    }
    return {"constants": constants, "traj": traj}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("rom_path")
    ap.add_argument("--game", required=True, help="Octax env_id: brix, cavern1, space_flight10, ...")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--actions", default="", help="comma-separated action indices")
    ap.add_argument("--random", type=int, default=0, help="instead of --actions: N uniform random actions from a numpy RandomState(seed)")
    ap.add_argument("--display", action="store_true", help="include the display as hex")
    ap.add_argument("--no-stop", action="store_true", help="keep stepping past terminated/truncated")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.random:
        env, _, _ = build(a.rom_path, a.game)
        acts = [int(x) for x in np.random.RandomState(a.seed).randint(0, env.num_actions, size=a.random)]
    else:
        acts = [int(x) for x in a.actions.split(",") if x != ""]
    out = run(a.rom_path, a.game, a.seed, acts, a.display, not a.no_stop)
    if a.json:
        print(json.dumps(out, sort_keys=True))
    else:
        print(json.dumps(out["constants"], indent=1, sort_keys=True))
        for r in out["traj"]:
            print(r["t"], "pc", hex(r["pc"]), "I", hex(r["I"]), "V", r["V"], "sp", r["sp"], "d/s", r["delay"], r["sound"],
                  "disp", r["display_sha1"][:10], "rng", r["rng"], "score", r["score"], "r", r["reward"], "term", r["terminated"])
