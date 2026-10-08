"""Compile oracle dumps into the data the port loads (PLAN.md section 5).

    uv run --no-sync python tools/compile_level.py explore_goal_locations_small [--check]

Writes, per level:
  src/levels/<level>.js           const DM_LEVEL: name, episode length, sky, and
                                  for every corpus seed the maze (rows), its
                                  per-cell textures as atlas tiles, wall decals,
                                  the spawn pose and the goal - all DATA that
                                  DMLab generated (layouts are data, rule 2).
  games/<level>.replay.json       for the G3 gate only: per seed and scripted
                                  trajectory, the oracle's engine timing (msec
                                  per frame), the yaw quantisation phase and the
                                  respawn poses. These are oracle inputs that
                                  are not functions of the agent's actions
                                  (PROGRESS.md reference quirks, U04).

Both are deterministic functions of the committed dumps.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / 'tools'))
import dmlab_atlas  # noqa: E402

U = 360.0 / 65536.0
LOOK = 0.10560
# Per level: task kind, episode length (the level script's episodeLengthSeconds,
# else explore/factory.lua's default 90) and the task options the port needs
# to draw restarts in play (read off the factories as specification).
LEVELS = {
    'explore_goal_locations_small': dict(kind='goal', seconds=90),
    'explore_goal_locations_large': dict(kind='goal', seconds=120),
    'explore_obstructed_goals_small': dict(kind='goal', seconds=90, doors_closed=0.5),
    'explore_obstructed_goals_large': dict(kind='goal', seconds=120, doors_closed=0.5),
    'explore_object_locations_small': dict(kind='objects', seconds=90),
    'explore_object_locations_large': dict(kind='objects', seconds=120),
    'explore_object_rewards_few': dict(kind='rewards', seconds=90, pickup_density=0.5),
    'explore_object_rewards_many': dict(kind='rewards', seconds=120, pickup_density=0.5),
    # Tier 2 (PLAN.md section 11): language levels. 'shapes' and 'patterns' are
    # what the level script's object generator may draw (read as spec): the
    # atlas carries their hrp2 tiles, and play mode draws new rounds from them.
    'language_select_described_object': dict(kind='language', seconds=60,
        shapes=['cake', 'car', 'cassette', 'hat', 'tv'],
        patterns=['chequered', 'crosses', 'diagonal_stripe', 'discs', 'hex', 'pinstripe',
                  'solid', 'spots', 'swirls']),
    'language_select_located_object': dict(kind='language', seconds=120, task='located',
        shapes=['apple2', 'ball', 'balloon', 'banana', 'bottle', 'cake', 'can', 'car', 'cassette', 'chair',
                'cherries', 'cow', 'flower', 'fork', 'fridge', 'guitar', 'hair_brush', 'hammer', 'hat',
                'ice_lolly', 'jug', 'key', 'knife', 'ladder', 'mug', 'pencil', 'pig', 'pincer', 'plant',
                'saxophone', 'shoe', 'spoon', 'suitcase', 'tennis_racket', 'tomato', 'toothbrush', 'tree',
                'tv', 'wine_glass', 'zebra'],
        patterns=['solid'], colours=['red', 'green', 'blue', 'cyan', 'magenta', 'yellow']),
    'language_execute_random_task': dict(kind='language', seconds=120, task='execute',
        shapes=['apple2', 'ball', 'balloon', 'banana', 'bottle', 'cake', 'can', 'car', 'cassette', 'chair',
                'cherries', 'cow', 'flower', 'fork', 'fridge', 'guitar', 'hair_brush', 'hammer', 'hat',
                'ice_lolly', 'jug', 'key', 'knife', 'ladder', 'mug', 'pencil', 'pig', 'pincer', 'plant',
                'saxophone', 'shoe', 'spoon', 'suitcase', 'tennis_racket', 'tomato', 'toothbrush', 'tree',
                'tv', 'wine_glass', 'zebra'],
        patterns=['solid'], colours=['red', 'green', 'blue', 'cyan', 'magenta', 'yellow']),
    # objects in the 6 colours; the answer balls white and black; the floors
    # green, red, orange and black (its regionColorSelector)
    'language_answer_quantitative_question': dict(kind='language', seconds=60, task='answer',
        shapes=['apple2', 'ball', 'balloon', 'banana', 'bottle', 'cake', 'can', 'car', 'cassette', 'chair',
                'cherries', 'cow', 'flower', 'fork', 'fridge', 'guitar', 'hair_brush', 'hammer', 'hat',
                'ice_lolly', 'jug', 'key', 'knife', 'ladder', 'mug', 'pencil', 'pig', 'pincer', 'plant',
                'saxophone', 'shoe', 'spoon', 'suitcase', 'tennis_racket', 'tomato', 'toothbrush', 'tree',
                'tv', 'wine_glass', 'zebra'],
        patterns=['solid'],
        colours=['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'white', 'black', 'orange']),
}
SKY_RGB = 0x89D7FF   # modal top-row colour of the 64x64 oracle frames (sky)
NONE = 0xFFFF
IDX = None
SIZES = None
# Closed doors: no door texture is in the MISHMASH set; the port draws them
# with a fixed wall texture until G6 says what DMLab shows.
DOOR_TEXTURE = 'map/lab_games/lg_style_03_wall_gray'


def atlas_index(level):
    _, names = dmlab_atlas.build(level)
    return {n: i for i, n in enumerate(names)}


def parse_theme(text):
    var = {}
    decals = []
    for line in text.split('\n'):
        if line.startswith('V '):
            # the variation is 'default' or ONE character, which may be blank
            key, rest = ('default', line[10:]) if line.startswith('V default ') else (line[2], line[4:])
            m = re.match(r'floor=(\S+) ceiling=(\S+) wall=(\S+)', rest)
            var[key] = {'floor': m.group(1), 'ceiling': m.group(2), 'wall': m.group(3)}
        elif line.startswith('D '):
            kv = dict(x.split('=') for x in line[2:].split(' ')[0].split(','))
            decal = line.split(' decal=')[1]
            decals.append((int(kv['i']) - 1, int(kv['j']) - 1, kv['direction'], decal))
    return var, decals


def entities(text):
    out = []
    for e in text.split(';'):
        if not e:
            continue
        n, rest = e.split('|', 1)
        f = rest.split(' ')
        # classname, origin ('x y z' or '-'), then id, angle, targetname,
        # spawnflags; dumps made before a field was logged simply end early.
        cls, tail = f[0], f[1:]
        k = 1 if tail[0] == '-' else 3
        origin, rest = tail[:k], (tail[k:] + ['-'] * 4)[:4]
        eid, angle, target, flags = rest
        num = lambda v: float(v) if v not in ('-', None) else None
        x, y, z = (num(v) for v in origin) if len(origin) == 3 else (None, None, None)
        out.append({'start': int(n), 'class': cls, 'x': x, 'y': y, 'z': z, 'id': eid,
                    'angle': angle, 'targetname': target, 'spawnflags': flags})
    return out


def sprite_sizes():
    """Billboard size in cells for every sprite tile, from the asset manifest's
    model bounding boxes (x extent wide, z extent tall)."""
    man = json.loads((HERE.parents[4] / 'games' / 'dmlab_assets' / 'manifest.json').read_text())
    out = {}
    for e in man['files']:
        if e['file'].startswith('sprites/'):
            b = e['bbox_units']
            key = 'sprite/' + Path(e['file']).stem
            out[key] = [round((b['max'][0] - b['min'][0]) / 100.0, 4), round((b['max'][2] - b['min'][2]) / 100.0, 4)]
    return out


def categories(d, idx, sizes):
    """Item categories this seed uses, as [tile, width, height, reward]."""
    import sprites
    cats = {'apple_reward': ['sprite/apple', 1.0]}
    for line in d['start'].get('pickups', '').split('\n'):
        if line.strip():
            kv = dict(x.split('=', 1) for x in line.split(' ')[1:])
            cats[line.split(' ')[0]] = ['sprite/' + sprites.hrp_key(kv), float(kv['quantity'])]
    return {k: [idx[t], sizes[t][0], sizes[t][1], q] for k, (t, q) in cats.items()}


# ---- language levels (tier 2) ----------------------------------------------
# A language episode is a sequence of rounds: each (re)start of the map places
# new objects (hrp specs in the pickup log, positions in the entity log) and
# sets a new instruction. pu:1 is the object the instruction names (the
# level's goal group): +10; any other object -10 (language_select_described_object.lua,
# read as spec; G3 checks it against the oracle's rewards).

LANG_GOAL_REWARD = 10.0
TABLE = {}   # the level's language maps (main)
LANGUAGE = False   # compiling a language level (main)
# object_generator's named colours, HSL (read as spec); play mode draws from
# these (without the generator's noise), the dumps carry the drawn values.
LANG_COLORS_HSL = {'black': (0, 0, 0), 'gray': (0, 0, 50), 'white': (0, 0, 100), 'red': (0, 100, 50),
                   'orange': (30, 100, 50), 'brown': (30, 51, 40), 'yellow': (60, 100, 50),
                   'green': (120, 100, 50), 'cyan': (180, 100, 50), 'blue': (240, 100, 50),
                   'purple': (270, 100, 50), 'magenta': (300, 100, 50), 'pink': (330, 100, 50)}


def hsl_rgb(h, s, l):
    """Standard HSL to 0xRRGGBB (h in degrees, s and l in percent)."""
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l / 100.0, s / 100.0)
    return (round(r * 255) << 16) | (round(g * 255) << 8) | round(b * 255)


def lang_rounds_of(log):
    """The pickup log split into rounds: [{name: (spec dict, scale)}]."""
    rounds, cur, scales = [], {}, {}
    for ln in log.split('\n'):
        ln = ln.strip()
        if not ln:
            continue
        if ln.startswith('CREATE '):
            p = ln.split(' ')
            m = re.search(r'%scale\{([0-9.]+)\}', ln)
            scales[p[1]] = float(m.group(1)) if m else 1.0
            continue
        name = ln.split(' ')[0]
        if name in cur:
            rounds.append((cur, scales))
            cur, scales = {}, {}
        cur[name] = dict(x.split('=', 1) for x in ln.split(' ')[1:])
    if cur:
        rounds.append((cur, scales))
    return [{n: (spec, sc.get(n, 1.0)) for n, spec in specs.items()} for specs, sc in rounds]


def _rgb(c):
    r, g, b = (int(v) for v in c.split(','))
    return (r << 16) | (g << 8) | b


def _colour_name(rgb):
    """The named colour an object's (noisy) colour was drawn from: the nearest."""
    r, g, b = (int(v) for v in rgb.split(','))
    best = None
    for n, hsl in LANG_COLORS_HSL.items():
        c = hsl_rgb(*hsl)
        dd = (r - (c >> 16)) ** 2 + (g - ((c >> 8) & 255)) ** 2 + (b - (c & 255)) ** 2
        if best is None or dd < best[0]:
            best = (dd, n)
    return best[1]


