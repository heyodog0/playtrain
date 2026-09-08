"""Generate probe environments that isolate one cost each, then price them.

The Limitations paragraph asserts two binding modes -- draw calls and game-logic
state updates -- but the only evidence is two real games, where the two are
confounded. Decomposing a real game does not fix that: the host's NODRAW flag
returns from the BODY of each draw binding, so draw-call dispatch stays on the
"logic" side of any such split.

Probe environments avoid the problem entirely. Because a PlayTrain environment
is an ordinary JavaScript file, we can write games that hold everything fixed
and vary one quantity, and read the cost off the slope. This is not available on
ALE or ProcGen -- there is no way to add a ROM that draws exactly 512 rects.

Three sweeps:
  draw   N rect() calls of fixed 8x8 size, trivial logic  -> us per draw call
  fill   16 rect() calls of side S                        -> us per pixel filled
  logic  8 fixed rects, N entity position updates         -> us per state update

usage:
  python gen_probes.py --outdir ../playtrain/examples/games/probe
"""
from __future__ import annotations

import argparse
from pathlib import Path

PRELUDE = """\
// GENERATED probe environment -- see tools/gen_probes.py. Not a game; it holds
// everything fixed except %s so the per-unit cost is the slope.
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
"""

RESET = """\
function resetGame(seed) {
  rng = mulberry32(seed !== undefined ? seed : 42);
  score = 0; lives = 1; gameState = 'PLAYING'; t = 0;
  ents = [];
  for (let i = 0; i < %d; i++)
    ents.push({ x: rng() * 400, y: rng() * 400, vx: rng() * 2 - 1, vy: rng() * 2 - 1 });
}
"""

# draw: N calls, fixed 8x8. Positions come from a cheap integer walk rather than
# the entity array so the loop cost does not scale with N on the logic side.
DRAW_TMPL = """\
function draw() {
  background(0);
  t++;
  score = t;
  let h = t & 255;
  for (let i = 0; i < %d; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    fill((h >> 16) & 255, (h >> 8) & 255, h & 255);
    rect((h %% 392), ((h >> 9) %% 392), %d, %d);
  }
}
"""

# logic: fixed 8 draws, N entity updates.
LOGIC_TMPL = """\
function draw() {
  background(0);
  t++;
  score = t;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    e.x += e.vx; e.y += e.vy;
    if (e.x < 0 || e.x > 400) e.vx = -e.vx;
    if (e.y < 0 || e.y > 400) e.vy = -e.vy;
    e.vy += 0.01;
  }
  for (let i = 0; i < 8; i++) {
    fill(200, 100, 50);
    rect(i * 40, 40, 8, 8);
  }
}
"""

DRAW_N = [0, 32, 64, 128, 256, 512, 1024]
FILL_S = [2, 4, 8, 16, 32, 64]
LOGIC_N = [0, 64, 128, 256, 512, 1024, 2048]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", type=Path, required=True)
    args = ap.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    names = []
    for n in DRAW_N:
        p = args.outdir / f"probe_draw_{n}.js"
        p.write_text((PRELUDE % "the number of draw calls") + (RESET % 0)
                     + (DRAW_TMPL % (n, 8, 8)))
        names.append(p.stem)
    for s in FILL_S:
        p = args.outdir / f"probe_fill_{s}.js"
        p.write_text((PRELUDE % "the area filled per draw call") + (RESET % 0)
                     + (DRAW_TMPL % (16, s, s)))
        names.append(p.stem)
    for n in LOGIC_N:
        p = args.outdir / f"probe_logic_{n}.js"
        p.write_text((PRELUDE % "the number of state updates") + (RESET % n)
                     + LOGIC_TMPL)
        names.append(p.stem)
    print(f"wrote {len(names)} probes to {args.outdir}")
    print(",".join(names))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
