"""Fit a Quake-3-style walking model to the oracle trajectories (PLAN.md 3.4, G3).

    uv run --no-sync python tools/pmove_fit.py [--dt 0.016] [--level explore_goal_locations_small]

A model written from the published behaviour of Quake 3 movement (friction,
then acceleration toward the wish direction capped at the wish speed, then a
slide move that clips velocity against what it hits, then integer snapping of
the velocity), with every constant a parameter. It replays each dump's
scripted actions from the dumped spawn pose and reports the per-frame
position error against DEBUG.POS.TRANS. This is the double-precision
prototype; src/40_pmove.js is the f32 port the gates run.
"""
import argparse
import glob
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# Fitted on explore_goal_locations_small (U04): accel 10 and friction 6 are
# sharply optimal (a grid over 8/10/12 x 5/6/8 is 53/64 vs <= 2/64 elsewhere);
# both are Quake 3's documented defaults. look is deg per pixel, see YAW below.
P = dict(speed=320.0, accel=10.0, friction=6.0, stop=100.0, half=16.0, eps=0.125,
         look=0.10560, overclip=1.001, cut=1.925, notch=1.0)


def cross(c, r, H, half, notch):
    """A wall cell as the port collides with it (src/30_level.js): two boxes,
    each inset `notch` on one axis, grown by `half`."""
    x0 = c * 100.0; x1 = x0 + 100.0; y0 = (H - 1 - r) * 100.0; y1 = y0 + 100.0

    def rect(a0, a1, b0, b1):
        return [((1.0, 0.0), a1 + half), ((-1.0, 0.0), -(a0 - half)),
                ((0.0, 1.0), b1 + half), ((0.0, -1.0), -(b0 - half))]
    return [rect(x0, x1, y0 + notch, y1 - notch), rect(x0 + notch, x1 - notch, y0, y1)]


def octagon(c, r, H, half, cut, solid=None):
    """Configuration-space obstacle of wall cell (r, c): the cell grown by the
    player's half-width, with each EXPOSED vertical edge cut at 45 degrees by
    `cut` (L1). An edge is exposed when both cells beside it are open; where a
    neighbour is wall the face runs on and there is no corner to cut.
    Returned as outward unit normals and offsets: inside is n.p < d for all."""
    x0 = c * 100.0 - half; x1 = c * 100.0 + 100.0 + half
    y0 = (H - 1 - r) * 100.0 - half; y1 = (H - r) * 100.0 + half
    k = 1.0 / math.sqrt(2.0)

    def open_(rr, cc):
        if solid is None:
            return True
        if rr < 0 or cc < 0 or rr >= len(solid) or cc >= len(solid[0]):
            return False
        return not solid[rr][cc]

    planes = [((1.0, 0.0), x1), ((-1.0, 0.0), -x0), ((0.0, 1.0), y1), ((0.0, -1.0), -y0)]
    # +y is north = row r-1; +x is east = col c+1.
    if open_(r - 1, c) and open_(r, c + 1): planes.append(((k, k), (x1 + y1 - cut) * k))
    if open_(r - 1, c) and open_(r, c - 1): planes.append(((-k, k), (-x0 + y1 - cut) * k))
    if open_(r + 1, c) and open_(r, c + 1): planes.append(((k, -k), (x1 - y0 - cut) * k))
    if open_(r + 1, c) and open_(r, c - 1): planes.append(((-k, -k), (-x0 - y0 - cut) * k))
    return planes