def lang_goals(instr, objs):
    """Which objects the instruction asks for, and whether the round counts
    (every one of them, a bonus on the last) or ends on the first pick.
    objs: {name: (shape, colour name, room)}. The level scripts' tasks (read
    as spec) make the answer unique; the patterns are their instruction keys."""
    names = set(LANG_COLORS_HSL)
    m = re.fullmatch(r'Pick the \w+ object in the \w+ room', instr)
    if m:
        return {'pu:1'}, False                 # located: group 1 is the goal
    m = re.fullmatch(r'Every (\w+) object', instr)
    if m:
        return {n for n, o in objs.items() if o[1] == m.group(1)}, True
    m = re.fullmatch(r'Every (\w+)', instr)
    if m:
        return {n for n, o in objs.items() if o[0] == m.group(1)}, True
    def near(test_a, test_b):
        rooms_b = {o[2] for o in objs.values() if test_b(o)}
        return {n for n, o in objs.items() if test_a(o) and o[2] in rooms_b and
                any(test_b(q) and q[2] == o[2] for k, q in objs.items() if k != n)}
    m = re.fullmatch(r'(\w+) object near (\w+) object', instr)
    if m:
        return near(lambda o: o[1] == m.group(1), lambda o: o[1] == m.group(2)), False
    m = re.fullmatch(r'(\w+) near (\w+) object', instr)
    if m:
        return near(lambda o: o[0] == m.group(1), lambda o: o[1] == m.group(2)), False
    m = re.fullmatch(r'(\w+) near (\w+)', instr)
    if m:
        return near(lambda o: o[0] == m.group(1), lambda o: o[0] == m.group(2)), False
    m = re.fullmatch(r'(\w+) (\w+)', instr)
    if m and m.group(1) in names:
        return {n for n, o in objs.items() if o[1] == m.group(1) and o[0] == m.group(2)}, False
    if instr in names:
        return {n for n, o in objs.items() if o[1] == instr}, False
    return {n for n, o in objs.items() if o[0] == instr}, False


