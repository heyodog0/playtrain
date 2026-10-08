"""Dump what the port must reproduce from DMLab, the oracle (PLAN.md G0).

Runs INSIDE the oracle container (see run.sh). For each seed of one level:
layout, variation, entities as spawned, spawn pose, eye height, two scripted
300-frame trajectories (per frame: action, pos, rot, eye, vel, reward, events)
and 8 RGB frames at 64x64 as PNG.

    python3 dump_level.py explore_goal_locations_small --seeds 0-31 --out /out

The two scripts are fixed here and are the G3 inputs:
  'script'  a hand-written sequence exercising acceleration, stopping,
            turning, strafing, backing up and wall contact;
  'impala'  the IMPALA 9-action set, each action held for 4 frames (action
            repeat 4), chosen by a PCG-free xorshift32 seeded with the seed.
"""
import argparse
import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image

import deepmind_lab

# google-deepmind/scalable_agent environments.py DEFAULT_ACTION_SET (Apache-2.0),
# (look_lr, look_du, strafe_lr, move_bf, fire, jump, crouch).
IMPALA_ACTIONS = [
    ('forward', (0, 0, 0, 1, 0, 0, 0)),
    ('backward', (0, 0, 0, -1, 0, 0, 0)),
    ('strafe_left', (0, 0, -1, 0, 0, 0, 0)),
    ('strafe_right', (0, 0, 1, 0, 0, 0, 0)),
    ('look_left', (-20, 0, 0, 0, 0, 0, 0)),
    ('look_right', (20, 0, 0, 0, 0, 0, 0)),
    ('forward_look_left', (-20, 0, 0, 1, 0, 0, 0)),
    ('forward_look_right', (20, 0, 0, 1, 0, 0, 0)),
    ('fire', (0, 0, 0, 0, 1, 0, 0)),
]
REPEAT = 4
FRAMES = 300
FRAME_AT = [0, 37, 74, 111, 148, 185, 222, 259]   # 8 PNGs from the 'script' run

# (action index, frames held); sums to FRAMES.
SCRIPT = [(0, 60), (8, 10), (5, 15), (0, 40), (2, 30), (3, 30), (1, 25),
          (6, 30), (7, 30), (4, 15), (0, 15)]
assert sum(n for _, n in SCRIPT) == FRAMES

# Texture theme per level, read off the level scripts as specification
# (manifest.json reference.read). Explore levels pass no textureSet, so
# common/make_map.lua's default applies.
THEME = {lvl: 'MISHMASH' for lvl in ('rooms_keys_doors_puzzle',)}
THEME['rooms_keys_doors_puzzle'] = 'INVISIBLE_WALLS'   # keys_doors_puzzle_factory.lua
for lvl in ('rooms_collect_good_objects_train', 'rooms_collect_good_objects_test',
            'rooms_select_nonmatching_object', 'rooms_exploit_deferred_effects_train',
            'rooms_exploit_deferred_effects_test'):
    THEME[lvl] = 'MAP'   # prebuilt .map: textures are the brushes' own
THEME.update({lvl: 'MISHMASH' for lvl in ('skymaze_irreversible_path_hard', 'skymaze_irreversible_path_varied')})
THEME['rooms_watermaze'] = 'MAP'
# Tier 2 language levels: generated text maps with their own texture sets
# (PLAN.md section 11); they also carry the instruction (INSTR).
LANGUAGE = ('language_select_described_object', 'language_select_located_object',
            'language_execute_random_task', 'language_answer_quantitative_question')
THEME.update({lvl: 'LANGUAGE' for lvl in LANGUAGE})
THEME.update({lvl: 'MISHMASH' for lvl in (
    'explore_goal_locations_small', 'explore_goal_locations_large',
    'explore_object_locations_small', 'explore_object_locations_large',
    'explore_obstructed_goals_small', 'explore_obstructed_goals_large',
    'explore_object_rewards_few', 'explore_object_rewards_many')})

OBS = ['RGB_INTERLEAVED', 'DEBUG.MAZE.LAYOUT', 'DEBUG.MAZE.VARIATION',
       'DEBUG.POS.TRANS', 'DEBUG.POS.ROT', 'DEBUG.PLAYERS.EYE.POS',
       'VEL.TRANS', 'PT.ENTITIES', 'PT.THEME', 'PT.PICKUPS', 'PT.MAP', 'PT.PLAYER']


def script_actions(kind, seed):
    if kind == 'script':
        out = []
        for a, n in SCRIPT:
            out += [a] * n
        return out
    x = (seed * 2654435761 + 1) & 0xFFFFFFFF or 1
    out = []
    while len(out) < FRAMES:
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        out += [x % len(IMPALA_ACTIONS)] * REPEAT
    return out[:FRAMES]


def png_b64(rgb):
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format='PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def vec(o, k):
    return [float(v) for v in np.asarray(o[k]).reshape(-1)]


