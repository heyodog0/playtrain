"""Render frames through the game's own JS, in node, with a night key.

The hosts (qjs_host, the node GameEnv, the browser) expose setup/draw/reset
and nothing else, so there is no way to hand Craftax's `state_rng` to the
renderer through PlayTrainEnv. This module runs the same concatenated
sources the bundle is made of, replaces the five rasterizer calls
80_render.js makes with a stub that pastes bitmaps into a 64x64 buffer, and
drives the game the way GameEnv does: resetGame(seed), one NOOP step for the
reset tick, then one stepGame per action, rendering after each. Frames come
back as (n, 63, 63, 3) uint8 — the Craftax frame, obs[:63, :63].

The stub is faithful because 80_render.js uploads each region once and
blits it 1:1 at integer coordinates; there is nothing to resample. The gate
in test_render.py checks that anyway, by asserting the stub's daylight frames
equal the ones PlayTrainEnv produces for the same trajectory.

Like jsrun.py this concatenates into one file and runs `node <file>`; see
that module for why `node -e` would not work.
"""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
MANIFEST = GAME / "manifest.json"

CRAFTAX_W = CRAFTAX_H = 63
CANVAS = 64

# The rasterizer surface 80_render.js and 90_playtrain.js touch, and no more.
# image() refuses a scaled blit: a resampled frame would silently stop being
# Craftax's image, and the real hosts never scale at obs 64.
STUB_JS = """
const __W = %(canvas)d, __H = %(canvas)d;
const __frame = new Uint8Array(__W * __H * 3);
const __bmps = [];
function createCanvas(w, h) {
  if (w !== __W || h !== __H) throw new Error('createCanvas ' + w + 'x' + h);
}
function background(r, g, b) {
  for (let i = 0; i < __frame.length; i += 3) { __frame[i] = r; __frame[i + 1] = g; __frame[i + 2] = b; }
}
function createBitmap(w, h) {
  __bmps.push({ w, h, px: new Uint8Array(w * h * 4) });
  return __bmps.length - 1;
}
function loadBitmap(id, bytes) {
  const B = __bmps[id];
  B.px.set(bytes.subarray(0, B.w * B.h * 4));
  return B.w * B.h * 4;
}
function image(id, x, y, w, h) {
  const B = __bmps[id];
  if (w !== B.w || h !== B.h) throw new Error('scaled blit ' + w + 'x' + h + ' of ' + B.w + 'x' + B.h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const s = (yy * w + xx) * 4, d = ((y + yy) * __W + (x + xx)) * 3;
      __frame[d] = B.px[s]; __frame[d + 1] = B.px[s + 1]; __frame[d + 2] = B.px[s + 2];
    }
  }
}
""" % {"canvas": CANVAS}

DRIVE_JS = """
const fs = require('fs');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const crop = new Uint8Array(%(w)d * %(h)d * 3);
function snapshot() {
  for (let y = 0; y < %(h)d; y++) {
    crop.set(__frame.subarray((y * __W) * 3, (y * __W + %(w)d) * 3), y * %(w)d * 3);
  }
  return Buffer.from(crop).toString('base64');
}
function keyFor(i) {
  const k = job.keys ? job.keys[i] : null;
  if (k) setNightKey(k[0], k[1]); else clearNightKey();
}
const frames = [];
resetGame(job.seed);
// GameEnv.reset() ticks draw() once before the first env.step(): a NOOP.
stepGame(gameState, ACT_NOOP);
keyFor(0);
renderGame(gameState);
frames.push(snapshot());
for (let t = 0; t < job.actions.length; t++) {
  const res = stepGame(gameState, job.actions[t]);
  keyFor(t + 1);
  renderGame(gameState);
  frames.push(snapshot());
  if (res.done) break;
}
process.stdout.write(JSON.stringify(frames));
""" % {"w": CRAFTAX_W, "h": CRAFTAX_H}


def sources() -> list[Path]:
    """Every source in the manifest, in manifest order — the bundle's recipe."""
    m = json.loads(MANIFEST.read_text())
    return [(GAME / s).resolve() for s in m["sources"]]


def render_frames(seed: int, actions: list[int],
                  keys: list[list[int] | None] | None = None) -> np.ndarray:
    """Frames 0..len(actions) (fewer if the episode ends), as (n, 63, 63, 3).

    `keys[i]` is the two-word state_rng to install before rendering frame i,
    or None for no key (the static is then skipped, as in every host).
    """
    if keys is not None and len(keys) != len(actions) + 1:
        raise ValueError("keys must have one entry per frame, len(actions) + 1")
    parts = [STUB_JS]
    for path in sources():
        parts.append(f"// ---- {path.name} ----\n{path.read_text()}")
    parts.append("// ---- driver ----\n" + DRIVE_JS)
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "render.cjs"
        script.write_text("\n".join(parts))
        job = Path(tmp) / "job.json"
        job.write_text(json.dumps({"seed": int(seed), "actions": [int(a) for a in actions],
                                   "keys": keys}))
        proc = subprocess.run(["node", str(script), str(job)], capture_output=True, text=True)
        if proc.returncode != 0:
            raise AssertionError(f"node exited {proc.returncode}:\n{proc.stderr}")
    out = [np.frombuffer(base64.b64decode(f), np.uint8).reshape(CRAFTAX_H, CRAFTAX_W, 3)
           for f in json.loads(proc.stdout)]
    return np.stack(out)
