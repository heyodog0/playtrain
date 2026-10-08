"""Probe DMLab's spawn effect and HUD (V1).

Resets and stands still (no-op) for --frames engine frames, recording every
RGB frame. With the scene static, each frame minus the last one isolates the
spawn effect (its shape and how long it fades over), and the last frame shows
the HUD over a still scene. Output is a scratch file, not a dump.

    bash run.sh probe_spawn.py explore_goal_locations_small --seeds 0-3 --frames 60 \
        --out /out/probe_spawn_explore.json
"""
import argparse
import base64
import json
import os

import numpy as np
import deepmind_lab


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--seeds', default='0-3')
    ap.add_argument('--frames', type=int, default=60)
    ap.add_argument('--out', default='/out/probe_spawn.json')
    a = ap.parse_args()
    lo, hi = (int(v) for v in a.seeds.split('-'))
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + a.level
    config = {'width': '64', 'height': '64', 'fps': '60'}
    if a.level.endswith('_test'):
        config['allowHoldOutLevels'] = 'true'
    env = deepmind_lab.Lab('playtrain/playtrain_oracle', ['RGB_INTERLEAVED'], config=config, renderer='software')
    noop = np.zeros(7, dtype=np.intc)
    out = []
    for seed in range(lo, hi + 1):
        env.reset(seed=seed)
        frames = [np.asarray(env.observations()['RGB_INTERLEAVED'], np.uint8)]
        for _ in range(a.frames - 1):
            env.step(noop, num_steps=1)
            if not env.is_running():
                break
            frames.append(np.asarray(env.observations()['RGB_INTERLEAVED'], np.uint8))
        out.append({'seed': seed, 'rgb': base64.b64encode(np.stack(frames).tobytes()).decode()})
        print('probed', seed, len(frames), flush=True)
    with open(a.out, 'w') as fh:
        json.dump(out, fh)


if __name__ == '__main__':
    main()
