"""Probe environments for the game-logic half of the Limitations claim.

tools/gen_probes.py priced ONE kind of logic -- integrating N entity objects --
and that is not what "updates a large amount of state per step" means for a
tile game like miner. Amount is not the only variable; KIND is. These five hold
draw calls fixed at 8 and vary the mechanism:

  lent    N entity objects, position integration   (JS object property access)
  larr    N updates into a Float64Array            (same arithmetic, no objects)
  lgrid   N-cell tile grid, scan + conditional write (the miner shape)
  lcoll   O(N) pairwise distance checks             (collision broadphase)
  lalloc  N short-lived objects per frame           (allocation / GC churn)

lent vs larr is the informative pair: identical arithmetic, so the gap is
QuickJS object-property cost, which is the thing "optimizing the QuickJS engine
itself" in the Limitations paragraph would actually buy.

usage:
  python gen_logic_probes.py --outdir ../playtrain/examples/games/probe
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

HEAD = """\
// GENERATED probe -- see tools/gen_logic_probes.py. Fixed 8 draw calls; the
// only thing that varies is %s.
let score = 0, lives = 1, gameState = 'PLAYING';
let t = 0, ents = [], arr = null, grid = null, sink = 0;
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
function drawFixed() {
  background(0);
  for (let i = 0; i < 8; i++) { fill(200, 100, 50); rect(i * 40, 40, 8, 8); }
}
"""

BODIES = {
    # N entity objects: property reads/writes through the QuickJS object model.
    "lent": ("""\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0; ents = [];
  for (let i = 0; i < %d; i++)
    ents.push({ x: rng() * 400, y: rng() * 400, vx: rng() * 2 - 1, vy: rng() * 2 - 1 });
}
function draw() {
  t++; score = t;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    e.x += e.vx; e.y += e.vy;
    if (e.x < 0 || e.x > 400) e.vx = -e.vx;
    if (e.y < 0 || e.y > 400) e.vy = -e.vy;
  }
  drawFixed();
}
""", "the number of entity objects updated"),

    # Same arithmetic over a flat typed array: no object property lookups.
    "larr": ("""\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0;
  arr = new Float64Array(%d * 4);
  for (let i = 0; i < arr.length; i++) arr[i] = rng() * 400;
}
function draw() {
  t++; score = t;
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] += arr[i + 2]; arr[i + 1] += arr[i + 3];
    if (arr[i] < 0 || arr[i] > 400) arr[i + 2] = -arr[i + 2];
    if (arr[i + 1] < 0 || arr[i + 1] > 400) arr[i + 3] = -arr[i + 3];
  }
  drawFixed();
}
""", "the number of typed-array slots updated"),

    # N-cell tile grid: scan every cell, write some. The miner / tile-game shape.
    "lgrid": ("""\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0;
  grid = new Int32Array(%d);
  for (let i = 0; i < grid.length; i++) grid[i] = (rng() * 4) | 0;
}
function draw() {
  t++; score = t;
  let acc = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === 1) { grid[i] = 2; acc++; }
    else if (v === 2) { grid[i] = 0; }
    else if (v === 3) { acc += 2; }
  }
  sink = acc;
  drawFixed();
}
""", "the number of tile-grid cells scanned"),

    # O(n^2) pairwise checks; n chosen so pair count ~= N.
    "lcoll": ("""\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0;
  arr = new Float64Array(%d * 2);
  for (let i = 0; i < arr.length; i++) arr[i] = rng() * 400;
}
function draw() {
  t++; score = t;
  let hits = 0;
  const n = arr.length >> 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const dx = arr[i * 2] - arr[j * 2], dy = arr[i * 2 + 1] - arr[j * 2 + 1];
      if (dx * dx + dy * dy < 64) hits++;
    }
  sink = hits;
  drawFixed();
}
""", "the number of pairwise collision checks"),

    # Allocation churn: N short-lived objects per frame, then dropped.
    "lalloc": ("""\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0;
}
function draw() {
  t++; score = t;
  let acc = 0;
  const tmp = [];
  for (let i = 0; i < %d; i++) tmp.push({ x: i, y: t, hit: false });
  for (let i = 0; i < tmp.length; i++) acc += tmp[i].x;
  sink = acc;
  drawFixed();
}
""", "the number of objects allocated per frame"),
}

NS = [0, 256, 512, 1024, 2048, 4096]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", type=Path, required=True)
    args = ap.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    made = []
    for fam, (tmpl, what) in BODIES.items():
        for n in NS:
            # lcoll is parameterised by pair count, so solve n(n-1)/2 ~= N.
            arg = n
            if fam == "lcoll":
                arg = 0 if n == 0 else int((1 + math.sqrt(1 + 8 * n)) / 2)
            p = args.outdir / f"probe_{fam}_{n}.js"
            p.write_text((HEAD % what) + (tmpl % arg))
            made.append(p.stem)
    print(f"wrote {len(made)} logic probes to {args.outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
