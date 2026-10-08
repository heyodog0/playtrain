"""Compile the rooms levels' oracle dumps and map sources into port data.

    uv run --no-sync python tools/compile_rooms.py rooms_collect_good_objects_train [--check]

Writes src/levels/<level>.js (const DM_LEVEL) and games/<level>.replay.json,
like tools/compile_level.py does for the explore family, but the geometry is
a list of boxes: the brushes of the level's .map source (games/dmlab_assets/
maps, CC BY 4.0), each with a texture and UV map per face for rs_maze_boxes,
and the solid ones as collision rectangles.

FRAMES. Collision rectangles stay in DMLab world units (x east, y north).
Render boxes are in the primitive's frame: x = X/100, y = Z/100, z = -Y/100.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parents[4]
ASSETS = REPO / 'games' / 'dmlab_assets'
sys.path.insert(0, str(HERE / 'tools'))
import compile_level as cl  # noqa: E402
import dmlab_atlas  # noqa: E402
import mapsrc  # noqa: E402
import sprites  # noqa: E402

SKY_RGB = 0x89D7FF
# Surfaces that draw nothing (rays pass) and whether they collide.
INVISIBLE = {'map/ghost': False, 'map/poltergeist': True}
SKY_PREFIX = 'map/lab_games/sky/'
# Only Quake `skyparms` shaders are sky (rays pass, rs_maze_sky draws the cube
# there); other textures under SKY_PREFIX (em_non_match's lg_sky_02 room) are
# plain images on solid brushes.
SKY_SHADERS = {SKY_PREFIX + 'lg_sky_01', SKY_PREFIX + 'lg_sky_03'}
# rooms_collect_good_objects_factory.lua REPLACE_TEXTURE_MAP, by shader.
REPLACE = {'map/lab_games/lg_style_01_floor_orange': 'map/lab_games/lg_style_02_floor_blue_bright',
           'map/lab_games/lg_style_01_wall_green': 'map/lab_games/lg_style_05_wall_red_bright'}
LEVELS = {
    'rooms_collect_good_objects_train': dict(kind='collect', seconds=60),
    'rooms_collect_good_objects_test': dict(kind='collect', seconds=60),
    'rooms_exploit_deferred_effects_train': dict(kind='exploit', seconds=60),
    'rooms_exploit_deferred_effects_test': dict(kind='exploit', seconds=60),
    'rooms_select_nonmatching_object': dict(kind='nonmatch', seconds=12),
    'rooms_keys_doors_puzzle': dict(kind='keys', seconds=60),
    'skymaze_irreversible_path_hard': dict(kind='sky', seconds=60),
    'skymaze_irreversible_path_varied': dict(kind='sky', seconds=60),
    'rooms_watermaze': dict(kind='water', seconds=120),
}
# skymaze_factory.lua: a platform of letter c stands MAX_HEIGHT - (c - 'a') =
# 40 - k units of 20 high (oracle: 'a' tops at 800); '.' is void, walled off
# by invisible columns. Drawn as slabs one step deep: the variation's floor on
# top, the theme's default riser on the sides (themes.lua, read as spec).
# The variation layer is all '.', but the theme names one variation per
# platform height: height k (letter 'a' + k) is variation chr(ord('(') - k).
# Measured on all 64 dumped seeds (every height's key is there, no other key);
# it is what gives DMLab's platforms their different floors (V6).
SKY_STEP = 20.0
SKY_RISER = 'map/lab_games/lg_style_02_wall_blue'
# Quake's teleporter: the player arrives facing the destination's angle,
# moving 400 units/s that way, 1 unit above it.
TELEPORT_SPEED = 400
LEVEL_NAME = ['']
# map/script_highlight, painted by the exploit factory (games/dmlab_assets
# synthetic tiles): dark unless the door starts open; the box brightens it.
FLOOR = {'dark': 'synthetic/script_highlight_dark', 'bright': 'synthetic/script_highlight_bright'}
# A func_door with angle -1 rises; it travels its height less Quake's default
# lip of 8 units.
DOOR_LIP = 8
FACE_ORDER = ['xn', 'xp', 'zn', 'zp', 'yp', 'yn']   # primitive -x, +x, -y, +y, -z, +z


def tex_sizes():
    man = json.loads((ASSETS / 'manifest.json').read_text())
    return {e['shader']: e['size'] for e in man['files'] if e.get('shader') and e.get('size')}


# Unscaled script_highlight faces (scale 0 = 1) over an 8x8 image.



def box_record(b, idx, sizes, replace):
    lo, hi = b['min'], b['max']
    rec = [lo[0] / 100, lo[2] / 100, -hi[1] / 100, hi[0] / 100, hi[2] / 100, -lo[1] / 100]
    for face in FACE_ORDER:
        name = b['tex'][face]
        name = replace.get(name, name)
        if name in INVISIBLE or name in SKY_SHADERS or name not in idx:
            if name not in INVISIBLE and name not in SKY_SHADERS:
                raise KeyError(f'no atlas tile for surface {name}')
            rec += [-1.0] + [0.0] * 8
            continue
        sv, tv, shift = mapsrc.texture_vectors(b['texinfo'][face])
        W, H = sizes[name]
        # texture s at world P = dot(P, sv) + shift_s; P = (100x, -100z, 100y).
        au = [100 * sv[0] / W, 100 * sv[2] / W, -100 * sv[1] / W, shift[0] / W]
        av = [100 * tv[0] / H, 100 * tv[2] / H, -100 * tv[1] / H, shift[1] / H]
        rec += [float(idx[name])] + au + av
    return rec


def solid(b):
    return any(t not in INVISIBLE or INVISIBLE[t] for t in b['tex'].values()) and not all(
        t in INVISIBLE and not INVISIBLE[t] for t in b['tex'].values())


def compile_map(name, idx, sizes, replace):
    ents, brushes, bad = mapsrc.parse((ASSETS / 'maps' / f'{name}.map').read_text())
    assert bad == 0, f'{name}: {bad} non-axial brushes'
    world = [b for b in brushes if ents[b['entity']].get('classname') == 'worldspawn']
    boxes = []
    for b in world:
        boxes += box_record(b, idx, sizes, replace)
    solids = [[b['min'][0], b['min'][1], b['max'][0], b['max'][1], b['min'][2], b['max'][2]] for b in world if solid(b)]
    doors = []
    for b in brushes:
        e = ents[b['entity']]
        if e.get('classname') == 'func_door':
            assert e.get('angle') == '-1', 'only rising doors are modelled'
            doors.append({'box': [round(v, 7) for v in box_record(b, idx, sizes, replace)],
                          'solid': [b['min'][0], b['min'][1], b['max'][0], b['max'][1], b['min'][2], b['max'][2]],
                          'rise': b['max'][2] - b['min'][2] - DOOR_LIP, 'targetname': e.get('targetname')})
    teleports = []
    for b in brushes:
        e = ents[b['entity']]
        if e.get('classname') == 'trigger_teleport':
            dest = [x for x in ents if x.get('classname') == 'misc_teleporter_dest' and x.get('targetname') == e.get('target')][0]
            ox, oy, oz = (float(v) for v in dest['origin'].split())
            teleports.append({'min': b['min'], 'max': b['max'], 'dest': [ox, oy, oz + 1], 'yaw': float(dest.get('angle', 0))})
    return {'boxes': [round(v, 7) for v in boxes], 'solids': solids, 'doors': doors, 'teleports': teleports}


# rooms_watermaze (navigate_watermaze_factory.lua, read as spec; timing from
# reference/oracle/probe_watermaze.py): em_watermaze is a 16-sided arena of
# wedge-shaped wall brushes (non-axial), a glass floor (map/water_d, solid,
# translucent) at 16 over the floor at 0, and a hidden platform: an octagon
# 64 across its flats under the glass, raised when the player's box touches
# its (invisible) button. Walls collide with their own planes and are drawn as
# their own faces (rs_maze_quads), the landmarks as flat pictures on them.
WATER_BODY = (-24.0, 32.0)        # the player's box about its origin, z
LANDMARK_SCALE = 0.5


def _wall_quad(ends, zlo, zhi, tex, info, idx, sizes):
    """A vertical face as a rs_maze_quads record (mode 0), in the primitive's
    frame (x = X/100, z = -Y/100, y = Z/100), its UV the face's own texinfo:
    texture pixel s at P is dot(P, s_vec) + shift_s, one tile W x H pixels."""
    import mapsrc
    sv, tv, shift = mapsrc.texture_vectors(info)
    W, H = sizes[tex]
    (ax, ay), (bx, by) = ends
    us = [(sv[0] * x + sv[1] * y + shift[0]) / W for x, y in ends]
    vt = (tv[0] * ax + tv[1] * ay + tv[2] * zhi + shift[1]) / H
    vb = (tv[0] * ax + tv[1] * ay + tv[2] * zlo + shift[1]) / H
    return [ax / 100, -ay / 100, bx / 100, -by / 100, zlo / 100, zhi / 100,
            float(idx[tex]), us[0], us[1], vt, vb, 0.0]


def _zrange(faces):
    lo, hi = -1e9, 1e9
    for n, dist, _, _ in faces:
        if abs(n[2]) > 0.999:
            if n[2] > 0:
                hi = min(hi, dist)
            else:
                lo = max(lo, -dist)
    return lo, hi


def _pseudo_box(lo, hi, tex_by_face, info):
    """A box_record input: one texture per face, its projection the
    brush face's own texinfo seen along each box face's axis."""
    normals = {'xp': (1, 0, 0), 'xn': (-1, 0, 0), 'yp': (0, 1, 0), 'yn': (0, -1, 0), 'zp': (0, 0, 1), 'zn': (0, 0, -1)}
    return {'min': lo, 'max': hi, 'tex': tex_by_face,
            'texinfo': {f: dict(info, normal=normals[f]) for f in normals}}


def compile_water_map(name, idx, sizes):
    import mapsrc
    ents, brushes = mapsrc.parse_planes((ASSETS / 'maps' / f'{name}.map').read_text())
    world = [b for b in brushes if ents[b['entity']].get('classname') == 'worldspawn']
    glass = [b for b in world if all(f[2] == 'map/water_d' for f in b['faces'])]
    stand = max(_zrange(b['faces'])[1] for b in glass) + 24.125
    boxes, polys, quads = [], [], []
    for b in world:
        zlo, zhi = _zrange(b['faces'])
        texs = sorted(set(f[2] for f in b['faces']))
        if b in glass:
            if b is glass[0]:
                # drawn once, opaque, as the glass over the floor under it
                # mapped as the floor under it is (the composite's base)
                fl = [x for x in world if {f[2] for f in x['faces']} == {'map/lab_games/lg_style_01_floor_blue'}][0]
                face = [f for f in fl['faces'] if abs(f[0][2]) > 0.999 and f[0][2] > 0][0]
                tex = {k: 'map/ghost' for k in ('xp', 'xn', 'yp', 'yn', 'zp', 'zn')}
                tex['zp'] = 'composite/water_d_over_lg_style_01_floor_blue'
                boxes += box_record(_pseudo_box([-768.0, -768.0, zlo], [768.0, 768.0, zhi], tex, face[3]), idx, sizes, {})
            continue
        if texs == ['map/lab_games/lg_style_01_floor_blue'] or texs == ['map/lab_games/fake_sky']:
            # the floor (top at 0) and the sky lid: one box across the arena,
            # only the face toward the arena drawn
            top = texs == ['map/lab_games/fake_sky']
            face = [f for f in b['faces'] if abs(f[0][2]) > 0.999 and (f[0][2] < 0 if top else f[0][2] > 0)][0]
            tex = {k: 'map/ghost' for k in ('xp', 'xn', 'yp', 'yn', 'zp', 'zn')}
            tex['zn' if top else 'zp'] = face[2]
            boxes += box_record(_pseudo_box([-768.0, -768.0, zlo], [768.0, 768.0, zhi], tex, face[3]), idx, sizes, {})
            continue
        poly = mapsrc.polygon2d(b['faces'], (zlo + zhi) / 2)
        if not poly:
            continue
        xs, ys = [q[0] for q in poly], [q[1] for q in poly]
        # collision: Quake's axial bevels first (-x, +x, -y, +y), then the
        # brush's own non-axial sides, each pushed out by the player's +-15
        h = 15.0
        pl = [-1.0, 0.0, -(min(xs) - h), 1.0, 0.0, max(xs) + h, 0.0, -1.0, -(min(ys) - h), 0.0, 1.0, max(ys) + h]
        inner = None
        for n, dist, t, info in b['faces']:
            if abs(n[2]) > 1e-9 or abs(abs(n[0]) - 1) < 1e-9 or abs(abs(n[1]) - 1) < 1e-9:
                continue
            pl += [n[0], n[1], dist + h * (abs(n[0]) + abs(n[1]))]
            # the face toward the arena centre carries the wall's look
            if dist < 0 and (inner is None or dist < inner[1]):
                inner = (n, dist, t, info)
        polys.append({'z': [zlo, zhi], 'planes': [round(v, 7) for v in pl]})
        # drawing: every vertical face of the brush that looks into the arena,
        # as one textured quad (rs_maze_quads) mapped by the face's own texinfo
        for n, dist, t, info in b['faces']:
            if abs(n[2]) > 1e-9:
                continue
            ends = [q for q in poly if abs(n[0] * q[0] + n[1] * q[1] - dist) < 1e-3]
            if len(ends) != 2:
                continue
            mx, my = (ends[0][0] + ends[1][0]) / 2, (ends[0][1] + ends[1][1]) / 2
            if n[0] * -mx + n[1] * -my <= 0:
                continue    # faces away from the centre: never seen
            quads += _wall_quad(ends, zlo, min(zhi, 192.0), t, info, idx, sizes)
    # the platform: its panel brush (an octagon, top 94 raised, 96 lower when
    # down), drawn as a cross of two boxes and a centre square
    plat = [b for b in brushes if ents[b['entity']].get('classname') == 'func_plat'][0]
    pz = _zrange(plat['faces'])
    pinfo = plat['faces'][0]
    ptex = plat['faces'][0][2]
    plat_boxes = []
    for lo, hi in (([-64.0, -26.0], [64.0, 26.0]), ([-26.0, -64.0], [26.0, 64.0]), ([-45.0, -45.0], [45.0, 45.0])):
        tex = {k2: ptex for k2 in ('xp', 'xn', 'yp', 'yn', 'zp', 'zn')}
        plat_boxes += box_record(_pseudo_box(lo + [pz[0]], hi + [pz[1]], tex, pinfo[3]), idx, sizes, {})
    plat_ent = ents[plat['entity']]
    landmarks = []
    for e in ents:
        if e.get('classname') != 'misc_model':
            continue
        key = 'sprite/' + Path(e['model']).stem
        w, hgt = sizes[key]
        sc = float(e.get('modelscale', 1))
        ox, oy, oz = (float(v) for v in e['origin'].split())
        # the picture faces the arena (the model's -x), 25 x modelscale
        # out from its origin on the wall
        import math
        ang = math.radians(float(e.get('angle', 0)))
        ox, oy = ox - 25 * sc * math.cos(ang), oy - 25 * sc * math.sin(ang)
        # a flat picture across the model's width: seen from the arena, its
        # right is the model's -y, i.e. world (sin a, -cos a)
        half = w * sc * 50
        rx, ry = math.sin(ang), -math.cos(ang)
        a = (ox - rx * half, oy - ry * half)
        b2 = (ox + rx * half, oy + ry * half)
        z0 = oz - hgt * sc * 50
        landmarks += [a[0] / 100, -a[1] / 100, b2[0] / 100, -b2[1] / 100, z0 / 100, (z0 + hgt * sc * 100) / 100,
                      float(idx[key]), 0.0, 1.0, 0.0, 1.0, 1.0]
    spawns = [[float(v) for v in e['origin'].split()] for e in ents if e.get('classname') == 'info_player_start']
    return {'boxes': [round(v, 7) for v in boxes], 'solids': [], 'polys': polys, 'doors': [], 'teleports': [],
            'quads': [round(v, 7) for v in quads + landmarks],
            'stand_z': stand, 'plat_boxes': [round(v, 7) for v in plat_boxes], 'plat_rise': float(plat_ent['height']),
            'plat_top': pz[1], 'spawns': spawns}


def compile_water_seed(d, idx, sizes):
    sd = compile_seed(d, idx, sizes)
    s = d['start']
    plat = [e for e in cl.entities(s['entities']) if e['start'] == 1 and e['class'] == 'func_plat'][0]
    sd['platform'] = [plat['x'], plat['y']]
    # A spawn above the glass is still falling when the episode starts: its
    # speed then, from the first frame's fall (gravity 800, 14 or 17 ms).
    r0 = d['trajectories']['script'][0]
    vz = 0.0
    if r0['vel'][2] != 0:
        dz = r0['pos'][2] - s['pos'][2]
        best = None
        for ms in (14, 17):
            dt = ms / 1000.0
            v0 = round(r0['vel'][2] + 800.0 * dt)
            e = abs((v0 - 400.0 * dt) * dt - dz)
            if best is None or e < best[0]:
                best = (e, v0)
        vz = float(best[1])
    sd['spawn_vz'] = vz
    return sd


def rooms_replay(d, maps):
    """compile_level.compile_replay's timing and yaw phase, plus the events a
    box level has: a trigger teleport (position jumps right after a +1) and a
    restart (position jumps to the spawn). Teleports: the oracle's arrival
    shows how long it moved there, M = displacement / 400 (in the air nothing
    slows it). Restarts: the hold and catch-up of compile_level.fit_respawn,
    in an open room."""
    import math
    out = cl.compile_replay(d)
    s = d['start']
    for kind, traj in d['trajectories'].items():
        ev = []
        prev = s['pos']
        for i, r in enumerate(traj):
            if 'pos' not in r:
                break
            jump = math.hypot(r['pos'][0] - prev[0], r['pos'][1] - prev[1])
            if jump > 60 and i >= 1:
                rew = [q.get('r') for q in traj[max(0, i - 4):i + 1] if q.get('r')]
                if rew and rew[-1] == 1.0:
                    tp = maps['teleports'][0]
                    a = math.radians(tp['yaw'])
                    disp = (r['pos'][0] - tp['dest'][0]) * math.cos(a) + (r['pos'][1] - tp['dest'][1]) * math.sin(a)
                    # The arrival frame's yaw already carries that frame's look
                    # (as a respawn's does): it is the base, rounded to Quake units.
                    base = cl.U * round(r['rot'][1] / cl.U)
                    rf = [q['f'] for q in traj[max(0, i - 4):i + 1] if q.get('r') == 1.0][-1]
                    ev.append({'frame': r['f'], 'kind': 'teleport', 'ms': round(disp / TELEPORT_SPEED * 1000),
                               'reward_frame': rf,
                               'rot': r['rot'][1], 'yaw_phase': cl.yaw_phase(base, d['action_set'], traj, i + 1)})
                else:
                    h, M = cl.fit_respawn(dict(d, start=dict(s, layout='')), traj, i)
                    base = cl.U * round(r['rot'][1] / cl.U)
                    ev.append({'frame': r['f'], 'kind': 'restart', 'pos': r['pos'], 'rot': r['rot'][1], 'hold': h,
                               'catch': M, 'yaw_phase': cl.yaw_phase(base, d['action_set'], traj, i + 1)})
            prev = r['pos']
        out[kind]['respawns'] = [e for e in ev if e['kind'] == 'restart']
        out[kind]['teleports'] = [e for e in ev if e['kind'] == 'teleport']
    return out


def created(d):
    """classname -> (model, tint, quantity) from the dump's CREATE lines."""
    out = {}
    for line in d['start'].get('pickups', '').split('\n'):
        if not line.startswith('CREATE '):
            continue
        cls = line.split(' ')[1]
        kv = dict(x.split('=', 1) for x in line.split(' ')[2:] if '=' in x)
        model, tint = kv['model'], None
        if ':' in model:
            prefix, model = model.split(':', 1)
            tint = prefix[len('color_key_'):] if prefix.startswith('color_key_') else None
        if model.endswith('hr_ice_lolly_lrg.md3'):
            tint = 'goalorange'
        if model.endswith('hr_cake.md3') and 'exploit_deferred' in LEVEL_NAME[0]:
            tint = 'exploitcake'
        out[cls] = (model, tint, float(kv['quantity']))
    return out


