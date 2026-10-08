"""Probe rooms_watermaze's hidden platform (U07): spawn near it (via the
wrapper's PT_SPAWN), walk onto it, record every frame. Scratch output; not a
dump.

    bash run.sh probe_watermaze.py <seed> <spawn x> <spawn y> <yaw> <script> <out name>
script: comma list of action:frames, actions as in dump_level.IMPALA_ACTIONS.
"""
import json
import os
import sys

import numpy as np
import deepmind_lab

from dump_level import IMPALA_ACTIONS

seed, x, y, yaw = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
script = [tuple(int(v) for v in p.split(':')) for p in sys.argv[5].split(',')]
os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.rooms_watermaze'
os.environ['PT_SPAWN'] = '%s %s %s' % (x, y, yaw)
obs = ['DEBUG.POS.TRANS', 'DEBUG.POS.ROT', 'VEL.TRANS', 'PT.ENTITIES']
env = deepmind_lab.Lab('playtrain/playtrain_oracle', obs,
                       config={'width': '64', 'height': '64', 'fps': '60'}, renderer='software')
env.reset(seed=seed)
rows = []
f = 0
for a, n in script:
    for _ in range(n):
        if not env.is_running():
            rows.append([f, 'ended'])
            break
        r = env.step(np.array(IMPALA_ACTIONS[a][1], dtype=np.intc), num_steps=1)
        row = [f, a, float(r)]
        if env.is_running():
            o = env.observations()
            row += [float(v) for v in o['DEBUG.POS.TRANS']] + [float(o['DEBUG.POS.ROT'][1])] + [float(v) for v in o['VEL.TRANS']]
        rows.append(row)
        f += 1
json.dump(rows, open('/out/%s.json' % sys.argv[6], 'w'))
print('probed', len(rows), 'rewards', [(r[0], r[2]) for r in rows if len(r) > 2 and r[2]])
