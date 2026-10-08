"""Dump a psychlab level (tier 2, PLAN.md section 11) from the oracle.

    bash run.sh dump_psychlab.py psychlab_visual_search --seeds 0-31

Psychlab is answered by gaze, so a fixed action script would never finish a
trial. This drives the agent with a closed-loop gaze controller: it reads where
the view ray meets the screen (PT.GAZE) and the screen's widgets (PT.WIDGETS,
both from reference/oracle/levels/playtrain_oracle.lua) and steers, one look
action per frame, to:

  * the fixation cross when it is up;
  * one of the response buttons once a trial asks for one (chosen by this
    script's own xorshift from the seed), holding on it HOLD frames and then
    looking back at the centre, since psychlab answers on hover END;
  * sequential_comparison's end-study button, the same way.

Actions are the 11 of PSYCH_ACTIONS: IMPALA's 9 plus look up and look down,
since with IMPALA's alone the buttons are out of reach (PROGRESS.md, T1b).
Each dump holds the start state, the per-frame trajectory (action, reward,
gaze, rot, and the widgets whenever they change), every distinct screen the
level showed (PNG, box-filtered to SCREEN_PX, keyed by the sha1 of the full
screen) and 8 RGB frames at FRAME_AT for G6.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image

import deepmind_lab
from dump_level import IMPALA_ACTIONS, FRAME_AT, png_b64, vec

PSYCH_ACTIONS = IMPALA_ACTIONS + [
    ('look_up', (0, -20, 0, 0, 0, 0, 0)),
    ('look_down', (0, 20, 0, 0, 0, 0, 0)),
]
LOOK_LEFT, LOOK_RIGHT, LOOK_UP, LOOK_DOWN, NOOP_LIKE = 4, 5, 9, 10, 8
FRAMES = 3000
HOLD = 3          # frames on a button before leaving it
SCREEN_PX = 128
SCREEN_YAW = 90.0  # the screen is straight ahead at yaw 90 (factory spawn angle)

OBS = ['RGB_INTERLEAVED', 'DEBUG.POS.TRANS', 'DEBUG.POS.ROT', 'DEBUG.PLAYERS.EYE.POS',
       'PT.GAZE', 'PT.WIDGETS', 'PT.SCREEN', 'PT.ENTITIES', 'PT.MAP', 'PT.PLAYER']


def xorshift(seed):
    x = (seed * 2654435761 + 7) & 0xFFFFFFFF or 1
    while True:
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        yield x


def widgets_of(text, w, h):
    out = {}
    for ln in str(text).split('\n'):
        p = ln.split()
        if len(p) == 5:
            x0, y0, x1, y1 = (float(v) for v in p[1:])
            out[p[0]] = ((x0 + x1) / 2 / w, (y0 + y1) / 2 / h, x0 / w, y0 / h, x1 / w, y1 / h)
    return out


class Controller:
    """Picks one action per frame to move the gaze toward a target."""

    def __init__(self, seed):
        self.rng = xorshift(seed)
        self.choice = None      # the button this trial answers with
        self.held = 0
        self.leaving = 0

    def pick(self, names):
        if self.choice is None or self.choice not in names:
            self.choice = names[next(self.rng) % len(names)]
        return self.choice

    def target(self, wid):
        if 'fixation' in wid:
            self.choice = None
            return wid['fixation'][:2], None
        if self.leaving > 0:
            self.leaving -= 1
            return (0.5, 0.25), None
        if 'endStudyPhaseButton' in wid:
            return wid['endStudyPhaseButton'][:2], 'endStudyPhaseButton'
        for pair in (('targetAbsent', 'targetPresent'), ('newButton', 'oldButton')):
            names = [n for n in pair if n in wid]
            if names:
                n = self.pick(names)
                return wid[n][:2], n
        return (0.5, 0.5), None

    def act(self, gaze, rot, wid):
        looking, gx, gy = gaze
        if not looking:
            # find the screen: turn toward its yaw, level the pitch
            dyaw = (SCREEN_YAW - rot[1] + 180.0) % 360.0 - 180.0
            if abs(rot[0]) > 4.0:
                return LOOK_UP if rot[0] > 0 else LOOK_DOWN
            return LOOK_LEFT if dyaw > 0 else LOOK_RIGHT
        (tx, ty), name = self.target(wid)
        if name is not None:
            x0, y0, x1, y1 = wid[name][2:]
            inside = x0 < gx < x1 and y0 < gy < y1
            if inside:
                self.held += 1
                if self.held >= HOLD:
                    self.held = 0
                    self.leaving = 12
                return NOOP_LIKE
            self.held = 0
        dx, dy = tx - gx, ty - gy
        if abs(dx) < 0.01 and abs(dy) < 0.01:
            return NOOP_LIKE
        if abs(dx) >= abs(dy):
            return LOOK_RIGHT if dx > 0 else LOOK_LEFT
        return LOOK_DOWN if dy > 0 else LOOK_UP


def gaze_of(o):
    p = str(o['PT.GAZE']).split()
    return int(p[0]), float(p[1]), float(p[2])


def run(env, seed):
    env.reset(seed=seed)
    o = env.observations()
    scr = np.asarray(o['PT.SCREEN'])
    h, w = scr.shape[:2]
    start = {'pos': vec(o, 'DEBUG.POS.TRANS'), 'rot': vec(o, 'DEBUG.POS.ROT'),
             'eye': vec(o, 'DEBUG.PLAYERS.EYE.POS'), 'entities': str(o['PT.ENTITIES']),
             'map': str(o['PT.MAP']), 'player': str(o['PT.PLAYER']), 'screen_size': [w, h]}
    screens, frames, traj = {}, [], []

    def keep_screen(s):
        key = hashlib.sha1(np.ascontiguousarray(s).tobytes()).hexdigest()[:16]
        if key not in screens:
            small = Image.fromarray(np.ascontiguousarray(s[..., :3])).resize((SCREEN_PX, SCREEN_PX), Image.BOX)
            buf = io.BytesIO()
            small.save(buf, format='PNG', optimize=True)
            screens[key] = base64.b64encode(buf.getvalue()).decode()
        return key

    ctl = Controller(seed)
    last_w, last_s = None, keep_screen(scr)
    start['screen'] = last_s
    for f in range(FRAMES):
        if f in FRAME_AT:
            frames.append({'frame': f, 'pos': vec(o, 'DEBUG.POS.TRANS'), 'rot': vec(o, 'DEBUG.POS.ROT'),
                           'eye': vec(o, 'DEBUG.PLAYERS.EYE.POS'), 'screen': last_s,
                           'png': png_b64(o['RGB_INTERLEAVED'])})
        if not env.is_running():
            traj.append({'f': f, 'ended': True})
            break
        wid = widgets_of(o['PT.WIDGETS'], w, h)
        a = ctl.act(gaze_of(o), vec(o, 'DEBUG.POS.ROT'), wid)
        r = env.step(np.array(PSYCH_ACTIONS[a][1], dtype=np.intc), num_steps=1)
        rec = {'f': f, 'a': a, 'r': float(r)}
        if env.is_running():
            o = env.observations()
            g = gaze_of(o)
            rec.update(rot=vec(o, 'DEBUG.POS.ROT'), gaze=[g[0], round(g[1], 6), round(g[2], 6)])
            ws = str(o['PT.WIDGETS'])
            if ws != last_w:
                rec['widgets'] = last_w = ws
            s = keep_screen(np.asarray(o['PT.SCREEN']))
            if s != last_s:
                rec['screen'] = last_s = s
        traj.append(rec)
    return start, traj, frames, screens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--seeds', default='0-31')
    ap.add_argument('--out', default='/out')
    args = ap.parse_args()
    lo, hi = (int(v) for v in args.seeds.split('-'))
    os.environ['PT_LEVEL'] = 'levels.contributed.dmlab30.' + args.level
    env = deepmind_lab.Lab('playtrain/playtrain_oracle', OBS,
                           config={'width': '64', 'height': '64', 'fps': '60'}, renderer='software')
    odir = os.path.join(args.out, args.level)
    os.makedirs(odir, exist_ok=True)
    for seed in range(lo, hi + 1):
        start, traj, frames, screens = run(env, seed)
        dump = {'level': args.level, 'seed': seed, 'fps': 60, 'width': 64, 'height': 64,
                'action_set': PSYCH_ACTIONS, 'repeat': 1, 'theme': 'MAP', 'start': start,
                'trajectories': {'gaze': traj}, 'frames': frames, 'screens': screens}
        with open(os.path.join(odir, '%d.json' % seed), 'w') as f:
            json.dump(dump, f, separators=(',', ':'))
        rew = sum(t.get('r', 0) for t in traj)
        trials = sum(1 for t in traj if 'widgets' in t and 'fixation' in t['widgets'])
        print('dumped', args.level, seed, 'frames', len(traj), 'reward', rew, 'trials', trials,
              'screens', len(screens), flush=True)
    env.close()


if __name__ == '__main__':
    sys.exit(main())