def config(d):
    out = {}
    for line in d['start'].get('map', '').split('\n'):
        if line.startswith('CONFIG '):
            _, k, v = line.split(' ')
            out[k.lstrip('_')] = v == 'true'
        if line.startswith('NEXTMAP 1 '):
            out['map'] = line.split(' ', 2)[2]
    return out


def compile_seed(d, idx, sizes):
    s = d['start']
    cfg = config(d)
    made = created(d)
    order = sorted(made)
    cats = []
    for k in order:
        model, tint, q = made[k]
        key = 'sprite/' + sprites.model_key(model, tint)
        w, h = sizes[key]
        # exploit_deferred_effects: picking up the box fires its target, the door.
        trigger = 'box_door' if k == 'box' else None
        cats.append([idx[key], w, h, q, trigger])
    ents = [e for e in cl.entities(s['entities']) if e['start'] == 1]
    items = [[e['x'], e['y'], order.index(e['class'])] for e in ents if e['class'] in made]
    key = cfg['map'] + ('+replace' if cfg.get('replaceWallAndFloor') else '')
    return {'seed': d['seed'], 'map': key,
            'spawn': [s['pos'][0], s['pos'][1], s['pos'][2], s['rot'][1]], 'items': items, 'cats': cats,
            'config': cfg}