def lang_answer(instr, objs):
    """A question's truth (language_answer_quantitative_question, read as
    spec) from the objects on show, objs {name: (shape, colour, room)}
    without the two answer balls."""
    vis = list(objs.values())
    m = re.fullmatch(r'Are all (\w+) objects (\w+)\?', instr)
    if m:
        return not any(o[0] == m.group(1) and o[1] != m.group(2) for o in vis)
    m = re.fullmatch(r'Is any (\w+) (\w+)\?', instr)
    if m:
        return any(o[0] == m.group(1) and o[1] == m.group(2) for o in vis)
    m = re.fullmatch(r'Is anything (\w+)\?', instr)
    if m:
        return any(o[1] == m.group(1) for o in vis)
    m = re.fullmatch(r'Are most (\w+) objects (\w+)\?', instr)
    assert m, instr
    yes = sum(o[0] == m.group(1) and o[1] == m.group(2) for o in vis)
    return yes > sum(o[0] == m.group(1) and o[1] != m.group(2) for o in vis)


def lang_items(ents, round_specs, idx, sizes, instr, vrows):
    """[x, y, tile, w, h, reward, rgb1, rgb2, goal(, look only)] per object
    of one round, and whether the round counts. Rewards follow
    reward_controllers (read as spec): balanced, the goal +10 and a distractor
    -floor(10 / #distractors + 0.5); balanced counting, each goal +1 (the last
    one also +10, the bonus the game adds) and a distractor
    -floor((#goals + 10) / #distractors + 0.5); answer (a question), the white
    'yes' ball and the black 'no' ball +10 when right and -10 when wrong, every
    other object only to look at (a tenth element, 1)."""
    H = len(vrows)
    objs, rows = {}, []
    for e in ents:
        if e['class'] not in round_specs:
            continue
        spec, scale = round_specs[e['class']]
        r, c = H - 1 - math.floor(e['y'] / 100.0), math.floor(e['x'] / 100.0)
        room = vrows[r][c] if 0 <= r < H and c < len(vrows[r]) else '.'
        objs[e['class']] = (spec['shape'], _colour_name(spec['color1']), room)
        rows.append((e, spec, scale))
    if instr.endswith('?'):
        balls = {n: o[1] for n, o in objs.items() if o[0] == 'ball' and o[1] in ('white', 'black')}
        assert sorted(balls.values()) == ['black', 'white'], (instr, objs)
        truth = lang_answer(instr, {n: o for n, o in objs.items() if n not in balls})
        out = []
        for e, spec, scale in rows:
            key = 'sprite/hr_%s__%s' % (spec['shape'], spec['pattern'])
            w, h = sizes[key]
            right = e['class'] in balls and (balls[e['class']] == 'white') == truth
            reward = 0.0 if e['class'] not in balls else LANG_GOAL_REWARD if right else -LANG_GOAL_REWARD
            out.append([e['x'], e['y'], idx[key], round(w * scale, 4), round(h * scale, 4), reward,
                        _rgb(spec['color1']), _rgb(spec['color1']), 1 if right else 0,
                        0 if e['class'] in balls else 1])
        return out, False
    goals, counting = lang_goals(instr, objs)
    assert goals, (instr, objs)
    n_goal, n_other = len(goals), len(objs) - len(goals)
    if counting:
        good, bad = 1.0, -float(math.floor((n_goal * 1 + LANG_GOAL_REWARD) / n_other + 0.5)) if n_other else 0.0
    else:
        good, bad = LANG_GOAL_REWARD, -float(math.floor(LANG_GOAL_REWARD / n_other + 0.5)) if n_other else 0.0
    out = []
    for e, spec, scale in rows:
        key = 'sprite/hr_%s__%s' % (spec['shape'], spec['pattern'])
        w, h = sizes[key]
        c2 = spec['color1'] if spec['pattern'] == 'solid' else spec['color2']
        g = e['class'] in goals
        out.append([e['x'], e['y'], idx[key], round(w * scale, 4), round(h * scale, 4),
                    good if g else bad, _rgb(spec['color1']), _rgb(c2), 1 if g else 0])
    return out, counting


def lang_map_name(maplog, k):
    """The map the k-th (re)start loaded, from the PT.MAP log."""
    names = [ln.split(' ')[2] for ln in maplog.split('\n') if ln.startswith('NEXTMAP %d ' % k)]
    return names[-1] if names else None


def lang_floors(floorlog, k):
    """{region: colour name} the k-th start set (PT.FLOORS), named colours."""
    out = {}
    for ln in floorlog.split('\n'):
        p = ln.split(' ')
        if len(p) == 3 and int(p[0]) == k:
            # nearest: DMLab's HSL conversion truncates (orange is 255,127,0)
            out[p[1]] = _colour_name(p[2])
    return out


LANG_SHIFT = 100.0   # one cell: the wall ring the port adds around a language map


def _shift_ents(text):
    out = []
    for e in text.split(';'):
        if not e:
            continue
        n, rest = e.split('|', 1)
        f = rest.split(' ')
        if len(f) > 3 and f[1] != '-':
            f[1] = repr(float(f[1]) + LANG_SHIFT)
            f[2] = repr(float(f[2]) + LANG_SHIFT)
        out.append(n + '|' + ' '.join(f))
    return ';'.join(out)


