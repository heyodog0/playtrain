#!/usr/bin/env python2
"""RC_RL (tomov/RC_RL @ fmri) reference oracle. Python 2. Runs inside the `rcrl-oracle`
container with the RC_RL checkout mounted at /work (see tests/gate_oracle_rcrl.mjs).

Reproduces exactly what VGDLEnv (RC_RL's DDQN wrapper) does: build the RLE, visualize=True
(kills flush at the start of each action), softReset (one action-less step), then one
rle.step per action with actions [0, K_RIGHT, K_LEFT, K_UP, K_DOWN, K_SPACE]. The module-level
RNG RC_RL uses is unseeded; the oracle seeds it right before softReset.

    python oracle_rcrl.py game.txt game_lvl0.txt --seed 42 --actions 1,2,3 --json
"""
import os, sys, json, random
os.environ.setdefault("SDL_VIDEODRIVER", "dummy"); os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, "/work"); sys.path.insert(0, "/work/vgdl")
import pygame
from pygame.locals import K_RIGHT, K_LEFT, K_UP, K_DOWN, K_SPACE
from vgdl.rlenvironmentnonstatic import createRLInputGameFromStrings

ACTIONS = [0, K_RIGHT, K_LEFT, K_UP, K_DOWN, K_SPACE]


def snapshot(game):
    rows = []
    kl = set(game.kill_list)
    for key in game.sprite_order:
        for s in game.sprite_groups.get(key, []):
            if s in kl:
                continue
            res = sorted((k, v) for k, v in s.resources.items())
            rows.append([s.name, int(s.rect.left), int(s.rect.top), res])
    rows.sort(key=lambda r: json.dumps(r))
    return rows


def run(desc, level, seed, actions):
    rle = createRLInputGameFromStrings(desc, level)
    rle.visualize = True
    random.seed(seed)
    rle.softReset()
    g = rle._game
    traj = []
    groups = list(g.sprite_groups.keys())   # py2 dict order: abstract groups are assembled in it

    def rec(ended, won):
        traj.append({"t": int(g.time), "score": float(g.score), "ended": bool(ended), "won": bool(won),
                     "sprites": snapshot(g)})
    rec(False, False)
    for a in actions:
        r = rle.step(ACTIONS[a % len(ACTIONS)])
        rec(r["ended"], r["win"])
        if r["ended"]:
            break
    return traj, groups


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("game_path"); ap.add_argument("level_path")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--actions", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    acts = [int(x) for x in a.actions.split(",") if x != ""]
    traj, groups = run(open(a.game_path).read(), open(a.level_path).read(), a.seed, acts)
    if a.json:
        print(json.dumps({"traj": traj, "groups": groups}, sort_keys=True))
    else:
        f = traj[-1]
        print("steps=%d final t=%d score=%s ended=%s won=%s sprites=%d" % (len(traj), f["t"], f["score"], f["ended"], f["won"], len(f["sprites"])))