# rooms_keys_doors_puzzle: a TEXT map (make_map, INVISIBLE_WALLS) - so the
# explore family's grid physics, with the walls drawn as nothing. Rendered as
# boxes: the floor of every open cell (lg_style_01_floor_orange) and each
# closed fence door as a slab in its colour. Under the invisible walls the
# oracle mostly shows the sky through the floor: a dark floor there (map/black_d)
# measured G6 MAE 46.2 against 24.7 without (V4).
KEYS_FLOOR = 'map/lab_games/lg_style_01_floor_orange'
FENCE_LO, FENCE_HI = 46.0, 54.0          # closed fence door slab within its cell (oracle stops)
FENCE_HEIGHT = 100.0


def _flat_box(x0, y0, x1, y1, z0, z1, tile, size, top_only=True):
    """A box in world units with one tile; the top face mapped 1 repeat per 100 units."""
    rec = [x0 / 100, z0 / 100, -y1 / 100, x1 / 100, z1 / 100, -y0 / 100]
    for face in FACE_ORDER:
        if tile is None or (top_only and face != 'zp'):
            rec += [-1.0] + [0.0] * 8
            continue
        # u along x, v along -y (world), one repeat per cell
        rec += [float(tile), 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    return rec


def compile_keys_seed(d, idx, sizes):
    s = d['start']
    lines = s['map'].split('\n')
    rows = []
    for ln in lines[1:]:
        if not ln.strip():
            break
        rows.append(ln)
    H, W = len(rows), max(len(r) for r in rows)
    floor_z = s['pos'][2] - 24.0
    boxes = []
    for r in range(H):
        c = 0
        while c < W:
            wall = rows[r][c] == '*'
            c2 = c
            while c2 + 1 < W and (rows[r][c2 + 1] == '*') == wall:
                c2 += 1
            if not wall:
                boxes += _flat_box(c * 100, (H - 1 - r) * 100, (c2 + 1) * 100, (H - r) * 100,
                                   floor_z - 8, floor_z, idx[KEYS_FLOOR], None)
            c = c2 + 1
    colours = {}
    for ln in lines:
        if ln.startswith('DOORCOLOR '):
            _, name, col = ln.split(' ')
            colours[name] = col
    ents = [e for e in cl.entities(s['entities']) if e['start'] == 1]
    doors = []
    for e in ents:
        if e['class'] == 'func_door':
            _, c, k = e['targetname'].split('_')
            r = H - 1 - int(k)
            col = colours[e['targetname']]
            x0, y0 = int(c) * 100, (H - 1 - r) * 100
            if rows[r][int(c)] == 'H':
                slab = (x0, y0 + FENCE_LO, x0 + 100, y0 + FENCE_HI)
            else:
                slab = (x0 + FENCE_LO, y0, x0 + FENCE_HI, y0 + 100)
            rec = _flat_box(slab[0], slab[1], slab[2], slab[3], floor_z, floor_z + FENCE_HEIGHT,
                            idx['synthetic/door_' + col], None, top_only=False)
            doors.append([r, int(c), 0, col, [round(v, 7) for v in rec]])
    made = created(d)
    order = sorted(made)
    cats = []
    for k in order:
        model, tint, q = made[k]
        key = 'sprite/' + sprites.model_key(model, tint)
        w, h = sizes[key]
        colour = k[len('color_key_'):] if k.startswith('color_key_') else None
        cats.append([idx[key], w, h, q, colour])
    items = [[e['x'], e['y'], order.index(e['class'])] for e in ents if e['class'] in made]
    return {'seed': d['seed'], 'w': W, 'h': H, 'rows': rows, 'doors': [x[:3] for x in doors],
            'door_colours': [x[3] for x in doors], 'door_boxes': [x[4] for x in doors],
            'floor_boxes': [round(v, 7) for v in boxes], 'floor_z': floor_z,
            'spawn': [s['pos'][0], s['pos'][1], s['pos'][2], s['rot'][1]], 'items': items, 'cats': cats,
            'goal': None, 'pcells': [], 'acells': [], 'decals': [],
            'wall': [0xFFFF] * (W * H), 'floor': [0xFFFF] * (W * H)}


def compile_sky_seed(d, idx, sizes):
    s = d['start']
    rows = s['layout'].rstrip('\n').split('\n')
    H, W = len(rows), max(len(r) for r in rows)
    var, _ = cl.parse_theme(s['theme'])

    def floor_tex(ch):
        key = 'default' if ch == '.' else ch
        return (var.get(key) or var.get('default') or var[sorted(var)[0]])['floor']

    def height_var(ch):
        return chr(ord('(') - (ord(ch) - 97)) if ch != '.' else '.'
    tops = []
    for r in range(H):
        for c in range(W):
            ch = rows[r][c]
            tops.append(-1.0 if ch == '.' else (40 - (ord(ch) - 97)) * SKY_STEP)
    boxes = []
    for r in range(H):
        c = 0
        while c < W:
            t = tops[r * W + c]
            vch = height_var(rows[r][c])
            c2 = c
            while c2 + 1 < W and tops[r * W + c2 + 1] == t:
                c2 += 1
            if t >= 0:
                rec = [c * 1.0, (t - SKY_STEP) / 100, -(H - r) * 1.0, (c2 + 1) * 1.0, t / 100, -(H - 1 - r) * 1.0]
                for face in FACE_ORDER:
                    tile = idx[floor_tex(vch)] if face == 'zp' else (-1.0 if face == 'zn' else idx[SKY_RISER])
                    if face == 'zp':      # top: u = x, v = z, one repeat per cell
                        rec += [float(tile), 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
                    elif tile == -1.0:    # underside: never seen
                        rec += [-1.0] + [0.0] * 8
                    else:                 # sides: u along the face, v down one repeat per step
                        rec += [float(tile), 1.0, 0.0, 1.0, 0.0, 0.0, -5.0, 0.0, 0.0]
                boxes += rec
            c = c2 + 1
    ents = [e for e in cl.entities(s['entities']) if e['start'] == 1]
    goal = [e for e in ents if e['class'] == 'goal'][0]
    key = 'sprite/goal_object_03'
    cats = [[idx[key], sizes[key][0], sizes[key][1], 100.0, None]]
    return {'seed': d['seed'], 'w': W, 'h': H, 'rows': rows, 'tops': tops, 'sky_boxes': [round(v, 7) for v in boxes],
            'spawn': [s['pos'][0], s['pos'][1], s['pos'][2], s['rot'][1]],
            'items': [[goal['x'], goal['y'], 0]], 'item_z': [goal['z']], 'cats': cats,
            'goal': None, 'doors': [], 'pcells': [], 'acells': [], 'decals': [],
            'wall': [0xFFFF] * (W * H), 'floor': [0xFFFF] * (W * H)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    spec = LEVELS[a.level]
    LEVEL_NAME[0] = a.level
    _, names = dmlab_atlas.build(a.level)
    idx = {n: i for i, n in enumerate(names)}
    sizes = tex_sizes()
    sizes.update(cl.sprite_sizes())
    files = sorted((HERE / 'reference' / 'dumps' / a.level).glob('*.json'), key=lambda p: int(p.stem))
    seeds, replay, maps = [], {}, {}
    for f in files:
        d = json.loads(f.read_text())
        if spec['kind'] in ('keys', 'sky'):
            seeds.append((compile_keys_seed if spec['kind'] == 'keys' else compile_sky_seed)(d, idx, sizes))
            replay[str(d['seed'])] = cl.compile_replay(d)
            continue
        if spec['kind'] == 'water':
            sd = compile_water_seed(d, idx, sizes)
            if sd['map'] not in maps:
                maps[sd['map']] = compile_water_map(sd['map'], idx, sizes)
            seeds.append(sd)
            replay[str(d['seed'])] = rooms_replay(d, maps[sd['map']])
            continue
        sd = compile_seed(d, idx, sizes)
        if sd['map'] not in maps:
            base = sd['map'].split('+')[0]
            rep = REPLACE if sd['map'].endswith('+replace') else {}
            if spec['kind'] == 'exploit':
                for fl, tex in FLOOR.items():
                    maps[sd['map'] + '#' + fl] = compile_map(base, idx, sizes, dict(rep, **{'map/script_highlight': tex}))
            else:
                maps[sd['map']] = compile_map(base, idx, sizes, rep)
        seeds.append(sd)
        replay[str(d['seed'])] = rooms_replay(d, maps[sd['map']] if sd['map'] in maps else maps[sd['map'] + '#dark'])
    level = {'name': a.level, 'kind': spec['kind'], 'episode_seconds': spec['seconds'], 'sky': SKY_RGB,
             'seeds': seeds}
    if maps:
        level['maps'] = maps
    if spec['kind'] == 'keys':
        level['door_style'] = 'fence'
    js = ('// GENERATED by tools/compile_rooms.py from reference/dumps/%s and games/dmlab_assets/maps. DO NOT EDIT.\n'
          '// Geometry, placements and configs DMLab built: data, not code.\n'
          'const DM_LEVEL = %s;\n' % (a.level, json.dumps(level, separators=(',', ':'))))
    rp = json.dumps(replay, separators=(',', ':')) + '\n'
    outs = [(HERE / 'src' / 'levels' / f'{a.level}.js', js), (HERE / 'games' / f'{a.level}.replay.json', rp)]
    if a.check:
        stale = [str(p) for p, t in outs if not p.exists() or p.read_text() != t]
        print('stale: ' + ', '.join(stale) if stale else 'compiled data up to date')
        sys.exit(1 if stale else 0)
    for p, t in outs:
        p.write_text(t)
        print(p.name, len(t))


if __name__ == '__main__':
    main()