def pad_text(layout, variation):
    """A language map's layout and variation inside a ring of wall cells; a short
    row ends in wall, as DMLab lays it out (quantificationSmallMap)."""
    rows = layout.rstrip('\n').split('\n')
    vrows = variation.rstrip('\n').split('\n')
    W = max(len(r) for r in rows)
    lay = '\n'.join(['*' * (W + 2)] + ['*' + r.ljust(W, '*') + '*' for r in rows] + ['*' * (W + 2)]) + '\n'
    var = '\n'.join(['.' * (W + 2)] + ['.' + r.ljust(W, '.') + '.' for r in vrows] + ['.' * (W + 2)]) + '\n'
    return lay, var


def pad_theme(theme):
    """Decal cells (i, j) move by one with the ring."""
    return re.sub(r'\bi=(\d+)', lambda m: 'i=%d' % (int(m.group(1)) + 1),
                  re.sub(r'\bj=(\d+)', lambda m: 'j=%d' % (int(m.group(1)) + 1), theme))


def _var_of(traj, r):
    """The variation in force at record r (a layout change may come alone)."""
    v = None
    for q in traj:
        if 'variation' in q:
            v = q['variation']
        if q is r:
            break
    return v


def makemaps(maplog):
    """{name: (layout, variation)} from the PT.MAP log's MAKEMAP blocks: the
    map text the level built, entity layer then VARIATIONS (DEBUG.MAZE.VARIATION
    reports dots for these maps; the rooms are in the map text)."""
    out = {}
    blocks = maplog.split('MAKEMAP name=')[1:]
    for b in blocks:
        lines = b.split('\n')
        name, rest = lines[0].strip(), lines[1:]
        lay = []
        while rest and rest[0].strip() and not rest[0].startswith(('VARIATIONS', 'NEXTMAP')):
            lay.append(rest.pop(0))
        while rest and not rest[0].startswith(('VARIATIONS', 'NEXTMAP', 'MAKEMAP')):
            rest.pop(0)
        var = []
        if rest and rest[0].startswith('VARIATIONS'):
            rest.pop(0)
            while rest and rest[0].strip() and not rest[0].startswith(('NEXTMAP', 'MAKEMAP')):
                var.append(rest.pop(0))
        if not var or var == ['nil']:
            var = ['.' * len(r) for r in lay]
        out[name] = ('\n'.join(lay) + '\n', '\n'.join(var) + '\n')
    return out


def lang_map_table(files):
    """{map name: (layout, variation, theme)} for every map the level built.
    The dumper runs every seed in one process, where DMLab builds a map once
    per name: a map's theme is the PT.THEME lines that appeared when it was
    built (in whichever episode and round that was), and it holds for every
    later use. Layouts and variations as DEBUG.MAZE reported them."""
    table = {}
    for f in files:
        d = json.loads(f.read_text())
        s = d['start']
        k1 = lang_map_name(s['map'], 1)
        if k1 not in table and s['theme'].strip():
            lay, var = makemaps(s['map']).get(k1, (s['layout'], s['variation']))
            table[k1] = (lay, var, s['theme'])
        for traj in d['trajectories'].values():
            cur = {'layout': s['layout'], 'variation': s['variation'], 'theme': s['theme'], 'map': s['map']}
            seen = set(s['theme'].split('\n'))
            restarts = set(lang_restarts(traj))
            for i, r in enumerate(traj):
                for k in cur:
                    if k in r:
                        cur[k] = r[k]
                if i not in restarts:
                    continue
                n = max(e['start'] for e in entities(r['entities']))
                name = lang_map_name(cur['map'], n)
                new = [ln for ln in cur['theme'].split('\n') if ln and ln not in seen]
                seen.update(cur['theme'].split('\n'))
                if name not in table and new:
                    lay, var = makemaps(cur['map']).get(name, (cur['layout'], cur['variation']))
                    table[name] = (lay, var, '\n'.join(new))
    return table


def lang_pad(d):
    """A language dump as the port lays it out. DMLab's map maker walls the
    entity layer in from outside (the walls sit at negative coordinates); the
    port's grid has no negative cells, so the layout gains a ring of wall cells
    and every world position moves by LANG_SHIFT in x and y (the decal cells by
    one). The level data records the shift; tests/test_trajectory.py takes it
    back off before comparing with the oracle. Physics is translation-free."""
    import copy
    d = copy.deepcopy(d)
    s = d['start']
    s['layout'], s['variation'] = pad_text(s['layout'], s['variation'])
    for k in ('pos', 'eye'):
        s[k] = [s[k][0] + LANG_SHIFT, s[k][1] + LANG_SHIFT] + s[k][2:]
    s['entities'] = _shift_ents(s['entities'])
    s['theme'] = pad_theme(s['theme'])
    for traj in d['trajectories'].values():
        for r in traj:
            if 'layout' in r:
                r['layout'], r['variation'] = pad_text(r['layout'], r.get('variation') or _var_of(traj, r))
            if 'theme' in r:
                r['theme'] = pad_theme(r['theme'])
            for k in ('pos', 'eye'):
                if k in r:
                    r[k] = [r[k][0] + LANG_SHIFT, r[k][1] + LANG_SHIFT] + r[k][2:]
            if 'entities' in r:
                r['entities'] = _shift_ents(r['entities'])
    for f in d.get('frames', []):
        for k in ('pos', 'eye'):
            f[k] = [f[k][0] + LANG_SHIFT, f[k][1] + LANG_SHIFT] + f[k][2:]
    return d


def lang_scales(files):
    out = {}
    for f in files:
        d = json.loads(f.read_text())
        logs = [d['start']['pickups']] + [r['pickups'] for t in d['trajectories'].values() for r in t if 'pickups' in r]
        for log in logs:
            for m in re.finditer(r'models/hr_([a-z_0-9]+)\.md3(?:%scale\{([0-9.]+)\})?', log):
                out[m.group(1)] = float(m.group(2) or 1.0)
    return dict(sorted(out.items()))


