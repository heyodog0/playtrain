"""P5 (PLAN.md section 12): how close the port's pitched views are to DMLab's.

    uv run --no-sync python tools/pitch_perceptual.py [level ...]

Renders the port at reference/pitch/<level>.json's poses (tools/pitch_frames.mjs)
and reports the mean absolute RGB error (0-255) by pitch. The oracle's pitched
frames come from a later run in its process than the dumps, so the world can
drift a little from the dump's timeline; compare each pitch with the same
probe's pitch-0 row, not with G6.
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent


def measure(level):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as fh:
        tmp = Path(fh.name)
    subprocess.run(['node', str(HERE / 'tools' / 'pitch_frames.mjs'), level, str(tmp)], check=True,
                   capture_output=True, text=True)
    port = json.loads(tmp.read_text())
    tmp.unlink()
    ref = json.loads((HERE / 'reference' / 'pitch' / f'{level}.json').read_text())['frames']
    by = defaultdict(list)
    for o, p in zip(ref, port):
        a = np.asarray(Image.open(io.BytesIO(base64.b64decode(o['png']))).convert('RGB')).astype(float)
        b = np.frombuffer(base64.b64decode(p['rgb']), np.uint8).reshape(64, 64, 3).astype(float)
        by[o['target']].append(float(np.abs(a - b).mean()))
    return {t: round(float(np.mean(v)), 2) for t, v in sorted(by.items())}


def main():
    levels = sys.argv[1:] or sorted(p.stem for p in (HERE / 'reference' / 'pitch').glob('*.json'))
    for lv in levels:
        print(lv, measure(lv))


if __name__ == '__main__':
    main()