def run(env, seed, kind, frames_out):
    env.reset(seed=seed)
    o = env.observations()
    start = {
        'layout': str(o['DEBUG.MAZE.LAYOUT']),
        'variation': str(o['DEBUG.MAZE.VARIATION']),
        'entities': str(o['PT.ENTITIES']),
        'theme': str(o['PT.THEME']),
        'pickups': str(o['PT.PICKUPS']),
        'map': str(o['PT.MAP']),
        'player': str(o['PT.PLAYER']),
        'pos': vec(o, 'DEBUG.POS.TRANS'),
        'rot': vec(o, 'DEBUG.POS.ROT'),
        'eye': vec(o, 'DEBUG.PLAYERS.EYE.POS'),
    }
    if 'INSTR' in o:
        start['instr'] = str(o['INSTR'])
    if 'PT.FLOORS' in o:
        start['floors'] = str(o['PT.FLOORS'])
    # language rounds can switch maps: their layout, theme, map log, floors
    watch = {'layout': 'DEBUG.MAZE.LAYOUT', 'variation': 'DEBUG.MAZE.VARIATION', 'theme': 'PT.THEME',
             'map': 'PT.MAP', 'floors': 'PT.FLOORS'} if 'INSTR' in o else {}
    last_w = {k: str(o[v]) for k, v in watch.items()}
    last_instr = start.get('instr')
    last_pick = start['pickups']
    acts = script_actions(kind, seed)
    traj = []
    last_ent = start['entities']
    for f, a in enumerate(acts):
        if frames_out is not None and f in FRAME_AT:
            frames_out.append({'frame': f, 'pos': vec(o, 'DEBUG.POS.TRANS'),
                               'rot': vec(o, 'DEBUG.POS.ROT'),
                               'eye': vec(o, 'DEBUG.PLAYERS.EYE.POS'),
                               'png': png_b64(o['RGB_INTERLEAVED'])})
        if not env.is_running():
            traj.append({'f': f, 'a': a, 'ended': True})
            break
        r = env.step(np.array(IMPALA_ACTIONS[a][1], dtype=np.intc), num_steps=1)
        ev = [e[0] for e in env.events()]
        rec = {'f': f, 'a': a, 'r': float(r)}
        if env.is_running():
            o = env.observations()
            rec.update(pos=vec(o, 'DEBUG.POS.TRANS'), rot=vec(o, 'DEBUG.POS.ROT'),
                       eye=vec(o, 'DEBUG.PLAYERS.EYE.POS'), vel=vec(o, 'VEL.TRANS'),
                       )
            ent = str(o['PT.ENTITIES'])
            if ent != last_ent:
                rec['entities'] = ent
                last_ent = ent
            if 'INSTR' in o and str(o['INSTR']) != last_instr:
                rec['instr'] = last_instr = str(o['INSTR'])
            # pickups created after the start (language levels make new
            # objects every round): the log only grows, record it on change
            if str(o['PT.PICKUPS']) != last_pick:
                rec['pickups'] = last_pick = str(o['PT.PICKUPS'])
            for k, v in watch.items():
                if str(o[v]) != last_w[k]:
                    rec[k] = last_w[k] = str(o[v])
        if ev:
            rec['events'] = ev
        traj.append(rec)
    return start, traj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--seeds', default='0-31')
    ap.add_argument('--out', default='/out')
    args = ap.parse_args()
    lo, hi = (int(v) for v in args.seeds.split('-'))
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + args.level
    config = {'width': '64', 'height': '64', 'fps': '60'}
    if args.level.endswith('_test'):
        # DMLab-30 hold-out levels refuse to start without this (decorators/test_only.lua).
        config['allowHoldOutLevels'] = 'true'
    obs = OBS + (['INSTR', 'PT.FLOORS'] if args.level in LANGUAGE else [])
    env = deepmind_lab.Lab('playtrain/playtrain_oracle', obs, config=config, renderer='software')
    odir = os.path.join(args.out, args.level)
    os.makedirs(odir, exist_ok=True)
    for seed in range(lo, hi + 1):
        frames = []
        start, script = run(env, seed, 'script', frames)
        start2, impala = run(env, seed, 'impala', None)
        assert start2['layout'] == start['layout'], 'layout not a function of seed'
        assert start2['pos'] == start['pos'], 'spawn not a function of seed'
        dump = {'level': args.level, 'seed': seed, 'fps': 60, 'width': 64,
                'height': 64, 'action_set': IMPALA_ACTIONS, 'repeat': REPEAT,
                'theme': THEME.get(args.level), 'start': start,
                'trajectories': {'script': script, 'impala': impala},
                'frames': frames}
        with open(os.path.join(odir, '%d.json' % seed), 'w') as f:
            json.dump(dump, f, separators=(',', ':'))
        print('dumped', args.level, seed, 'frames', len(script), len(impala),
              'reward', sum(t.get('r', 0) for t in script), flush=True)
    env.close()


if __name__ == '__main__':
    sys.exit(main())
