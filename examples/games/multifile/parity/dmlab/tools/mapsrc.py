"""Parse DMLab's Quake 3 .map sources (//assets/maps/src, CC BY 4.0) into
axis-aligned boxes with a texture per face, plus the entity list.

    uv run --no-sync python tools/mapsrc.py <file.map>      # summary

A brush is the intersection of half-spaces, one per face line
"( p1 ) ( p2 ) ( p3 ) texture ...". The face plane's normal is
(p3 - p1) x (p2 - p1) normalised, pointing out of the brush (Quake's
winding). Every brush in the rooms maps is axis aligned; anything else is
reported, not approximated.
"""
import json
import re
import sys
from pathlib import Path

FACE = re.compile(r'\(\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\)\s*'
                  r'\(\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\)\s*'
                  r'\(\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\)\s*(\S+)'
                  r'\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)')
AXES = {(1, 0, 0): 'xp', (-1, 0, 0): 'xn', (0, 1, 0): 'yp', (0, -1, 0): 'yn', (0, 0, 1): 'zp', (0, 0, -1): 'zn'}


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def parse(text):
    """Returns (entities, brushes): entities as dicts of key/values, each
    brush as {'entity': index, 'min': [x,y,z], 'max': [...], 'tex': {face: texture}}."""
    text = re.sub(r'//[^\n]*', '', text)
    ents, brushes, nonaxial = [], [], 0
    depth = 0
    cur = None
    brush = None
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        if line == '{':
            depth += 1
            if depth == 1:
                cur = {}
                ents.append(cur)
            elif depth == 2:
                brush = []
            continue
        if line == '}':
            if depth == 2 and brush is not None:
                b = _box(brush)
                if b is None:
                    nonaxial += 1
                else:
                    b['entity'] = len(ents) - 1
                    brushes.append(b)
                brush = None
            depth -= 1
            continue
        if depth == 1:
            m = re.match(r'"([^"]*)"\s+"([^"]*)"', line)
            if m:
                cur[m.group(1)] = m.group(2)
        elif depth == 2:
            m = FACE.match(line)
            if m:
                v = [float(x) for x in m.groups()[:9]]
                tx = [float(m.group(k)) for k in range(11, 16)]   # shift s, shift t, rotate, scale s, scale t
                brush.append(((v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8]), m.group(10), tx))
    return ents, brushes, nonaxial


def parse_planes(text):
    """Every brush as its planes, whatever their orientation: a list of
    {'entity': index, 'faces': [(normal, dist, texture, texinfo)]}, normal
    unit and pointing out of the brush, the brush being dot(n, p) <= dist."""
    text = re.sub(r'//[^\n]*', '', text)
    ents, brushes, depth, cur, brush = [], [], 0, None, None
    for line in text.split('\n'):
        line = line.strip()
        if not line:
            continue
        if line == '{':
            depth += 1
            if depth == 1:
                cur = {}
                ents.append(cur)
            elif depth == 2:
                brush = []
            continue
        if line == '}':
            if depth == 2 and brush:
                brushes.append({'entity': len(ents) - 1, 'faces': brush})
            brush = None
            depth -= 1
            continue
        if depth == 1:
            m = re.match(r'"([^"]*)"\s+"([^"]*)"', line)
            if m:
                cur[m.group(1)] = m.group(2)
        elif depth == 2:
            m = FACE.match(line)
            if m:
                v = [float(x) for x in m.groups()[:9]]
                p1, p2, p3 = (v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8])
                n = _cross(_sub(p3, p1), _sub(p2, p1))
                ln = sum(c * c for c in n) ** 0.5
                n = tuple(c / ln for c in n)
                tx = [float(m.group(k)) for k in range(11, 16)]
                brush.append((n, sum(a * b for a, b in zip(n, p1)), m.group(10),
                              {'normal': n, 'shift': tx[0:2], 'rotate': tx[2], 'scale': tx[3:5]}))
    return ents, brushes