def trace(polys, ax, ay, bx, by, eps):
    """Q3-style point trace from a to b against convex obstacles: returns
    (fraction, normal) of the first entry, with the end backed off so it stays
    `eps` outside the plane it hit; (1, None) if clear."""
    best = (1.0, None)
    for planes in polys:
        enter = -1.0; leave = 1.0; hitn = None; start_out = False
        for (nx, ny), d in planes:
            d1 = nx * ax + ny * ay - d
            d2 = nx * bx + ny * by - d
            if d1 > 0: start_out = True
            if d1 > 0 and d2 >= d1: enter = 2.0; break  # moving away, outside
            if d1 <= 0 and d2 <= 0: continue
            if d1 > d2:
                f = (d1 - eps) / (d1 - d2)
                if f > enter: enter = f; hitn = (nx, ny)
            else:
                f = (d1 + eps) / (d1 - d2)
                if f < leave: leave = f
        if enter > 1.0 or hitn is None:
            continue
        if start_out and enter < leave:
            f = max(enter, 0.0)
            if f < best[0]:
                best = (f, hitn)
    return best


def clip(vx, vy, n, over):
    back = vx * n[0] + vy * n[1]
    back = back * over if back < 0 else back / over
    return vx - n[0] * back, vy - n[1] * back


def walls_of(layout):
    rows = layout.rstrip('\n').split('\n')
    H = len(rows)
    W = max(len(r) for r in rows)
    solid = [[(c < len(rows[r]) and rows[r][c] == '*') for c in range(W)] for r in range(H)]
    return solid, H, W


def blocked(solid, H, W, x, y, half):
    """Does the player's square footprint at (x, y) overlap a wall cell?"""
    c0 = math.floor((x - half) / 100.0); c1 = math.floor((x + half) / 100.0)
    # DMLab y grows north; layout row 0 is the top (largest y).
    r0 = H - 1 - math.floor((y + half) / 100.0); r1 = H - 1 - math.floor((y - half) / 100.0)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if r < 0 or c < 0 or r >= H or c >= W or solid[r][c]:
                return True
    return False


def slide(solid, H, W, x, y, vx, vy, dt, p):
    """Q3 PM_SlideMove in the plane: up to 4 bumps; clip against every plane
    touched this move (overclip 1.001); two planes that both block make a
    crease, and a crease of two vertical planes is vertical, so the
    horizontal velocity becomes zero; three stop the move."""
    half = p['half']; eps = p['eps']; over = p['overclip']
    c0 = int(math.floor((min(x, x + vx * dt) - half) / 100.0)) - 1
    c1 = int(math.floor((max(x, x + vx * dt) + half) / 100.0)) + 1
    r0 = H - 1 - int(math.floor((max(y, y + vy * dt) + half) / 100.0)) - 1
    r1 = H - 1 - int(math.floor((min(y, y + vy * dt) - half) / 100.0)) + 1
    polys = [poly for r in range(max(r0, 0), min(r1, H - 1) + 1)
             for c in range(max(c0, 0), min(c1, W - 1) + 1) if solid[r][c]
             for poly in cross(c, r, H, half, p['notch'])]
    planes = []
    t = dt
    for _ in range(4):
        ex, ey = x + vx * t, y + vy * t
        f, n = trace(polys, x, y, ex, ey, eps)
        if f > 0:
            x += (ex - x) * f; y += (ey - y) * f
        if n is None:
            break
        t -= t * f
        if len(planes) >= 5:
            return x, y, 0.0, 0.0
        if any(n[0] * q[0] + n[1] * q[1] > 0.99 for q in planes):
            vx += n[0]; vy += n[1]
            continue
        planes.append(n)
        for i, pi in enumerate(planes):
            if vx * pi[0] + vy * pi[1] >= 0.1:
                continue
            cx, cy = clip(vx, vy, pi, over)
            stuck = False
            for j, pj in enumerate(planes):
                if j == i or cx * pj[0] + cy * pj[1] >= 0.1:
                    continue
                cx, cy = clip(cx, cy, pj, over)
                if cx * pi[0] + cy * pi[1] >= 0:
                    continue
                stuck = True
                break
            vx, vy = (0.0, 0.0) if stuck else (cx, cy)
            break
    return x, y, vx, vy


