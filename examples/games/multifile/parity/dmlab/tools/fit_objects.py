"""V6b: the colour DMLab paints over a pickup model's mask, fitted to its frames.

    uv run --no-sync python tools/fit_objects.py <labassets>

DMLab's human-recognisable pickup textures are masks: the part of the texture
that is black (or transparent) is painted at run time, with the pickup's
pattern and colours for the 'pu:' pickups of the dumps, and with a colour the
dumps do not record for the plainly CREATEd hr_* ones (rooms: balloon, can,
cake, hat). This measures that colour: tools/perceptual_frames.mjs --ids tags
every port pixel with its atlas tile and whether the texel there is dark
(max(r, g, b) < 40: the mask), and for each untinted CREATEd model the median
oracle colour over its dark-texel pixels (all rooms levels, every dumped
frame but frame 0, outside the HUD) is the colour. It is DMLab's colour as
seen, lighting included. Models with fewer than MIN_PIX such pixels are left
out. Writes reference/objects/create_colours.json, which tools/sprites.py
paints the masks with.

The measurement needs the masks black, so this runs the whole cycle: sprites
without mask colours, atlases and bundles of the rooms levels, the fit, then
sprites, atlases and bundles again with the new colours.
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
OUT = HERE / 'reference' / 'objects' / 'create_colours.json'
MIN_PIX = 200
sys.path.insert(0, str(HERE / 'tools'))
import sprites  # noqa: E402


def hud_mask():
    m = np.zeros((64, 64), bool)
    m[56:64, 0:37] = True
    m[52:58, 59:64] = True
    m[0:2, 61:64] = True
    return m


def rebuild_rooms(extra=()):
    root = HERE.parents[4]
    subprocess.run([sys.executable, str(HERE / 'tools' / 'sprites.py'), str(ASSETS)] + list(extra),
                   check=True, capture_output=True)
    levels = sorted(p.name for p in (HERE / 'reference' / 'dumps').glob('rooms_*'))
    subprocess.run([sys.executable, str(HERE / 'tools' / 'dmlab_atlas.py')] + levels, check=True, capture_output=True)
    for level in levels:
        subprocess.run([sys.executable, str(root / 'tools' / 'bundle_multifile.py'),
                        str(HERE / f'manifest_{level}.json')], check=True, capture_output=True, cwd=root)


ASSETS = None


def main():
    global ASSETS
    ASSETS = Path(sys.argv[1]).resolve()
    rebuild_rooms(['--no-mask-colours'])
    # hr_* only: fut_obj_* models are not masks, their dark parts are the
    # emissive stage of their shader (tools/sprites.py composes it).
    models = {sprites.model_key(m) for m, tint in sprites.created_models()
              if tint is None and Path(m).stem.startswith('hr_')}
    pix = {k: [] for k in sorted(models)}
    hud = hud_mask()
    for lvdir in sorted((HERE / 'reference' / 'dumps').glob('rooms_*')):
        level = lvdir.name
        names = {int(i): n for n, i in re.findall(r"^  '([^']+)': (\d+),$",
                                                  (HERE / 'src' / 'atlas' / f'{level}.js').read_text(), re.M)}
        want = {i: n[len('sprite/'):] for i, n in names.items() if n[len('sprite/'):] in pix}
        if not want:
            continue
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as fh:
            tmp = Path(fh.name)
        subprocess.run(['node', str(HERE / 'tools' / 'perceptual_frames.mjs'), level, str(tmp), '--ids'],
                       check=True, capture_output=True, text=True)
        port = json.loads(tmp.read_text())
        tmp.unlink()
        for f in sorted(lvdir.glob('*.json'), key=lambda p: int(p.stem)):
            d = json.loads(f.read_text())
            for fr, pf in zip(d['frames'], port[str(d['seed'])]):
                if fr['frame'] == 0:
                    continue
                ids = np.frombuffer(base64.b64decode(pf['ids']), np.uint8).reshape(64, 64, 3).astype(int)
                tile = ids[..., 0] + 256 * ids[..., 1]
                dark = (ids[..., 2] >= 251) & (ids[..., 2] <= 254) & (((ids[..., 2] - 251) & 1) == 1) & ~hud
                if not dark.any():
                    continue
                o = np.asarray(Image.open(io.BytesIO(base64.b64decode(fr['png']))).convert('RGB'))
                for i, key in want.items():
                    m = dark & (tile == i)
                    if m.any():
                        pix[key].append(o[m])
        print(level, flush=True)
    out = {}
    for key, chunks in pix.items():
        if not chunks:
            continue
        v = np.concatenate(chunks)
        if len(v) < MIN_PIX:
            print(f'{key}: {len(v)} px, left out')
            continue
        out[key] = {'rgb': [int(x) for x in np.median(v, 0)], 'pixels': int(len(v))}
        print(f'{key}: {out[key]}')
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + '\n')
    rebuild_rooms()


if __name__ == '__main__':
    main()