def lang_restarts(traj):
    """Frames on which the map restarted: the entity log gains a start."""
    out, last = [], 1
    for i, r in enumerate(traj):
        if r.get('entities'):
            n = max(e['start'] for e in entities(r['entities']))
            if n > last:
                out.append(i)
                last = n
    return out


def contents(ents, H, cats):
    """Spawn, goal, items and doors of one map (re)start."""
    spawn = [e for e in ents if e['class'] == 'info_player_start']
    goals = [e for e in ents if e['class'] == 'goal']
    items = [[e['x'], e['y'], e['class']] for e in ents if e['class'] in cats]
    doors = []
    for e in ents:
        if e['class'] == 'func_door':
            _, c, k = e['targetname'].split('_')
            doors.append([H - 1 - int(k), int(c), 1 if e['spawnflags'] == '1' else 0])
    return {'spawn': [spawn[0]['x'], spawn[0]['y']] if spawn else None,
            'goal': [goals[0]['x'], goals[0]['y'], goals[0]['z']] if goals else None,
            'items': items, 'doors': sorted(doors)}


def grid_of(layout, variation, theme, idx, tag=None):
    """A text map's cells: per-cell wall and floor tiles, decals, cell lists."""
    rows = layout.rstrip('\n').split('\n')
    vrows = variation.rstrip('\n').split('\n')
    H, W = len(rows), max(len(r) for r in rows)
    var, decals = parse_theme(theme)

    def theme_of(ch):
        key = 'default' if ch == '.' else ch
        # A theme only records the variations the map asked for; a wall
        # corner with no open neighbour may name one that was never built.
        return var.get(key) or var.get('default') or var[sorted(var)[0]]

    # Per-cell tiles. Open cells take their own variation's floor; wall cells
    # take the wall texture of the variation that most of their open
    # neighbours have (DMLab textures a wall face by the cell it faces; the
    # primitive has one wall tile per cell, so a wall shared by two variations
    # takes the majority - recorded as an approximation, measured by G6).
    wall_t = [[NONE] * W for _ in range(H)]
    floor_t = [[NONE] * W for _ in range(H)]
    solid = [[(c < len(rows[r]) and rows[r][c] == '*') for c in range(W)] for r in range(H)]
    for r in range(H):
        for c in range(W):
            vch = vrows[r][c] if c < len(vrows[r]) else '.'
            if not solid[r][c]:
                floor_t[r][c] = idx[theme_of(vch)['floor']]
                continue
            votes = {}
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                rr, cc = r + dr, c + dc
                if 0 <= rr < H and 0 <= cc < W and not solid[rr][cc]:
                    k = vrows[rr][cc] if cc < len(vrows[rr]) else '.'
                    votes[k] = votes.get(k, 0) + 1
            vch2 = max(sorted(votes), key=lambda k: (votes[k], k != '.')) if votes else vch
            wall_t[r][c] = idx[theme_of(vch2)['wall']]
            floor_t[r][c] = idx[theme_of(vch2)['floor']]
    # Decals: (i, j) is the OPEN cell, direction the side its wall is on, so
    # the decal sits on the facing face of the neighbouring wall cell.
    face_of = {'N': ((-1, 0), 'S'), 'S': ((1, 0), 'N'), 'E': ((0, 1), 'W'), 'W': ((0, -1), 'E')}
    dl = []
    for r, c, direction, decal in decals:
        (dr, dc), face = face_of[direction]
        rr, cc = r + dr, c + dc
        assert 0 <= rr < H and 0 <= cc < W and solid[rr][cc], (tag, r, c, direction)
        dl.append([rr, cc, 'NESW'.index(face), idx[decal]])
    return {'w': W, 'h': H, 'rows': rows,
            'wall': [x for row in wall_t for x in row], 'floor': [x for row in floor_t for x in row],
            'decals': dl,
            'pcells': [[r, c] for r in range(H) for c in range(W) if rows[r][c] == 'P'],
            'acells': [[r, c] for r in range(H) for c in range(W) if rows[r][c] == 'A'],
            'ocells': [[r, c] for r in range(H) for c in range(W) if rows[r][c] == 'O'],
            # each O cell's room (variation letter): language placement by room
            'oregions': [vrows[r][c] if c < len(vrows[r]) else '.' for r in range(H) for c in range(W)
                         if rows[r][c] == 'O']}


def compile_seed(d, idx, sizes=None):
    s = d['start']
    g = grid_of(s['layout'], s['variation'], s['theme'], idx, d['seed'])
    H = g['h']
    if LEVELS.get(d['level'], {}).get('kind') == 'language':
        cats = {}
        ents = [e for e in entities(s['entities']) if e['start'] == 1]
        cont = contents(ents, H, cats)
        cont['items'] = []
        items, counting = lang_items(ents, lang_rounds_of(s['pickups'])[0], idx, sizes, s['instr'],
                                     s['variation'].rstrip('\n').split('\n'))
        lang = {'instr': s['instr'], 'items': items, 'count': 1 if counting else 0,
                'map': lang_map_name(s['map'], 1), 'floors': lang_floors(s.get('floors', ''), 1)}
    else:
        cats = categories(d, idx, sizes)
        lang = None
        ents = [e for e in entities(s['entities']) if e['start'] == 1]
        cont = contents(ents, H, cats)
    order = sorted(cats)
    return {
        'seed': d['seed'], 'w': g['w'], 'h': H, 'rows': g['rows'],
        'wall': g['wall'], 'floor': g['floor'], 'decals': g['decals'],
        'spawn': [s['pos'][0], s['pos'][1], s['pos'][2], s['rot'][1]],
        'goal': cont['goal'],
        'items': [[x, y, order.index(k)] for x, y, k in cont['items']],
        'cats': [cats[k] for k in order],
        # category index of the k-th object category the level created
        # (object_rewards: categoryId k); hrp numbers its classes per process,
        # so the creation order in the pickup log is what identifies k.
        'pucats': [] if lang else [order.index(line.split(' ')[0]) for line in s.get('pickups', '').split('\n') if line.strip()],
        'doors': cont['doors'],
        'pcells': g['pcells'], 'acells': g['acells'], 'ocells': g['ocells'],
        **({'oregions': g['oregions']} if lang else {}),
        **({'lang': lang, 'shift': [LANG_SHIFT, LANG_SHIFT]} if lang else {}),
    }


