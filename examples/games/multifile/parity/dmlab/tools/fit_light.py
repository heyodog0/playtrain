"""V4: fit each level's per-texture light gain to the oracle's frames.

    uv run --no-sync python tools/fit_light.py <level> ...

DMLab lights its rooms with lightmaps; the port draws textures unlit. A first
model of that light: one RGB gain per texture per level (the light a texture
gets on average in that map), baked into the level's atlas by
tools/dmlab_atlas.py from reference/lighting/tile_gains.json.

For every dumped pose but frame 0 (the spawn effect), outside the HUD:
tools/perceptual_frames.mjs --ids says which atlas tile each port pixel
shows. Per tile with at least MIN_PIX pixels and per channel, the factor f
minimising sum |oracle - f * port| (the median of oracle / port weighted by
port) is the tile's gain. A channel the tile barely has (mean
under MIN_LEVEL) gives a noisy ratio, so it takes the other channels' mean
factor instead.

The fit is one shot against the raw texels: the level's gains are removed, its
atlas and bundle rebuilt, the frames rendered and fitted, then the atlas and
bundle rebuilt with the new gains. (Refining the gains in place drifted: in
explore the port's pixel and the oracle's are not always the same surface.)
Sprites (objects) get one grey gain from luma.
"""
from __future__ import annotations

import base64
import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
GAINS = HERE / 'reference' / 'lighting' / 'tile_gains.json'
MIN_PIX = 2000
LUMA = np.array([0.299, 0.587, 0.114])
MIN_LEVEL = 24.0    # a channel's mean texel value below which its ratio is noise
LO, HI = 0.25, 4.0


def hud_mask():
    m = np.zeros((64, 64), bool)
    m[56:64, 0:37] = True
    m[52:58, 59:64] = True
    m[0:2, 61:64] = True
    return m


def atlas_names(level):
    text = (HERE / 'src' / 'atlas' / f'{level}.js').read_text()
    return {int(i): n for n, i in re.findall(r"^  '([^']+)': (\d+),$", text, re.M)}


def wmedian(x, w):
    o = np.argsort(x)
    c = np.cumsum(w[o])
    return float(x[o][np.searchsorted(c, c[-1] / 2)])


def factors(level):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as fh:
        tmp = Path(fh.name)
    subprocess.run(['node', str(HERE / 'tools' / 'perceptual_frames.mjs'), level, str(tmp), '--ids'],
                   check=True, capture_output=True, text=True)
    port = json.loads(tmp.read_text())
    tmp.unlink()
    hud = hud_mask()
    O, P, I = [], [], []
    for f in sorted((HERE / 'reference' / 'dumps' / level).glob('*.json'), key=lambda p: int(p.stem)):
        d = json.loads(f.read_text())
        for fr, pf in zip(d['frames'], port[str(d['seed'])]):
            if fr['frame'] == 0:
                continue
            o = np.asarray(Image.open(io.BytesIO(base64.b64decode(fr['png']))).convert('RGB'))
            p = np.frombuffer(base64.b64decode(pf['rgb']), np.uint8).reshape(64, 64, 3)
            ids = np.frombuffer(base64.b64decode(pf['ids']), np.uint8).reshape(64, 64, 3).astype(int)
            m = (ids[..., 2] >= 251) & (ids[..., 2] <= 254) & ~hud
            O.append(o[m]); P.append(p[m]); I.append(ids[..., 0][m] + 256 * ids[..., 1][m])
    O = np.concatenate(O).astype(np.float64); P = np.concatenate(P).astype(np.float64); I = np.concatenate(I)
    names = atlas_names(level)
    out = {}
    for t in np.unique(I):
        name = names.get(int(t))   # None: a sky pixel that happened to read as a tile id
        m = I == t
        if name is None or m.sum() < MIN_PIX:
            continue
        if name.startswith('sprite/hr_') and '__' in name:
            continue   # hrp2 tiles hold (shade, pattern weight), not colour (rs_maze_sprite2)
        if name.startswith('sprite/'):
            # Objects: one grey gain from luma. A pickup covers few pixels and
            # the port's billboard is not DMLab's mesh, so per-channel ratios
            # there are noise (they ran to 0.25 and 3.4 on collect's hat).
            lp, lo_ = P[m] @ LUMA, O[m] @ LUMA
            k = lp > 4
            if k.sum() < MIN_PIX // 4:
                continue
            g = wmedian(lo_[k] / lp[k], lp[k])
            out[name] = ([g, g, g], int(m.sum()))
            continue
        f = [None, None, None]
        for c in range(3):
            p, o = P[m, c], O[m, c]
            k = p > 4
            if p.mean() >= MIN_LEVEL and k.sum() >= MIN_PIX // 4:
                f[c] = wmedian(o[k] / p[k], p[k])
        ok = [v for v in f if v is not None]
        if not ok:
            continue
        f = [v if v is not None else float(np.mean(ok)) for v in f]
        out[name] = (f, int(m.sum()))
    return out


def save(gains):
    GAINS.parent.mkdir(exist_ok=True)
    GAINS.write_text(json.dumps(dict(sorted(gains.items())), indent=1, sort_keys=True) + '\n')


def rebuild(level):
    """The level's atlas (with the gains file as it is) and its bundle."""
    root = HERE.parents[4]
    man = HERE / 'manifest.json'
    if json.loads(man.read_text())['name'] != 'dmlab_' + level:
        man = HERE / f'manifest_{level}.json'
    subprocess.run([sys.executable, str(HERE / 'tools' / 'dmlab_atlas.py'), level], check=True, capture_output=True)
    subprocess.run([sys.executable, str(root / 'tools' / 'bundle_multifile.py'), str(man)], check=True,
                   capture_output=True, cwd=root)


def main():
    levels = [a for a in sys.argv[1:] if not a.startswith('--')]
    gains = json.loads(GAINS.read_text()) if GAINS.exists() else {}
    for level in levels:
        gains[level] = {}
        save(gains)
        rebuild(level)
        g = gains[level]
        for name, (f, n) in sorted(factors(level).items()):
            g[name] = [round(float(np.clip(f[c], LO, HI)), 3) for c in range(3)]
            print(f'{level} {name:60s} px {n:7d} gain {g[name]}', flush=True)
        save(gains)
        rebuild(level)


if __name__ == '__main__':
    main()