def slide_axis(solid, H, W, x, y, vx, vy, dt, p):
    """Axis-separated move against axis-aligned walls: move along x, clamp to
    the wall face minus the clip epsilon, zero vx on contact; then y."""
    half = p['half']; eps = p['eps']
    nx = x + vx * dt
    if blocked(solid, H, W, nx, y, half):
        if vx > 0:
            wall = math.floor((x + half) / 100.0 + 1) * 100.0
            nx = min(nx, wall - half - eps)
        else:
            wall = math.floor((x - half) / 100.0) * 100.0
            nx = max(nx, wall + half + eps)
        if blocked(solid, H, W, nx, y, half):
            nx = x
        vx = 0.0
    ny = y + vy * dt
    if blocked(solid, H, W, nx, ny, half):
        if vy > 0:
            wall = math.floor((y + half) / 100.0 + 1) * 100.0
            ny = min(ny, wall - half - eps)
        else:
            wall = math.floor((y - half) / 100.0) * 100.0
            ny = max(ny, wall + half + eps)
        if blocked(solid, H, W, nx, ny, half):
            ny = y
        vy = 0.0
    return nx, ny, vx, vy


def snap(v):
    return float(round(v))


def step(st, act, dt, p, walls):
    look, _, strafe, move = act[0], act[1], act[2], act[3]
    st['yaw'] -= look * p['look']
    yaw = math.radians(st['yaw'])
    fx, fy = math.cos(yaw), math.sin(yaw)
    rx, ry = math.sin(yaw), -math.cos(yaw)
    wx = fx * move + rx * strafe
    wy = fy * move + ry * strafe
    wl = math.hypot(wx, wy)
    vx, vy = st['vx'], st['vy']
    # friction
    sp = math.hypot(vx, vy)
    if sp < 1.0:
        vx = vy = 0.0
    else:
        control = max(sp, p['stop'])
        ns = max(sp - control * p['friction'] * dt, 0.0) / sp
        vx *= ns; vy *= ns
    # accelerate
    if wl > 0:
        dx, dy = wx / wl, wy / wl
        wishspeed = p['speed']
        cur = vx * dx + vy * dy
        add = wishspeed - cur
        if add > 0:
            a = min(p['accel'] * dt * wishspeed, add)
            vx += a * dx; vy += a * dy
    x, y, vx, vy = slide(*walls, st['x'], st['y'], vx, vy, dt, p)
    st.update(x=x, y=y, vx=snap(vx), vy=snap(vy))


def run(dump, kind, dt, p):
    acts = dump['action_set']
    walls = walls_of(dump['start']['layout'])
    s = dump['start']
    st = dict(x=s['pos'][0], y=s['pos'][1], vx=0.0, vy=0.0, yaw=s['rot'][1])
    errs = []
    yerrs = []
    for r in dump['trajectories'][kind]:
        if 'pos' not in r:
            break
        step(st, acts[r['a']][1], dt, p, walls)
        errs.append(math.hypot(st['x'] - r['pos'][0], st['y'] - r['pos'][1]))
        yerrs.append(abs(st['yaw'] - r['rot'][1]))
        if r.get('r'):
            break   # a goal teleports; the core fit stops there
    return errs, yerrs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dt', type=float, default=0.016)
    ap.add_argument('--level', default='explore_goal_locations_small')
    ap.add_argument('--show', type=int, default=3)
    a = ap.parse_args()
    worst = []
    for f in sorted(glob.glob(str(HERE / 'reference' / 'dumps' / a.level / '*.json')), key=lambda s: int(Path(s).stem)):
        d = json.load(open(f))
        for kind in ('script', 'impala'):
            e, ye = run(d, kind, a.dt, P)
            m = max(e) if e else 0
            worst.append((m, d['seed'], kind, e.index(m) if e else -1, max(ye) if ye else 0, len(e)))
    worst.sort(reverse=True)
    for w in worst[:a.show]:
        print('max err %.3f seed %d %s at frame %d; yaw err %.2e; frames %d' % w)
    print('trajectories within 2.0:', sum(1 for w in worst if w[0] <= 2.0), '/', len(worst))


if __name__ == '__main__':
    main()
