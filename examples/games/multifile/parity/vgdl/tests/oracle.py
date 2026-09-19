#!/usr/bin/env python
"""py-vgdl reference oracle (Colas / infer-vgdl fork): step a game from a spec + level +
seed + action list and dump the per-step state trajectory as JSON.

    VGDL_LAE=<infer-vgdl checkout root> python oracle.py game.txt game_lvl0.txt --seed 42 \
        --actions 1,2,3 --block 50 --json

Actions index get_possible_actions() order: UP DOWN LEFT RIGHT NOOP SPACE.
`--block` is the pygame block size the reference runs at. infer-vgdl runs humans and
agents at 50 (src/utils.py); 1 is its planning-only fast mode, in which every
fractional-speed sprite is frozen.
"""
import os, sys, json
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.environ["VGDL_LAE"])
from src.vgdl import VGDLParser  # noqa: E402


def snapshot(game):
    rows = []
    for s in game.sprite_registry.sprites():
        if getattr(s, "alive", True):
            res = sorted((k, v) for k, v in getattr(s, "resources", {}).items())
            rows.append([s.key, int(s.rect.x), int(s.rect.y), res])
    rows.sort(key=lambda r: json.dumps(r))
    return rows


def run(desc, level, seed, actions, block):
    domain = VGDLParser().parse_game(desc, seed=seed, block_size=block)
    game = domain.build_level(level)
    action_set = list(game.get_possible_actions().values())
    traj = []

    def rec():
        traj.append({"t": int(game.time), "score": float(game.score), "ended": bool(game.ended),
                     "won": bool(game.won), "sprites": snapshot(game)})
    rec()
    for a in actions:
        if game.ended:
            break
        game.tick(action_set[a % len(action_set)])
        rec()
    return traj


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("game_path"); ap.add_argument("level_path")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--actions", default="")
    ap.add_argument("--block", type=int, default=1)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    acts = [int(x) for x in a.actions.split(",") if x != ""]
    traj = run(open(a.game_path).read(), open(a.level_path).read(), a.seed, acts, a.block)
    if a.json:
        print(json.dumps({"traj": traj}, sort_keys=True))
    else:
        f = traj[-1]
        print(f"steps={len(traj)} final t={f['t']} score={f['score']} ended={f['ended']} won={f['won']} sprites={len(f['sprites'])}")
