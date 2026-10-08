"""G6b (PLAN.md section 10, V0): where the port's frames differ from DMLab's.

    uv run --no-sync python tools/perceptual_regions.py [level ...]

For every dumped pose (tools/perceptual_frames.mjs --labels: the port's frame
at the oracle's exact pose, plus the same frame with every atlas tile
repainted as its surface class), split the mean absolute RGB error by:

  * class: sky, wall, floor, ceiling, object, other (the port's label frame);
    the HUD rectangle is its own class whatever the port drew there
  * band: rows within 6 of the horizon (far), 7-16 away (mid), farther (near)
  * frame 0 of each trajectory (DMLab's spawn effect) against the rest

and, per class, the oracle's mean luminance over the port's (a first
estimate of DMLab's lighting gain on that surface). Writes
reference/perceptual/regions.json and prints one table per level.

Error shares add up to 1 within each split: a class's share is its part of
the level's total absolute error, so the largest share is the first target.
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / 'reference' / 'perceptual' / 'regions.json'
CLASSES = ['sky', 'wall', 'floor', 'ceiling', 'object', 'other', 'hud']
LUMA = np.array([0.299, 0.587, 0.114])


def hud_mask():
    """DMLab's HUD at 64x64 (oracle frames, 3 families): the translucent
    status bar bottom-left, the icon bottom-right, the dot top-right."""
    m = np.zeros((64, 64), bool)
    m[56:64, 0:37] = True
    m[52:58, 59:64] = True
    m[0:2, 61:64] = True
    return m


def labels_of(img):
    """Class index per pixel from a label frame: tiles carry R = 40 * class,
    G = B = 0; the sky is the level's sky colour (G > 0)."""
    r, g = img[..., 0].astype(int), img[..., 1].astype(int)
    code = np.clip(np.rint(r / 40.0).astype(int), 1, 5)
    return np.where(g > 0, 0, code)


def measure(level):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as fh:
        tmp = Path(fh.name)
    subprocess.run(['node', str(HERE / 'tools' / 'perceptual_frames.mjs'), level, str(tmp), '--labels'],
                   check=True, capture_output=True, text=True)
    port = json.loads(tmp.read_text())
    tmp.unlink()
    hud = hud_mask()
    rows = np.abs(np.arange(64)[:, None] - 31.5).repeat(64, 1)
    band = np.where(rows <= 6.5, 0, np.where(rows <= 16.5, 1, 2))
    err_c = np.zeros(len(CLASSES)); pix_c = np.zeros(len(CLASSES))
    lo = np.zeros(len(CLASSES)); lp = np.zeros(len(CLASSES))
    err_b = np.zeros(3); err_f0 = 0.0; total = 0.0
    for f in sorted((HERE / 'reference' / 'dumps' / level).glob('*.json'), key=lambda p: int(p.stem)):
        d = json.loads(f.read_text())
        for fr, pf in zip(d['frames'], port[str(d['seed'])]):
            o = np.asarray(Image.open(io.BytesIO(base64.b64decode(fr['png']))).convert('RGB')).astype(float)
            p = np.frombuffer(base64.b64decode(pf['rgb']), np.uint8).reshape(64, 64, 3).astype(float)
            lab = labels_of(np.frombuffer(base64.b64decode(pf['labels']), np.uint8).reshape(64, 64, 3))
            lab = np.where(hud, 6, lab)
            e = np.abs(o - p).mean(-1)
            total += e.sum()
            if fr['frame'] == 0:
                err_f0 += e.sum()
            for k in range(len(CLASSES)):
                m = lab == k
                err_c[k] += e[m].sum(); pix_c[k] += m.sum()
                lo[k] += (o[m] @ LUMA).sum(); lp[k] += (p[m] @ LUMA).sum()
            for b in range(3):
                err_b[b] += e[(band == b) & ~hud].sum()
    n_pix = pix_c.sum()
    out = {'mae': round(float(total / n_pix), 2), 'frame0_share': round(float(err_f0 / total), 3), 'classes': {}, 'bands': {}}
    for k, c in enumerate(CLASSES):
        if pix_c[k] == 0:
            continue
        out['classes'][c] = {'pixels': round(float(pix_c[k] / n_pix), 3), 'error_share': round(float(err_c[k] / total), 3),
                             'mae': round(float(err_c[k] / pix_c[k]), 1),
                             'luma_oracle_over_port': round(float(lo[k] / max(lp[k], 1e-9)), 3)}
    nb = total - err_c[6]
    for b, name in enumerate(['far', 'mid', 'near']):
        out['bands'][name] = round(float(err_b[b] / nb), 3)
    return out


def main():
    levels = sys.argv[1:] or sorted(p.stem[len('dmlab_'):] for p in (HERE / 'dist').glob('dmlab_*.js'))
    res = json.loads(OUT.read_text()) if OUT.exists() else {}
    for lv in levels:
        r = measure(lv)
        res[lv] = r
        cl = '  '.join(f"{c} {v['pixels']:.2f}px/{v['error_share']:.2f}err/x{v['luma_oracle_over_port']:.2f}"
                       for c, v in r['classes'].items())
        print(f"{lv}: MAE {r['mae']}  frame0 {r['frame0_share']:.2f}  bands {r['bands']}\n    {cl}", flush=True)
        OUT.write_text(json.dumps(dict(sorted(res.items())), indent=2) + '\n')


if __name__ == '__main__':
    main()
