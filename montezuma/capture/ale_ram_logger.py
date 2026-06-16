#!/usr/bin/env python3
"""
ALE RAM logger for Montezuma's Revenge — ground-truth capture for the gym-gen port.

Why ALE and not Stella/BizHawk: gym-gen is already a Gymnasium project and the
catalog references ale.farama.org, so ALE is the closest-to-source, easiest path
to per-frame RAM + pixel capture. (BizHawk Lua and Stella are alternatives — see
capture/README.md — but this is the recommended logger.)

What it does, per frame:
  - reads the full 128-byte RAM (ale.getRAM())
  - extracts the labeled fields from ram_map.json (room, x, y, lives, ...)
  - records the ALE action that produced the frame and the per-frame delta (dx, dy)
  - optionally dumps the native RGB frame as PNG (for room backgrounds + sprite sheets)
writing one CSV row per frame to data/.

Two capture modes:
  --script FILE   deterministic action script -> MOVEMENT TABLES (walk speed, jump arc)
  --random N      N random-action frames     -> exercises rooms/enemies for RAM diffing
  --calibrate     hold against walls and print suggested RAM->pixel scale/offset

Install (one-time, not yet in gym-gen deps):
  uv pip install "ale-py>=0.10" "gymnasium>=1.1" pillow
  # ROM ships with ale-py; if missing: `ale-import-roms` or `AutoROM --accept-license`

Usage:
  python ale_ram_logger.py --random 600 --frames        # explore + dump PNGs
  python ale_ram_logger.py --script walk_right.txt       # movement table
  python ale_ram_logger.py --calibrate

Action-script file format (one step per line; '#' comments ok):
  ACTION REPEAT       e.g.  `RIGHT 30`  or  `4 30`  (name or ALE id), repeat optional (=1)
"""
import argparse
import csv
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
RAM_MAP = json.loads((HERE / "ram_map.json").read_text())

FIELDS = RAM_MAP["fields"]
ACTION_IDS = RAM_MAP["ale_action_ids"]
# raw RAM bytes to always dump (helps later when you need to find a new address)
RAW_DUMP = list(range(0, 128))


def make_env(render_frames: bool):
    try:
        import gymnasium as gym
        import ale_py  # noqa: F401  (registers ALE envs)
    except ImportError as e:
        sys.exit(f"Missing dep: {e}. Run:  uv pip install 'ale-py>=0.10' 'gymnasium>=1.1' pillow")
    gym.register_envs(__import__("ale_py"))
    # full_action_space=True -> Discrete(18), so action ids match ram_map.json
    env = gym.make(
        "ALE/MontezumaRevenge-v5",
        frameskip=1,                      # 1 = every frame, required for true movement tables
        repeat_action_probability=0.0,    # disable sticky actions -> determinism
        full_action_space=True,
        render_mode="rgb_array" if render_frames else None,
    )
    return env


def ale_of(env):
    """Reach the underlying ALE interface through the wrapper stack."""
    e = env.unwrapped
    return e.ale  # ale_py exposes .ale with getRAM()/getScreenRGB()


def resolve_action(tok: str) -> int:
    tok = tok.strip().upper()
    if tok in ACTION_IDS:
        return ACTION_IDS[tok]
    return int(tok)


def load_script(path: str):
    steps = []
    for raw in Path(path).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        action = resolve_action(parts[0])
        repeat = int(parts[1]) if len(parts) > 1 else 1
        steps.extend([action] * repeat)
    return steps


def extract(ram):
    out = {}
    for name, spec in FIELDS.items():
        addr = spec.get("addr")
        out[name] = int(ram[addr]) if addr is not None and addr < len(ram) else ""
    return out


def run(actions, label, dump_frames):
    DATA.mkdir(exist_ok=True)
    env = make_env(render_frames=dump_frames)
    ale = ale_of(env)
    env.reset(seed=0)

    csv_path = DATA / f"ram_{label}.csv"
    frames_dir = DATA / f"frames_{label}"
    if dump_frames:
        frames_dir.mkdir(exist_ok=True)
        from PIL import Image

    cols = ["frame", "action"] + list(FIELDS.keys()) + ["dx", "dy"] + [f"r{a}" for a in RAW_DUMP]
    prev = None
    with open(csv_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for i, a in enumerate(actions):
            env.step(a)
            ram = ale.getRAM()
            fields = extract(ram)
            dx = (fields["x"] - prev["x"]) if prev and fields["x"] != "" else ""
            dy = (fields["y"] - prev["y"]) if prev and fields["y"] != "" else ""
            prev = fields
            w.writerow([i, a] + [fields[k] for k in FIELDS] + [dx, dy] + [int(b) for b in ram])
            if dump_frames and i % 4 == 0:  # every 4th frame keeps it light
                Image.fromarray(ale.getScreenRGB()).save(frames_dir / f"{i:05d}.png")
    env.close()
    print(f"wrote {csv_path}  ({len(actions)} frames)")
    if dump_frames:
        print(f"wrote frames -> {frames_dir}")
    return csv_path


def calibrate():
    """Pin Joe against left then right wall to derive RAM->pixel x mapping."""
    env = make_env(render_frames=False)
    ale = ale_of(env)
    env.reset(seed=0)
    LEFT, RIGHT = ACTION_IDS["LEFT"], ACTION_IDS["RIGHT"]
    for _ in range(80):
        env.step(LEFT)
    xmin = int(ale.getRAM()[FIELDS["x"]["addr"]])
    for _ in range(160):
        env.step(RIGHT)
    xmax = int(ale.getRAM()[FIELDS["x"]["addr"]])
    env.close()
    print(f"x RAM range observed: min={xmin} max={xmax}")
    print("Next: read the on-screen pixel x at those two stops from a dumped frame,")
    print("then scale = (px_max-px_min)/(xmax-xmin), offset = px_min - scale*xmin.")
    print("Record both in ram_map.json -> calibration.x")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--script", metavar="FILE", help="deterministic action script -> movement table")
    g.add_argument("--random", type=int, metavar="N", help="N random-action frames")
    g.add_argument("--calibrate", action="store_true", help="derive RAM->pixel mapping")
    ap.add_argument("--frames", action="store_true", help="also dump native RGB frames as PNG")
    ap.add_argument("--label", help="output label (default derived from mode)")
    args = ap.parse_args()

    if args.calibrate:
        return calibrate()

    if args.script:
        actions = load_script(args.script)
        label = args.label or Path(args.script).stem
    else:
        import random
        random.seed(0)  # reproducible "random" exploration
        n_actions = len([k for k in ACTION_IDS if not k.startswith("_")])
        actions = [random.randrange(n_actions) for _ in range(args.random)]
        label = args.label or f"random{args.random}"

    run(actions, label, args.frames)


if __name__ == "__main__":
    main()
