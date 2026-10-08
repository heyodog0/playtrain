"""T7b: capture the psychlab room around its fixed eye, for the port's panorama.

    bash reference/oracle/run.sh probe_panorama.py psychlab_visual_search

The psychlab player never moves, so everything static it sees (the stadium of
the skybox, the screen's bezel and stand: big_screen.map and its md3 models,
//assets, CC BY 4.0) is a function of the view direction alone. This turns the
view to a grid of (yaw, pitch) with single look actions of any pixel count,
reads the angles DMLab actually reached, and saves a 256 px frame of each
(90 degree FOV). tools/psych_panorama.py reprojects them into a cube map. The
screen's own content shows in the frames too; the port draws the screen over
it.

Writes /out/<level>/panorama.json: {size, fov, views: [{target, rot, eye, png}]}; it is kept as
reference/panorama/<level>.json (out of the dumps, which hold seeds only).
"""
import argparse
import json
import os

import numpy as np

import deepmind_lab
from dump_level import png_b64, vec

LOOK = 0.10560          # degrees per look pixel (compile_level.py)
SIZE = 256
YAWS = list(range(0, 360, 30))
PITCHES = [-80, -60, -30, 0, 30, 60, 80]
OBS = ['RGB_INTERLEAVED', 'DEBUG.POS.ROT', 'DEBUG.PLAYERS.EYE.POS']


def turn(env, target):
    """Look toward (pitch, yaw) until within a degree, one action a frame."""
    o = env.observations()
    for _ in range(40):
        rot = vec(o, 'DEBUG.POS.ROT')
        dp = target[0] - rot[0]
        dy = (target[1] - rot[1] + 180.0) % 360.0 - 180.0
        if abs(dp) < 1.0 and abs(dy) < 1.0:
            break
        # look_lr: + turns right (yaw down); look_du: + looks down (pitch up)
        a = np.array([int(round(-dy / LOOK)), int(round(dp / LOOK)), 0, 0, 0, 0, 0], dtype=np.intc)
        env.step(a, num_steps=1)
        o = env.observations()
    # hold still a frame so the view is settled
    env.step(np.zeros(7, dtype=np.intc), num_steps=1)
    return env.observations()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--out', default='/out')
    args = ap.parse_args()
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + args.level
    env = deepmind_lab.Lab('playtrain/playtrain_oracle', OBS,
                           config={'width': str(SIZE), 'height': str(SIZE), 'fps': '60'}, renderer='software')
    env.reset(seed=0)
    views = []
    for p in PITCHES:
        for y in YAWS:
            o = turn(env, (p, y))
            rot = vec(o, 'DEBUG.POS.ROT')
            views.append({'target': [p, y], 'rot': rot, 'eye': vec(o, 'DEBUG.PLAYERS.EYE.POS'),
                          'png': png_b64(o['RGB_INTERLEAVED'])})
            print('view', p, y, '->', [round(v, 3) for v in rot], flush=True)
    odir = os.path.join(args.out, args.level)
    os.makedirs(odir, exist_ok=True)
    with open(os.path.join(odir, 'panorama.json'), 'w') as f:
        json.dump({'level': args.level, 'size': SIZE, 'fov': 90, 'views': views}, f, separators=(',', ':'))
    env.close()


if __name__ == '__main__':
    main()