def _world_vel(r):
    yaw = math.radians(r['rot'][1])
    c, s = math.cos(yaw), math.sin(yaw)
    vf, vl = r['vel'][0], r['vel'][1]
    return vf * c - vl * s, vf * s + vl * c


_MOVES = [(1, 0), (-1, 0), (0, -1), (0, 1), (0, 0), (0, 0), (1, 0), (1, 0), (0, 0)]   # (move, strafe)


def _snap(v):
    return -math.floor(-v + 0.5) if v < 0 else math.floor(v + 0.5)


def _walk_vel(a, r, ms):
    v = _walk_vel_raw(a, r, ms)
    return _snap(v[0]), _snap(v[1])


def _walk_vel_raw(a, r, ms):
    """The ground walk's velocity update (40_pmove.js: friction, then
    accelerate toward the wish direction), snapped, for one frame of ms."""
    dt = ms / 1000.0
    vx, vy = a
    sp = math.hypot(vx, vy)
    if sp < 1:
        vx = vy = 0.0
    else:
        ns = max(0.0, sp - max(sp, 100.0) * 6.0 * dt) / sp
        vx, vy = vx * ns, vy * ns
    mv, sf = _MOVES[r['a']]
    yaw = math.radians(r['rot'][1])
    c, s = math.cos(yaw), math.sin(yaw)
    wx, wy = c * mv + s * sf, s * mv - c * sf
    wl = math.hypot(wx, wy)
    if wl > 0:
        dx, dy = wx / wl, wy / wl
        add = 320.0 - (vx * dx + vy * dy)
        if add > 0:
            acc = min(10.0 * dt * 320.0, add)
            vx, vy = vx + acc * dx, vy + acc * dy
    return vx, vy


def msec_of(prev_pos, prev_r, r):
    """The oracle's movement time for one frame, from its own motion alone:
    displacement over the (snapped) speed, 14 or 17 ms (PROGRESS.md U04).

    On a frame where a wall clipped one axis (it went from > 30 u/s to 0),
    the end velocity is not the one the player moved with on THAT axis, but a
    flat wall leaves the other axis alone, so the ratio is taken on the other
    axis. None when nothing can decide: the player is nearly still (<= 5 u/s
    on the axis used; the snap error of +-0.5 is then 10%, half the 14/17
    gap), or both axes were clipped."""
    if prev_r is not None and prev_r.get('vel') and prev_r['vel'][2] < 0 and r['vel'][2] < 0:
        # Falling through the whole frame: gravity (800) took 11 or 14 u/s
        # off the snapped vertical speed, whatever the walls did.
        return 14 if prev_r['vel'][2] - r['vel'][2] < 12.5 else 17
    if (prev_r is not None and prev_r.get('vel') and prev_r['vel'][2] == 0 and r['vel'][2] == 0
            and r.get('a') is not None):
        # On the ground, the velocity update alone tells 14 from 17 when only
        # one of them reproduces it (a wall that clipped the velocity matches
        # neither; one that held it, PROGRESS.md U07, leaves it intact).
        a, b = _world_vel(prev_r), _world_vel(r)
        ok = [ms for ms in (14, 17) if all(p == _snap(q) for p, q in zip(_walk_vel(a, r, ms), b))]
        if len(ok) == 1:
            return ok[0]
        # One wall clipped it: the velocity left is the update's component
        # along the wall, i.e. along the velocity observed (the clip removes
        # only the part along the wall's normal, which is normal to it).
        bl = math.hypot(b[0], b[1])
        if not ok and bl > 10.0:
            ux, uy = b[0] / bl, b[1] / bl
            err = {}
            for ms in (14, 17):
                w = _walk_vel_raw(a, r, ms)
                along = w[0] * ux + w[1] * uy
                err[ms] = math.hypot(along * ux - b[0], along * uy - b[1])
            lo, hi = sorted(err, key=err.get)
            if err[lo] <= 1.5 and err[hi] >= 3.0:
                return lo
            # A wall hit inside the frame: it moved with the update's velocity
            # u for a part f of the time, then with the clipped b, so
            # d = dt * b + (dt * f) * (u - b): two equations for dt and f.
            d = (r['pos'][0] - prev_pos[0], r['pos'][1] - prev_pos[1])
            fit = {}
            for ms in (14, 17):
                u = _walk_vel_raw(a, r, ms)
                cu = (u[0] * b[1] - u[1] * b[0]) / (math.hypot(*u) * bl + 1e-9)
                if abs(cu) < 0.1:      # no turn: nothing to solve
                    continue
                e = (u[0] - b[0], u[1] - b[1])
                det = b[0] * e[1] - b[1] * e[0]
                dt = (d[0] * e[1] - d[1] * e[0]) / det
                g = (b[0] * d[1] - b[1] * d[0]) / det
                if dt > 0 and -0.05 <= g / dt <= 1.05:
                    fit[ms] = abs(dt * 1000.0 - ms)
            if len(fit) == 2:
                lo = min(fit, key=fit.get)
                if fit[lo] < 1.0:
                    return lo
    v = math.hypot(r['vel'][0], r['vel'][1])
    if v <= 5.0:
        return None
    b = _world_vel(r)
    d = (r['pos'][0] - prev_pos[0], r['pos'][1] - prev_pos[1])
    if prev_r is not None and 'vel' in prev_r:
        a = _world_vel(prev_r)
        clipped = [abs(a[k]) > 30.0 and abs(b[k]) < 1.0 for k in (0, 1)]
        if clipped[0] and clipped[1]:
            return None
        if clipped[0] or clipped[1]:
            k = 1 if clipped[0] else 0
            if abs(b[k]) <= 5.0:
                return None
            return 14 if d[k] / b[k] * 1000.0 < 15.5 else 17
    # A wall stopped one axis but its velocity was held (the hard-landing
    # hold, 40_pmove.js): that axis did not move, so take the other.
    held = [abs(d[k]) < 0.01 and abs(b[k]) > 10.0 for k in (0, 1)]
    if held[0] != held[1]:
        k = 1 if held[0] else 0
        if abs(b[k]) <= 5.0:
            return None
        return 14 if d[k] / b[k] * 1000.0 < 15.5 else 17
    # Axes that disagree: a wall cut one short (its velocity held), and
    # blocking only ever shortens a move, so the longer time is the true one.
    rs = [d[k] / b[k] * 1000.0 for k in (0, 1) if abs(b[k]) > 30.0]
    if len(rs) == 2 and (rs[0] < 15.5) != (rs[1] < 15.5):
        return 17
    disp = math.hypot(d[0], d[1])
    return 14 if disp / v * 1000.0 < 15.5 else 17


