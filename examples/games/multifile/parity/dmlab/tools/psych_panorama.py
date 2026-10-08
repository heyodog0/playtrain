"""T7b: the psychlab room as a cube map around its fixed eye, and DMLab's HUD.

    uv run --no-sync python tools/psych_panorama.py psychlab_visual_search [--check]

Input: reference/panorama/<level>.json (reference/oracle/probe_panorama.py),
256 px frames of the room at a grid of views. The player never moves, so the
static scene is a function of view direction: each cube texel takes the frame
that sees its direction nearest that frame's centre, sampled bilinearly.

DMLab draws a HUD over every frame (screen space: health, ammo, a timer). Its
pixels are the ones that stay the same across all views; they are masked out
of the reprojection and kept as an overlay: per cell of a 64 x 64 grid with
any HUD in it, a rect of the HUD's mean colour and an alpha of its coverage
(drawn like the maze levels' DM_HUD, 80_render.js).

Cube faces, DMLab world axes (x east, y north, z up), in the order +x -x +y
-y +z -z; a face's texel (i, j) looks along M + (2u - 1) A + (2v - 1) B with
u = (i + 0.5)/size, v = (j + 0.5)/size (rs_maze_pview in maze.rs):
    +x M (1,0,0)  A (0,1,0)   B (0,0,-1)      -x M (-1,0,0) A (0,-1,0) B (0,0,-1)
    +y M (0,1,0)  A (-1,0,0)  B (0,0,-1)      -y M (0,-1,0) A (1,0,0)  B (0,0,-1)
    +z M (0,0,1)  A (1,0,0)   B (0,1,0)       -z M (0,0,-1) A (1,0,0)  B (0,-1,0)

Writes src/atlas/<level>.js: DM_PANO_SIZE, DM_PANO_B64 (6 faces RGBA) and
DM_PSY_HUD ([row, col, alpha, r, g, b] cells of the 64 grid).
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
FACE = 128
FACES = [((1, 0, 0), (0, 1, 0), (0, 0, -1)), ((-1, 0, 0), (0, -1, 0), (0, 0, -1)),
         ((0, 1, 0), (-1, 0, 0), (0, 0, -1)), ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
         ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (1, 0, 0), (0, -1, 0))]


def frames(pano):
    ims = [np.asarray(Image.open(io.BytesIO(base64.b64decode(v['png']))).convert('RGB')).astype(np.float64)
           for v in pano['views']]
    return np.stack(ims)


def hud_mask(ims):
    """The HUD: pixels whose colour is the same in every view (dilated by 2)."""
    spread = ims.max(axis=0) - ims.min(axis=0)
    m = spread.max(axis=2) < 8
    k = m.copy()
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            k |= np.roll(np.roll(m, dy, 0), dx, 1)
    # the HUD's changing parts (ammo count, timer) vary across views: their
    # bands are left out of the reprojection whole (other views cover them)
    h, w = m.shape
    k[int(h * 0.85):, :] = True
    k[:int(h * 0.07), int(w * 0.82):] = True
    return m, k


def basis(pitch, yaw):
    p, y = np.radians(pitch), np.radians(yaw)
    fwd = np.array([np.cos(p) * np.cos(y), np.cos(p) * np.sin(y), -np.sin(p)])
    rgt = np.array([np.sin(y), -np.cos(y), 0.0])
    up = np.array([np.sin(p) * np.cos(y), np.sin(p) * np.sin(y), np.cos(p)])
    return fwd, rgt, up


def bilinear(im, x, y):
    h, w = im.shape[:2]
    x = np.clip(x - 0.5, 0, w - 1.001)
    y = np.clip(y - 0.5, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    return (im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x0 + 1] * fx * (1 - fy) +
            im[y0 + 1, x0] * (1 - fx) * fy + im[y0 + 1, x0 + 1] * fx * fy)


def cube(pano, ims, masked):
    size = pano['size']
    out = np.zeros((6, FACE, FACE, 3))
    t = (np.arange(FACE) + 0.5) / FACE * 2 - 1
    for f, (M, A, B) in enumerate(FACES):
        uu, vv = np.meshgrid(t, t)          # [j, i]: u across, v down
        d = (np.array(M)[None, None] + uu[..., None] * np.array(A) + vv[..., None] * np.array(B)).reshape(-1, 3)
        best = np.full(len(d), np.inf)
        col = np.zeros((len(d), 3))
        for v, im in zip(pano['views'], ims):
            fwd, rgt, up = basis(v['rot'][0], v['rot'][1])
            fz = d @ fwd
            ok = fz > 1e-6
            sx = np.where(ok, (d @ rgt) / np.where(ok, fz, 1), 9)
            sy = np.where(ok, (d @ up) / np.where(ok, fz, 1), 9)
            px = (sx + 1) / 2 * size
            py = (1 - sy) / 2 * size
            inside = ok & (np.abs(sx) < 0.98) & (np.abs(sy) < 0.98)
            ix = np.clip(px.astype(int), 0, size - 1)
            iy = np.clip(py.astype(int), 0, size - 1)
            inside &= ~masked[iy, ix]
            score = np.maximum(np.abs(sx), np.abs(sy))
            take = inside & (score < best)
            if take.any():
                best[take] = score[take]
                col[take] = bilinear(im, px[take], py[take])
        assert np.isfinite(best).all(), f'face {f}: {int((~np.isfinite(best)).sum())} texels no view sees'
        out[f] = col.reshape(FACE, FACE, 3)
    return out


def rgba(a3, alpha=None):
    a = np.clip(np.round(a3), 0, 255).astype(np.uint8)
    al = np.full(a.shape[:-1] + (1,), 255, np.uint8) if alpha is None else alpha[..., None].astype(np.uint8)
    return np.concatenate([a, al], axis=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('level')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    pano = json.loads((HERE / 'reference' / 'panorama' / f'{a.level}.json').read_text())
    ims = frames(pano)
    hud, masked = hud_mask(ims)
    faces = rgba(cube(pano, ims, masked))
    med = np.median(ims, axis=0)
    k = pano['size'] // 64
    cells = []
    for r in range(64):
        for c in range(64):
            m = hud[r * k:(r + 1) * k, c * k:(c + 1) * k]
            if m.any():
                col = med[r * k:(r + 1) * k, c * k:(c + 1) * k][m].mean(axis=0)
                cells.append([r, c, round(float(m.mean()), 3)] + [int(round(v)) for v in col])
    b = lambda x: base64.b64encode(np.ascontiguousarray(x).tobytes()).decode()
    js = ('// GENERATED by tools/psych_panorama.py from reference/panorama/%s.json. DO NOT EDIT.\n'
          '// The room around the fixed eye (DMLab frames of //assets, CC BY 4.0): 6 cube faces\n'
          '// of DM_PANO_SIZE^2 RGBA, +x -x +y -y +z -z (rs_maze_pview); DMLab\'s HUD as\n'
          '// [row, col, alpha, r, g, b] cells of the 64 x 64 grid.\n'
          'const DM_PANO_SIZE = %d;\nconst DM_PANO_B64 = "%s";\nconst DM_PSY_HUD = %s;\n'
          % (a.level, FACE, b(faces), json.dumps(cells, separators=(',', ':'))))
    out = HERE / 'src' / 'atlas' / f'{a.level}.js'
    if a.check:
        ok = out.exists() and out.read_text() == js
        print('panorama up to date' if ok else f'STALE {out}')
        return 0 if ok else 1
    out.write_text(js)
    print(out, len(js), 'hud px', int(hud.sum()), 'cells', len(cells))
    return 0


if __name__ == '__main__':
    sys.exit(main())
