"""T7: compile a psychlab level (PLAN.md section 11) from its oracle dumps.

    uv run --no-sync python tools/compile_psychlab.py psychlab_visual_search [--check]

Psychlab's player never moves (the factory zeroes the walk); the agent only
looks, and answers with where it looks on a screen. What the port needs:

  * the room: the eye (DEBUG.PLAYERS.EYE.POS, fixed) and the screen, the
    trigger_lookat patch of big_screen.map (//assets/maps/src, CC BY 4.0): the
    plane y = 58, x -56..56, z 67..179, texture u along +x, v down from z 179;
  * the gaze: DMLab's lookat (measured, PROGRESS.md T8) is a trace from Quake's
    muzzle point, the eye (the snapped origin z 96 + view height 26) plus 14
    along the view, truncated to whole units; it stops 0.125 short of the
    patch (y 57.875) and is normalised over the trigger's bounds, one unit
    wider than the patch on every side (x -57..57, z 66..180);
  * per corpus seed, the spawn yaw (DMLab draws it, 90 +- 45);
  * G3 replay inputs: the quantisation phase of the yaw and the pitch view
    accumulators (as tools/compile_level.py's yaw_phase: Quake keeps the view
    in 1/65536 turns, the look actions add 20 px x LOOK degrees a frame);
  * visual_search: each trial's objects, which DMLab's Lua RNG drew, read
    off the screen the trial showed (the dump keeps every distinct screen as a
    128 px PNG; a 4 x 4 mask cell is 14 screen px, 3.5 PNG px, so the PNG
    pixel at its centre is pure): [row, col, shape, colour] per object;
  * sequential_comparison: each trial's end-study button spot, study and test
    arrays (matched against candidates drawn as the factory does, then redrawn
    and checked pixel-exact) and delay (from the widget changes).

Writes src/levels/<level>.js (DM_LEVEL) and games/<level>.replay.json.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
DUMPS = HERE / 'reference' / 'dumps'
U = 360.0 / 65536.0
LOOK = 0.10560          # degrees per look pixel (compile_level.py, U04)

LEVELS = {
    # episode lengths from the level scripts (PROGRESS.md T0)
    'psychlab_visual_search': dict(seconds=150),
    'psychlab_sequential_comparison': dict(seconds=300),
}
# big_screen.map's trigger_lookat patch (the screen's surface)
SCREEN = {'y': 58.0, 'x0': -56.0, 'x1': 56.0, 'z0': 67.0, 'z1': 179.0}
LOOKAT = {'eye': [0.0, -32.0, 122.0], 'muzzle': 14.0, 'y': 57.875, 'x0': -57.0, 'x1': 57.0, 'z0': 66.0, 'z1': 180.0}


def phase(start, looks, angles, sign):
    """The smallest grid phase c in [0, U) (1/512 U) with which an accumulator
    of the looks reproduces every frame's angle: start + sign * U * n."""
    for k in range(512):
        c = k / 512.0 * U
        acc, ok = 0.0, True
        for look, ang in zip(looks, angles):
            acc += look * LOOK
            n = math.floor((acc + c) / U) - math.floor(c / U)
            if abs(((start + sign * n * U - ang) + 180) % 360 - 180) > 1e-6:
                ok = False
                break
        if ok:
            return k
    raise AssertionError('no phase reproduces these angles')