def teleports(traj):
    """Frames on which a restart placed the player: z jumps from standing
    (25.125) to the spawn height (39) - a reward alone (an apple, a good
    object) does not restart the map."""
    out = []
    for i in range(1, len(traj)):
        a, b = traj[i - 1].get('pos'), traj[i].get('pos')
        if a and b and a[2] < 30.0 <= b[2]:
            out.append(i)
    return out


def yaw_phase(y0, acts, traj, start=0):
    """The quantisation phase c in [0, U) of a view accumulator started at
    frame `start` with yaw y0 (spawn yaw rounded to Quake units after a
    respawn): the smallest grid value (1/512 U) reproducing every frame's yaw
    until the next restart."""
    looks = []
    ys = []
    # A segment also ends at any jump no walk can make (> 100 units in a
    # frame; the largest catch-up move is ~67): box levels restart and
    # teleport without the z jump teleports() looks for.
    import math
    jumps = [i for i in range(1, len(traj)) if traj[i].get('pos') and traj[i - 1].get('pos') and
             math.hypot(traj[i]['pos'][0] - traj[i - 1]['pos'][0], traj[i]['pos'][1] - traj[i - 1]['pos'][1]) > 100]
    # language restarts can land within 100 units of the player: the entity log marks them
    extra = set(lang_restarts(traj)) if LANGUAGE else set()
    stops = sorted(t for t in set(teleports(traj)) | set(jumps) | extra if t > start)
    end = stops[0] if stops else len(traj)
    for r in traj[start:end]:
        if 'rot' not in r:
            break
        looks.append(acts[r['a']][1][0])
        ys.append(r['rot'][1])
    for k in range(512):
        c = k / 512.0 * U
        acc = 0.0
        ok = True
        for L, y in zip(looks, ys):
            acc += L * LOOK
            n = math.floor((acc + c) / U) - math.floor(c / U)
            if abs(((y0 - n * U - y) + 180) % 360 - 180) > 1e-6:
                ok = False
                break
        if ok:
            return k
    raise AssertionError('no yaw phase reproduces this trajectory')


def fit_respawn(d, traj, T):
    """After a goal's restart the server holds the player h frames and then
    runs the commands queued meanwhile in order: the first for M ms, the rest
    each for its own frame's msec (17/17/14; T3 found a 14 ms one, which 16
    put 2 units off in language_select_described_object seed 28; the fit
    below still steps them 16 ms, which only matters when the first queued
    command does not move; PROGRESS.md U04, T3). h is read off the oracle as the frames
    until the player first moves (at most 3); M is fitted to that first moved
    position with the double-precision prototype. A respawn followed only by
    look actions never shows its hold, and takes the play default (0, 17)."""
    import pmove_fit as pf
    # A box level (rooms) has no text layout: fit in an open room.
    walls = pf.walls_of(d['start']['layout']) if d['start']['layout'] else ([[False]], 1, 1)
    tp = traj[T]['pos']
    j = None
    for q in range(T + 1, min(T + 5, len(traj))):
        if 'pos' in traj[q] and traj[q]['pos'][:2] != tp[:2]:
            j = q
            break
    if j is None:
        return 0, 17
    h = j - T - 1
    best = None
    for M in range(0, 321):
        st = dict(x=tp[0], y=tp[1], vx=0.0, vy=0.0, yaw=0.0)
        for q in range(T + 1, j + 1):
            a = list(d['action_set'][traj[q]['a']][1]); a[0] = 0
            st['yaw'] = traj[q]['rot'][1]
            left = M if q == T + 1 else 16
            while left > 0:
                c = min(66, left)
                pf.step(st, a, c / 1000.0, pf.P, walls)
                left -= c
        e = math.hypot(st['x'] - traj[j]['pos'][0], st['y'] - traj[j]['pos'][1])
        key = (round(e, 3), abs(M - 17))
        if best is None or key < best[0]:
            best = (key, M)
    return h, best[1]


