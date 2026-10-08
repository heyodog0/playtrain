"""G6: the port's frame against the oracle's at the 8 dumped poses of every
seed, per level: mean absolute RGB error (0-255) and SSIM. A number to
report, not a pass/fail gate (PLAN.md section 4).

    uv run --no-sync python tests/perceptual.py [level ...]

The port renders at the oracle's exact pose (tools/perceptual_frames.mjs:
the G3 replay to the frame, then the oracle's position and yaw). Writes
reference/perceptual/results.json and, per level, <level>.png: oracle (left)
and port (right) for seeds 0-3 at all 8 poses.

SSIM: Wang et al. 2004 on luminance (BT.601), an 11x11 Gaussian window of
sigma 1.5, K1 = 0.01, K2 = 0.03, L = 255, averaged over the valid window
positions. The known differences: DMLab's lightmaps and shading (the port
draws surfaces at lightmap 1, unlit), its HUD, and the approximations each
level's notes name (PROGRESS.md).
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
OUT = HERE / 'reference' / 'perceptual'


def _gauss(n=11, sigma=1.5):
    x = np.arange(n) - (n - 1) / 2
    g = np.exp(-x * x / (2 * sigma * sigma))
    return g / g.sum()


def _filt(a, g):
    a = np.apply_along_axis(lambda r: np.convolve(r, g, mode='valid'), 1, a)
    return np.apply_along_axis(lambda c: np.convolve(c, g, mode='valid'), 0, a)


def ssim(a, b):
    """a, b: HxWx3 uint8."""
    w = np.array([0.299, 0.587, 0.114])
    x, y = a.astype(np.float64) @ w, b.astype(np.float64) @ w
    g = _gauss()
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mx, my = _filt(x, g), _filt(y, g)
    sxx = _filt(x * x, g) - mx * mx
    syy = _filt(y * y, g) - my * my
    sxy = _filt(x * y, g) - mx * my
    m = ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))
    return float(m.mean())


def levels():
    return sorted(p.stem[len('dmlab_'):] for p in (HERE / 'dist').glob('dmlab_*.js'))


def measure(level):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as fh:
        tmp = Path(fh.name)
    subprocess.run(['node', str(HERE / 'tools' / 'perceptual_frames.mjs'), level, str(tmp)], check=True,
                   capture_output=True, text=True)
    port = json.loads(tmp.read_text())
    tmp.unlink()
    maes, ssims, rows = [], [], []
    for f in sorted((HERE / 'reference' / 'dumps' / level).glob('*.json'), key=lambda p: int(p.stem)):
        d = json.loads(f.read_text())
        pairs = []
        for fr, pf in zip(d['frames'], port[str(d['seed'])]):
            assert fr['frame'] == pf['frame']
            o = np.asarray(Image.open(io.BytesIO(base64.b64decode(fr['png']))).convert('RGB'))
            p = np.frombuffer(base64.b64decode(pf['rgb']), np.uint8).reshape(64, 64, 3)
            maes.append(float(np.abs(o.astype(np.int16) - p.astype(np.int16)).mean()))
            ssims.append(ssim(o, p))
            pairs.append(np.concatenate([o, p], 1))
        if d['seed'] < 4:
            rows.append(np.concatenate(pairs, 1))
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.concatenate(rows, 0)).save(OUT / f'{level}.png', optimize=True)
    return {'frames': len(maes), 'mae': round(float(np.mean(maes)), 2), 'ssim': round(float(np.mean(ssims)), 3),
            'mae_worst': round(float(np.max(maes)), 2), 'ssim_worst': round(float(np.min(ssims)), 3)}


def main():
    want = sys.argv[1:] or levels()
    path = OUT / 'results.json'
    res = json.loads(path.read_text()) if path.exists() else {}
    for lv in want:
        res[lv] = measure(lv)
        print(lv, res[lv], flush=True)
    path.write_text(json.dumps(dict(sorted(res.items())), indent=2) + '\n')


if __name__ == '__main__':
    main()
