"""DMLab native steps/s inside the oracle container (PLAN.md G7 baseline).

One env, one thread, RGB_INTERLEAVED at 64x64, software renderer, the IMPALA
action set with action repeat 4 (one agent step = 4 engine frames), uniform
random actions from a fixed xorshift stream. Prints one JSON line.

    bash run.sh bench_oracle.py explore_goal_locations_small --steps 2000
"""
import argparse
import json
import platform
import time

import numpy as np
import deepmind_lab

from dump_level import IMPALA_ACTIONS, REPEAT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--steps', type=int, default=2000)
    ap.add_argument('--warmup', type=int, default=100)
    args = ap.parse_args()
    config = {'width': '64', 'height': '64', 'fps': '60'}
    if args.level.endswith('_test'):
        config['allowHoldOutLevels'] = 'true'   # decorators/test_only.lua
    env = deepmind_lab.Lab('contributed/dmlab30/' + args.level, ['RGB_INTERLEAVED'],
                           config=config,
                           renderer='software')
    acts = [np.array(a, dtype=np.intc) for _, a in IMPALA_ACTIONS]
    env.reset(seed=0)
    x = 12345
    def step():
        nonlocal x
        x ^= (x << 13) & 0xFFFFFFFF; x ^= x >> 17; x ^= (x << 5) & 0xFFFFFFFF
        env.step(acts[x % len(acts)], num_steps=REPEAT)
        if not env.is_running():
            env.reset()
        env.observations()['RGB_INTERLEAVED']
    for _ in range(args.warmup):
        step()
    t = time.perf_counter()
    for _ in range(args.steps):
        step()
    dt = time.perf_counter() - t
    print(json.dumps({'level': args.level, 'steps': args.steps, 'seconds': round(dt, 3),
                      'steps_per_s': round(args.steps / dt, 1),
                      'frames_per_s': round(args.steps * REPEAT / dt, 1),
                      'machine': platform.machine(), 'note': 'linux/amd64 image; on an arm64 Mac this runs under emulation'}))


if __name__ == '__main__':
    main()
