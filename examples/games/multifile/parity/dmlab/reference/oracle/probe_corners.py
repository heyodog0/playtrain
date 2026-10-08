"""Probe DMLab's wall-corner collision shape (U04).

Runs wall-hugging episodes - always forward, turning in random bursts - and
records every frame's position and velocity with the layout, so that frames
where the player's 16-unit box overlaps a wall cell's corner map out the
shape the engine actually collides with. Output is a scratch file, not a dump.

    bash run.sh probe_corners.py explore_goal_locations_small --seeds 0-31 --frames 900
"""
import argparse
import json
import os

import numpy as np
import deepmind_lab

from dump_level import IMPALA_ACTIONS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--seeds', default='0-31')
    ap.add_argument('--frames', type=int, default=900)
    ap.add_argument('--out', default='/out/probe_corners.json')
    a = ap.parse_args()
    lo, hi = (int(v) for v in a.seeds.split('-'))
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + a.level
    env = deepmind_lab.Lab('playtrain/playtrain_oracle',
                           ['DEBUG.MAZE.LAYOUT', 'DEBUG.POS.TRANS', 'DEBUG.POS.ROT', 'VEL.TRANS'],
                           config={'width': '64', 'height': '64', 'fps': '60'}, renderer='software')
    out = []
    for seed in range(lo, hi + 1):
        rng = np.random.RandomState(1000 + seed)
        env.reset(seed=seed)
        layout = str(env.observations()['DEBUG.MAZE.LAYOUT'])
        rows = []
        act, left = 0, 0
        for f in range(a.frames):
            if left == 0:
                act = int(rng.choice([0, 0, 6, 7]))
                left = int(rng.randint(4, 40))
            left -= 1
            env.step(np.array(IMPALA_ACTIONS[act][1], dtype=np.intc), num_steps=1)
            if not env.is_running():
                break
            o = env.observations()
            rows.append([act] + [float(v) for v in o['DEBUG.POS.TRANS'][:2]]
                        + [float(o['DEBUG.POS.ROT'][1])] + [float(v) for v in o['VEL.TRANS'][:2]])
        out.append({'seed': seed, 'layout': layout, 'rows': rows})
        print('probed', seed, len(rows), flush=True)
    with open(a.out, 'w') as fh:
        json.dump(out, fh)


if __name__ == '__main__':
    main()
