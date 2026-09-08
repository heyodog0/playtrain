"""2-D probe grid: N draw calls x M logic operations, for the additivity test.

The 1-D sweeps give a per-unit cost for each mechanism in isolation. They cannot
tell you whether the mechanisms compose -- more draw calls could plausibly slow
the logic down through cache pressure, in which case a per-unit cost is not a
useful thing to quote. This grid tests that.

  H2 (additivity)  t = t0 + a*N + b*M, with no N*M interaction term.
  H3 (prediction)  coefficients fit on the GRID predict the HELDOUT points.

HELDOUT is disjoint from GRID and includes one extrapolation beyond the fitted
range, because interpolation alone is a weak test of a linear model.

usage:
  python gen_grid_probes.py --outdir ../playtrain/examples/games/probe
"""
from __future__ import annotations

import argparse
from pathlib import Path

GRID_N = [0, 128, 256, 512]      # draw calls per frame
GRID_M = [0, 256, 512, 1024]     # entity updates per frame
HELDOUT = [(64, 384), (192, 768), (320, 128), (768, 1536)]

TMPL = """\
// GENERATED probe -- see tools/gen_grid_probes.py. %d draw calls, %d entity
// updates per frame. Everything else is fixed.
let score = 0, lives = 1, gameState = 'PLAYING';
let t = 0, ents = [];
function mulberry32(seed) {
  let a = seed !== undefined ? seed >>> 0 : 42;
  return function() {
    a += 0x6D2B79F5;
    let n = Math.imul(a ^ (a >>> 15), a | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(42);
function setup() { createCanvas(400, 400); noStroke(); resetGame(42); }
function getGameState() { return { score: score, lives: lives, gameState: gameState }; }
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0; ents = [];
  for (let i = 0; i < %d; i++)
    ents.push({ x: rng() * 400, y: rng() * 400, vx: rng() * 2 - 1, vy: rng() * 2 - 1 });
}
function draw() {
  background(0);
  t++; score = t;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    e.x += e.vx; e.y += e.vy;
    if (e.x < 0 || e.x > 400) e.vx = -e.vx;
    if (e.y < 0 || e.y > 400) e.vy = -e.vy;
  }
  let h = t & 255;
  for (let i = 0; i < %d; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    fill((h >> 16) & 255, (h >> 8) & 255, h & 255);
    rect((h %% 392), ((h >> 9) %% 392), 8, 8);
  }
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", type=Path, required=True)
    args = ap.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    pairs = [(n, m) for n in GRID_N for m in GRID_M] + HELDOUT
    for n, m in pairs:
        (args.outdir / f"probe_grid_{n}_{m}.js").write_text(TMPL % (n, m, m, n))
    print(f"wrote {len(pairs)} grid probes "
          f"({len(GRID_N) * len(GRID_M)} grid + {len(HELDOUT)} held-out)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