def compile_replay(d):
    out = {}
    s = d['start']
    for kind, traj in d['trajectories'].items():
        prev = s['pos']
        msec = []
        resp = []
        language = LEVELS.get(d['level'], {}).get('kind') == 'language'
        tps = set(lang_restarts(traj) if language else teleports(traj))
        for i, r in enumerate(traj):
            if 'pos' not in r:
                break
            if i in tps:
                # The frame a goal teleports the player: the new pose is data.
                h, M = fit_respawn(d, traj, i)
                base = U * round(r['rot'][1] / U)
                ev = {'frame': r['f'], 'pos': r['pos'], 'rot': r['rot'][1], 'hold': h, 'catch': M,
                      'yaw_phase': yaw_phase(base, d['action_set'], traj, i + 1)}
                # What the restarted map holds (doors, items), from the
                # entity log as of this frame: the newest start index.
                snap = [rr.get('entities') for rr in traj[:i + 1] if rr.get('entities')]
                if language:
                    ents = entities(snap[-1])
                    last = max(e['start'] for e in ents)
                    log = [rr.get('pickups') for rr in traj[:i + 1] if rr.get('pickups')]
                    rounds = lang_rounds_of(log[-1] if log else s['pickups'])
                    instr = [rr.get('instr') for rr in traj[:i + 1] if rr.get('instr')]
                    maps = [rr.get('map') for rr in traj[:i + 1] if rr.get('map')]
                    flo = [rr.get('floors') for rr in traj[:i + 1] if rr.get('floors')]
                    mname = lang_map_name(maps[-1] if maps else s['map'], last)
                    ins = instr[-1] if instr else s['instr']
                    vr = pad_text(*TABLE[mname][:2])[1].rstrip('\n').split('\n')
                    items, counting = lang_items([e for e in ents if e['start'] == last],
                                                 rounds[last - 1], IDX, SIZES, ins, vr)
                    ev['lang'] = {'instr': ins, 'items': items, 'count': 1 if counting else 0,
                                  'map': mname,
                                  'floors': lang_floors(flo[-1] if flo else s.get('floors', ''), last)}
                    snap = None
                if snap:
                    ents = entities(snap[-1])
                    last = max(e['start'] for e in ents)
                    H = len(s['layout'].rstrip('\n').split('\n'))
                    cats = categories(d, IDX, SIZES)
                    order = sorted(cats)
                    c = contents([e for e in ents if e['start'] == last], H, cats)
                    ev['doors'] = c['doors']
                    ev['items'] = [[x, y, order.index(k)] for x, y, k in c['items']]
                resp.append(ev)
                msec.append(None)
            else:
                msec.append(msec_of(prev, traj[i - 1] if i > 0 else None, r))
            prev = r['pos']
        # Unknown frames (slow) continue the 17,17,14 cycle from the last known
        # one; before the first known frame, count back from it.
        known = [i for i, m in enumerate(msec) if m is not None]
        if known:
            for i in range(len(msec)):
                if msec[i] is None:
                    j = min(known, key=lambda k: (abs(k - i), k))
                    phase = _cycle_phase(msec, j)
                    msec[i] = (17, 17, 14)[(phase + (i - j)) % 3]
        else:
            msec = [(17, 17, 14)[i % 3] for i in range(len(msec))]
        out[kind] = {'msec': msec, 'yaw_phase': yaw_phase(s['rot'][1], d['action_set'], traj),
                     'respawns': resp}
    return out


def _cycle_phase(msec, j):
    """Position of frame j in the 17,17,14 cycle, from its neighbours."""
    if msec[j] == 14:
        return 2
    prev = msec[j - 1] if j > 0 else None
    return 1 if prev == 17 else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    global IDX, SIZES
    idx = IDX = atlas_index(a.level)
    SIZES = sprite_sizes()
    files = sorted((HERE / 'reference' / 'dumps' / a.level).glob('*.json'), key=lambda p: int(p.stem))
    seeds, replay = [], {}
    language = LEVELS[a.level]['kind'] == 'language'
    global TABLE, LANGUAGE
    LANGUAGE = language
    table = TABLE = lang_map_table(files) if language else {}
    for f in files:
        d = json.loads(f.read_text())
        if language:
            # DMLab builds a map once per name and reuses it for later episodes
            # in the same process (the dumper's): a reused map logs no theme,
            # and shows the one it was built with (lang_map_table).
            _, d['start']['variation'], d['start']['theme'] = table[lang_map_name(d['start']['map'], 1)]
            d = lang_pad(d)
        seeds.append(compile_seed(d, idx, SIZES))
        replay[str(d['seed'])] = compile_replay(d)
    spec = LEVELS[a.level]
    level = {'name': a.level, 'kind': spec['kind'], 'episode_seconds': spec['seconds'], 'sky': SKY_RGB,
             'doors_closed': spec.get('doors_closed', 0.0), 'pickup_density': spec.get('pickup_density', 0.5),
             'goal_tile': idx['sprite/goal_object_02'], 'goal_size': SIZES['sprite/goal_object_02'],
             'door_tile': idx[DOOR_TEXTURE], 'seeds': seeds}
    if spec['kind'] == 'language':
        # play mode's object generator: tiles per shape and pattern, named colours
        cols = spec.get('colours', sorted(LANG_COLORS_HSL))
        maps = {}
        for name, (lay, var, theme) in sorted(table.items()):
            lay, var = pad_text(lay, var)
            maps[name] = grid_of(lay, var, pad_theme(theme), idx, name)
        # a placeholder floor's tile -> its room letter and its colour composites
        ftiles = {}
        for v in '0ABCDEF':
            base = f'map/lab_games/lg_style_01_floor_placeholder_{v}'
            if base in idx:
                ftiles[str(idx[base])] = {'region': v, 'colours': {
                    c: idx[f'composite/lg_style_01_floor_placeholder_{v}#{c}'] for c in cols}}
        level['lang'] = {
            'task': spec.get('task', 'described'),
            'tiles': {f'{sh}__{pat}': [idx[f'sprite/hr_{sh}__{pat}']] + SIZES[f'sprite/hr_{sh}__{pat}']
                      for sh in spec['shapes'] for pat in spec['patterns']},
            'colors': {n: hsl_rgb(*LANG_COLORS_HSL[n]) for n in sorted(cols)},
            # each model's scale, as the hrp module gives it (every CREATE in the dumps)
            'scales': lang_scales(files),
            'goal_reward': LANG_GOAL_REWARD,
            'maps': maps, 'floor_tiles': ftiles}
    js = ('// GENERATED by tools/compile_level.py from reference/dumps/%s. DO NOT EDIT.\n'
          '// Layouts, textures and placements DMLab generated: data, not code.\n'
          'const DM_LEVEL = %s;\n' % (a.level, json.dumps(level, separators=(',', ':'))))
    rp = json.dumps(replay, separators=(',', ':')) + '\n'
    outs = [(HERE / 'src' / 'levels' / f'{a.level}.js', js), (HERE / 'games' / f'{a.level}.replay.json', rp)]
    if a.check:
        stale = [str(p) for p, t in outs if not p.exists() or p.read_text() != t]
        print('stale: ' + ', '.join(stale) if stale else 'compiled data up to date')
        sys.exit(1 if stale else 0)
    for p, t in outs:
        p.write_text(t)
        print(p, len(t))


if __name__ == '__main__':
    main()
