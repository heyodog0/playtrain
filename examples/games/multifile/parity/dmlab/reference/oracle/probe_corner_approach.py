"""Drive the player straight into one convex wall corner from many starts and
headings (U04), using the wrapper's PT_SPAWN override, and record each run's
positions and velocities. Scratch output; not a dump.

    bash run.sh probe_corner_approach.py explore_goal_locations_small 22 500 800
"""
import json
import math
import os
import sys

import numpy as np
import deepmind_lab

level, seed, cx, cy = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + level
runs = []
# Approach the corner from the south-east (the open side in seed 22), aiming
# at points offset along the diagonal, at headings 105..165 degrees.
for yaw in range(105, 170, 5):
    for off in (-12, -6, 0, 6, 12):
        a = math.radians(yaw)
        tx, ty = cx + 16 + off * 0.7071, cy - 16 + off * 0.7071
        sx, sy = tx - math.cos(a) * 60, ty - math.sin(a) * 60
        os.environ['PT_SPAWN'] = '%.3f %.3f %d' % (sx, sy, yaw)
        env = deepmind_lab.Lab('playtrain/playtrain_oracle', ['DEBUG.POS.TRANS', 'DEBUG.POS.ROT', 'VEL.TRANS'],
                               config={'width': '64', 'height': '64', 'fps': '60'}, renderer='software')
        env.reset(seed=seed)
        o = env.observations()
        rows = [[float(v) for v in o['DEBUG.POS.TRANS'][:2]] + [float(o['DEBUG.POS.ROT'][1])]]
        for f in range(40):
            env.step(np.array([0, 0, 0, 1, 0, 0, 0], dtype=np.intc), num_steps=1)
            o = env.observations()
            rows.append([float(v) for v in o['DEBUG.POS.TRANS'][:2]] + [float(o['DEBUG.POS.ROT'][1])]
                        + [float(v) for v in o['VEL.TRANS'][:2]])
        env.close()
        runs.append({'yaw': yaw, 'off': off, 'spawn': [sx, sy], 'rows': rows})
        print('run', yaw, off, rows[0][:2], rows[-1][:2], flush=True)
json.dump(runs, open('/out/probe_corner_approach.json', 'w'))