# visual_search_factory.lua's shapes (4 x 4 masks) and colours, read as spec
SHAPES = [[[1, 1, 1, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]], [[0, 1, 0, 0], [0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0]],
          [[1, 0, 0, 0], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0]], [[0, 0, 1, 0], [0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0]],
          [[1, 1, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]], [[1, 1, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
          [[0, 1, 1, 0], [0, 1, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0]], [[1, 1, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]]]
COLORS = [(255, 0, 191), (255, 191, 0), (0, 255, 255), (0, 63, 255), (127, 0, 255)]
GRID0 = 51 + 8          # the array image at 51 px (0.1 x 512, truncated), objects 8 px in
CELL, PER = 56, 7


def decode_array(png, scale):
    im = np.asarray(Image.open(io.BytesIO(base64.b64decode(png))).convert('RGB')).astype(int)
    items = []
    for r in range(PER):
        for c in range(PER):
            mask, col = [[0] * 4 for _ in range(4)], None
            for i in range(4):
                for j in range(4):
                    x, y = GRID0 + CELL * c + 14 * j + 7, GRID0 + CELL * r + 14 * i + 7
                    p = im[int(y / scale), int(x / scale)]
                    if (p < 250).any():
                        k = int(np.argmin([np.abs(p - np.array(cc)).sum() for cc in COLORS]))
                        assert np.abs(p - np.array(COLORS[k])).sum() < 12, ('not a stimulus colour', p, r, c)
                        assert col in (None, k), ('two colours in a cell', r, c)
                        mask[i][j], col = 1, k
            if col is not None:
                assert mask in SHAPES, ('not a stimulus shape', mask, r, c)
                items.append([r, c, SHAPES.index(mask), col])
    return items


def trials_of(d):
    """Each trial's objects, in order: the screen of the frame its array came up."""
    scale = d['start']['screen_size'][0] / Image.open(io.BytesIO(base64.b64decode(
        next(iter(d['screens'].values()))))).size[0]
    out, prev = [], ''
    for r in d['trajectories']['gaze']:
        if 'widgets' not in r:
            continue
        had, has = 'image ' in prev, 'image ' in r['widgets']
        prev = r['widgets']
        if has and not had:
            out.append(decode_array(d['screens'][r['screen']], scale))
    return out


# sequential_comparison_factory.lua (read as spec): 256 px screen, the array
# 0.75 of it at 32 px, a 64-unit grid at 3 px a unit, objects 8 units.
SEQ_COLORS = [(255, 0, 0), (255, 191, 0), (127, 255, 0), (0, 255, 255), (0, 63, 255), (127, 0, 255), (255, 0, 191)]
SEQ_GRID = list(range(4, 56, 8))
SEQ_BAD = {12, 20, 36, 44}     # getRandomCoordinates never puts an object where x and y are both here


def _seq_fill(im, r0, nr, c0, nc, col):
    if nr > 0 and nc > 0:      # Lua's narrow(): 1-based start
        im[r0 - 1:r0 - 1 + nr, c0 - 1:c0 - 1 + nc] = col


def _seq_draw(im, x, y, col, opt, ori):
    L, R, T, B = int(x * 3.0), int((x + 8) * 3.0), int(y * 3.0), int((y + 8) * 3.0)
    _seq_fill(im, T, B - T, L, R - L, col)
    if opt == 1:
        return
    h, w = B - T, R - L
    p = lambda k, sz, o: math.floor(.5 + k * sz) + o
    t2, t4, t6, t8 = p(.2, h, T), p(.4, h, T), p(.6, h, T), p(.8, h, T)
    l2, l4, l6, l8 = p(.2, w, L), p(.4, w, L), p(.6, w, L), p(.8, w, L)
    W = (255, 255, 255)
    if ori == 1:
        _seq_fill(im, t2, t4 - t2, l4, R - l4, W); _seq_fill(im, t6, t8 - t6, l4, R - l4, W)
    elif ori == 0:
        _seq_fill(im, t2, t4 - t2, L, l6 - L, W); _seq_fill(im, t6, t8 - t6, L, l6 - L, W)
    elif ori == 2:
        _seq_fill(im, T, t6 - T, l2, l4 - l2, W); _seq_fill(im, T, t6 - T, l6, l8 - l6, W)
    else:
        _seq_fill(im, t4, B - t4, l2, l4 - l2, W); _seq_fill(im, t4, B - t4, l6, l8 - l6, W)


def _seq_screen(objs, png_px):
    s = np.full((256, 256, 3), 255, np.uint8)
    a = np.full((192, 192, 3), 255, np.uint8)
    for x, y, c, o, r in objs:
        _seq_draw(a, x, y, SEQ_COLORS[c], o, r)
    s[32:224, 32:224] = a
    return np.asarray(Image.fromarray(s).resize((png_px, png_px), Image.BOX)).astype(int)


def decode_seq(png, button):
    """[x, y, colour, optotype (0 E, 1 square), orientation] per object: each
    occupied grid spot matched against every candidate drawn and box-filtered
    like the dump's PNG; the whole array is then redrawn and must match the
    PNG exactly (the end-study button, drawn over it, masked)."""
    im = np.asarray(Image.open(io.BytesIO(base64.b64decode(png))).convert('RGB')).astype(int)
    k = 256 // im.shape[0]
    cands = [(c, 1, 0) for c in range(7)] + [(c, 0, r) for c in range(7) for r in range(4)]
    objs = []
    for x in SEQ_GRID:
        for y in SEQ_GRID:
            if x in SEQ_BAD and y in SEQ_BAD:
                continue
            cy, cx = (32 + int(y * 3.0) - 1 + 12) // k, (32 + int(x * 3.0) - 1 + 12) // k
            if (im[cy, cx] > 250).all():
                continue
            r0, c0 = (32 + int(y * 3.0) - 1) // k, (32 + int(x * 3.0) - 1) // k
            n = 26 // k
            best = min(((np.abs(_seq_screen([(x, y) + cd], im.shape[0])[r0:r0 + n, c0:c0 + n]
                                - im[r0:r0 + n, c0:c0 + n]).sum(), cd) for cd in cands))
            objs.append([x, y] + list(best[1]))
    diff = np.abs(_seq_screen(objs, im.shape[0]) - im)
    if button:
        x0, y0, x1, y1 = (int(v) // k for v in button)
        diff[max(y0 - 1, 0):y1 + 1, max(x0 - 1, 0):x1 + 1] = 0
    assert diff[32 // k:224 // k, 32 // k:224 // k].max() == 0, 'array does not redraw exactly'
    return objs


def seq_trials_of(d):
    """Each trial: the end-study button's spot (screen fraction), the study
    array, the delay (frames from the button's hover end to the test array)
    and the test array, as far as the dump goes."""
    out, prev, cur, t_end = [], '', None, None
    for r in d['trajectories']['gaze']:
        if 'widgets' not in r:
            continue
        w = r['widgets']
        names = {ln.split()[0]: [float(v) for v in ln.split()[1:]] for ln in w.split('\n') if ln.strip()}
        if 'endStudyPhaseButton' in names and 'endStudyPhaseButton ' not in prev:
            b = names['endStudyPhaseButton']
            cur = {'loc': [b[0] / 256.0, b[1] / 256.0], 'study': decode_seq(d['screens'][r['screen']], b)}
            out.append(cur)
        elif not names and cur is not None and 'endStudyPhaseButton ' in prev:
            t_end = r['f']
        elif 'newButton' in names and 'newButton ' not in prev and cur is not None:
            cur['delay'] = r['f'] - t_end
            cur['test'] = decode_seq(d['screens'][r['screen']], None)
        prev = w
    return out


def compile_seed(d):
    acts = d['action_set']
    traj = [r for r in d['trajectories']['gaze'] if 'rot' in r]
    y0 = U * round(d['start']['rot'][1] / U)
    yaw = phase(y0, [acts[r['a']][1][0] for r in traj], [r['rot'][1] for r in traj], -1)
    pitch = phase(0.0, [acts[r['a']][1][1] for r in traj], [r['rot'][0] for r in traj], 1)
    rp = {'yaw_phase': yaw, 'pitch_phase': pitch}
    if d['level'] == 'psychlab_visual_search':
        rp['trials'] = trials_of(d)
    else:
        rp['trials'] = seq_trials_of(d)
    return {'seed': d['seed'], 'spawn_yaw': d['start']['rot'][1]}, rp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level', choices=sorted(LEVELS))
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    files = sorted((DUMPS / a.level).glob('*.json'), key=lambda p: int(p.stem))
    seeds, replay, eye = [], {}, None
    for f in files:
        d = json.loads(f.read_text())
        assert d['start']['pos'][:2] == [0.0, -32.0], 'psychlab spawns at one point'
        eye = d['start']['eye']
        px = d['start']['screen_size'][0]
        s, r = compile_seed(d)
        seeds.append(s)
        replay[str(d['seed'])] = r
    level = {'name': a.level, 'kind': 'psychlab', 'episode_seconds': LEVELS[a.level]['seconds'],
             'eye': eye, 'screen': SCREEN, 'screen_px': px, 'lookat': LOOKAT, 'seeds': seeds}
    js = ('// GENERATED by tools/compile_psychlab.py from reference/dumps/%s. DO NOT EDIT.\n'
          'const DM_LEVEL = %s;\n' % (a.level, json.dumps(level, separators=(',', ':'))))
    rp = json.dumps(replay, separators=(',', ':')) + '\n'
    outs = [(HERE / 'src' / 'levels' / f'{a.level}.js', js), (HERE / 'games' / f'{a.level}.replay.json', rp)]
    if a.check:
        stale = [str(p) for p, t in outs if not p.exists() or p.read_text() != t]
        print('STALE ' + ' '.join(stale) if stale else 'compiled data up to date')
        return 1 if stale else 0
    for p, t in outs:
        p.write_text(t)
        print(p, len(t))
    return 0


if __name__ == '__main__':
    sys.exit(main())
