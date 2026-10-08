"""P0 (PLAN.md section 12): pitch in DMLab, for human look up and down.

    bash reference/oracle/run.sh probe_pitch.py explore_goal_locations_small

1. The walk: replay seed 0's script trajectory twice, once as dumped and once
   with a look up/down oscillation added to every action (pitch swinging
   within +-40 degrees; yaw, strafe and move untouched), and report the largest
   position difference. Quake walks along the yaw alone, so it should be 0.
2. Pitched frames: for seeds 0 and 1, at dumped frames, replay the script to
   the frame, then one frame of a pure look up/down action to each target
   pitch, and keep the frame with the pose DMLab reports (the player may drift
   a little during that frame; the port renders the reported pose).

Writes /out/_pitch/<level>.json: {walk: {...}, frames: [{seed, f, target,
pos, rot, png}]}; kept as reference/pitch/<level>.json. --pitched-first runs the
walk check alone, as the process's first run (only that is comparable with the
dump: a run's frame timing depends on the runs before it in the process).
"""
import argparse
import json
import os

import numpy as np

import deepmind_lab
from dump_level import png_b64, vec

LOOK = 0.10560
PITCHES = [-60, -30, 0, 30, 60]
AT = [37, 111, 185, 259]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--out', default='/out')
    ap.add_argument('--walk-only', action='store_true')
    ap.add_argument('--pitched-first', action='store_true')
    a = ap.parse_args()
    d0 = json.load(open(os.path.join(a.out, a.level, '0.json')))
    aset = [np.array(x[1], dtype=np.intc) for x in d0['action_set']]
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + a.level
    config = {'width': '64', 'height': '64', 'fps': '60'}
    if a.level.endswith('_test'):
        config['allowHoldOutLevels'] = 'true'
    env = deepmind_lab.Lab('playtrain/playtrain_oracle', ['RGB_INTERLEAVED', 'DEBUG.POS.TRANS', 'DEBUG.POS.ROT'],
                           config=config, renderer='software')

    def run(seed, extra_pitch):
        d = json.load(open(os.path.join(a.out, a.level, '%d.json' % seed)))
        env.reset(seed=seed)
        out = []
        for i, r in enumerate(d['trajectories']['script']):
            if 'a' not in r or not env.is_running():
                break
            act = aset[r['a']].copy()
            if extra_pitch:
                # 14 frames down, 28 up, 14 down: pitch swings 0 -> +30 -> -30 -> 0
                act[1] += 20 if (i % 56) < 14 or (i % 56) >= 42 else -20
            env.step(act, num_steps=1)
            if env.is_running():
                o = env.observations()
                out.append((vec(o, 'DEBUG.POS.TRANS'), vec(o, 'DEBUG.POS.ROT')))
        return out

    # 1. the walk: against the dump, against a second plain run (DMLab's frame
    # timing is not a function of the actions), and with pitch added
    dump = [(r['pos'], r['rot']) for r in d0['trajectories']['script'] if 'pos' in r]
    def diff(x, y):
        n = min(len(x), len(y))
        return round(max(max(abs(p[0][k] - q[0][k]) for k in range(3)) for p, q in zip(x[:n], y[:n])), 4)
    if a.pitched_first:
        # a run's timing depends on what ran before it in the process: only a
        # process's first run is comparable with the dump
        pitched = run(0, True)
        walk = {'pitched_first_vs_dump': diff(pitched, dump), 'max_pitch': max(abs(q[1][0]) for q in pitched)}
        print('walk', walk, flush=True)
        return
    plain, plain2, pitched = run(0, False), run(0, False), run(0, True)
    walk = {'plain_vs_dump': diff(plain, dump), 'plain_vs_plain': diff(plain, plain2),
            'pitched_vs_plain': diff(pitched, plain), 'max_pitch': max(abs(q[1][0]) for q in pitched)}
    print('walk', walk, flush=True)
    if a.walk_only:
        return

    # 2. pitched frames at dumped poses
    frames = []
    for seed in (0, 1):
        d = json.load(open(os.path.join(a.out, a.level, '%d.json' % seed)))
        acts = [r['a'] for r in d['trajectories']['script'] if 'a' in r]
        for f in AT:
            if f >= len(acts):
                continue
            for target in PITCHES:
                env.reset(seed=seed)
                for i in range(f):
                    if not env.is_running():
                        break
                    env.step(aset[acts[i]], num_steps=1)
                if not env.is_running():
                    continue
                look = np.zeros(7, dtype=np.intc)
                look[1] = int(round(target / LOOK))
                env.step(look, num_steps=1)
                if not env.is_running():
                    continue
                o = env.observations()
                frames.append({'seed': seed, 'f': f, 'target': target, 'pos': vec(o, 'DEBUG.POS.TRANS'),
                               'rot': vec(o, 'DEBUG.POS.ROT'), 'png': png_b64(o['RGB_INTERLEAVED'])})
    odir = os.path.join(a.out, '_pitch')
    os.makedirs(odir, exist_ok=True)
    with open(os.path.join(odir, a.level + '.json'), 'w') as fh:
        json.dump({'level': a.level, 'walk': walk, 'frames': frames}, fh, separators=(',', ':'))
    print('pitched frames', len(frames), flush=True)
    env.close()


if __name__ == '__main__':
    main()