def polygon2d(faces, z):
    """The brush's cross-section at height z, as counter-clockwise (x, y)
    vertices (vertical faces only; [] if the brush does not reach z)."""
    poly = [(-1e5, -1e5), (1e5, -1e5), (1e5, 1e5), (-1e5, 1e5)]
    for n, d, _, _ in faces:
        if abs(n[2]) > 1e-9:
            if abs(n[0]) > 1e-9 or abs(n[1]) > 1e-9:
                raise ValueError('sloped face')
            if n[2] * z > d:
                return []
            continue
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            da, db = n[0] * a[0] + n[1] * a[1] - d, n[0] * b[0] + n[1] * b[1] - d
            if da <= 0:
                out.append(a)
            if (da < 0) != (db < 0) and da != db:
                t = da / (da - db)
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        poly = out
        if not poly:
            return []
    return poly


def _box(faces):
    lo = [-1e9] * 3
    hi = [1e9] * 3
    tex = {}
    texinfo = {}
    for p1, p2, p3, t, tx in faces:
        n = _cross(_sub(p3, p1), _sub(p2, p1))
        l = max(abs(c) for c in n)
        if l == 0:
            return None
        key = tuple(int(round(c / l)) if abs(abs(c) - l) < 1e-6 or c == 0 else 9 for c in n)
        if key not in AXES or sum(abs(k) for k in key) != 1:
            return None
        ax = [i for i in range(3) if key[i]][0]
        d = p1[ax]
        if key[ax] > 0:
            hi[ax] = min(hi[ax], d)
        else:
            lo[ax] = max(lo[ax], d)
        tex[AXES[key]] = t
        texinfo[AXES[key]] = {'normal': key, 'shift': tx[0:2], 'rotate': tx[2], 'scale': tx[3:5]}
    if any(lo[i] >= hi[i] for i in range(3)) or len(tex) != 6:
        return None
    return {'min': lo, 'max': hi, 'tex': tex, 'texinfo': texinfo}


# Quake 3's texture base axes: the face normal picks the closest of these
# (first wins ties), giving the world axes texture s and t run along.
BASE_AXES = [((0, 0, 1), (1, 0, 0), (0, -1, 0)), ((0, 0, -1), (1, 0, 0), (0, -1, 0)),
             ((1, 0, 0), (0, 1, 0), (0, 0, -1)), ((-1, 0, 0), (0, 1, 0), (0, 0, -1)),
             ((0, 1, 0), (1, 0, 0), (0, 0, -1)), ((0, -1, 0), (1, 0, 0), (0, 0, -1))]


def texture_vectors(info):
    """World-space (s_vec, t_vec, shift) of a face: texture pixel s at world
    point P is dot(P, s_vec) + shift_s (the Quake .map convention)."""
    import math
    n = info['normal']
    best = max(range(6), key=lambda i: (sum(a * b for a, b in zip(n, BASE_AXES[i][0])), -i))
    s, t = list(BASE_AXES[best][1]), list(BASE_AXES[best][2])
    ang = info['rotate']
    if ang % 90 == 0:
        k = int(round(ang / 90)) % 4
        sinv, cosv = [0, 1, 0, -1][k], [1, 0, -1, 0][k]
    else:
        sinv, cosv = math.sin(math.radians(ang)), math.cos(math.radians(ang))
    sv = [i for i in range(3) if s[i]][0]
    tv = [i for i in range(3) if t[i]][0]
    for vec in (s, t):
        ns = cosv * vec[sv] - sinv * vec[tv]
        nt = sinv * vec[sv] + cosv * vec[tv]
        vec[sv], vec[tv] = ns, nt
    sc = [x if x != 0 else 1.0 for x in info['scale']]
    return [c / sc[0] for c in s], [c / sc[1] for c in t], info['shift']


def main():
    ents, brushes, bad = parse(Path(sys.argv[1]).read_text())
    world = [b for b in brushes if b['entity'] == 0]
    print(len(ents), 'entities;', len(brushes), 'axial brushes (', len(world), 'world );', bad, 'non-axial')
    lo = [min(b['min'][i] for b in world) for i in range(3)]
    hi = [max(b['max'][i] for b in world) for i in range(3)]
    print('world bounds', lo, hi)
    tex = sorted({t for b in world for t in b['tex'].values()})
    print('textures', tex)
    from collections import Counter
    print('entity classes', Counter(e.get('classname') for e in ents))


if __name__ == '__main__':
    main()
