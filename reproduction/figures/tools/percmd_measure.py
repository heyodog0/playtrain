"""Price each p5 primitive separately, then re-split the games with those prices.

One average price for "a p5 command" charged qbert.v2's quad()-heavy cube map at
the rect() rate and misfiled the difference as game logic. This sweeps each
primitive on its own and counts games per-binding, so the split is measured.
"""
import ctypes
import json
import pathlib
import sys
import time

import numpy as np

sys.path.insert(0, 'tools')
from playtrain.runtime.native_vec_env import NativeVecEnv  # noqa: E402

PROBE = pathlib.Path('../playtrain/examples/games/probe')
GAMES = '../playtrain/examples/games/js'
NS = [0, 64, 128, 256, 512]
# one call per iteration, fill hoisted out, so the slope is that primitive alone
# Every primitive the suite actually calls gets its own probe. Anything left to
# a fallback rate repeats the mistake this file exists to fix: qbert is almost
# entirely beginShape/vertex/endShape, and pricing those at the rect rate would
# misattribute its drawing cost exactly as the flat rate did for qbert.v2.
PRIM = {
    "rect":     "rect((h % 380), ((h >> 9) % 380), 8, 8);",
    "quad":     "quad((h % 380), ((h >> 9) % 380), (h % 380) + 8, ((h >> 9) % 380) + 3, (h % 380) + 8, ((h >> 9) % 380) + 11, (h % 380), ((h >> 9) % 380) + 8);",
    "ellipse":  "ellipse((h % 380), ((h >> 9) % 380), 8, 8);",
    "circle":   "circle((h % 380), ((h >> 9) % 380), 8);",
    "line":     "line((h % 380), ((h >> 9) % 380), (h % 380) + 8, ((h >> 9) % 380) + 8);",
    "triangle": "triangle((h % 380), ((h >> 9) % 380), (h % 380) + 8, ((h >> 9) % 380), (h % 380), ((h >> 9) % 380) + 8);",
    "fill":     "fill((h >> 16) & 255, (h >> 8) & 255, h & 255);",
    "stroke":   "stroke((h >> 16) & 255, (h >> 8) & 255, h & 255);",
    "background": "background((h >> 16) & 255, (h >> 8) & 255, h & 255);",
}
# vertex() only exists inside a beginShape/endShape pair, so it is swept with
# the pair hoisted out (slope = one vertex), and the pair is then priced by
# sweeping whole 3-vertex shapes and subtracting the three vertices.
SHAPE_HEAD = """let score=0,lives=1,gameState='PLAYING',t=0;
function mulberry32(s){let a=s>>>0;return function(){a+=0x6D2B79F5;let n=Math.imul(a^(a>>>15),a|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
let rng=mulberry32(42);
function setup(){createCanvas(400,400);noStroke();resetGame(42);}
function resetGame(s){rng=mulberry32(s===undefined?42:s);score=0;lives=1;gameState='PLAYING';t=0;}
function getGameState(){return {score:score,lives:lives,gameState:gameState};}
function draw(){background(0);t++;score=t;fill(200,100,50);let h=t&255;
%s}
"""
SHAPE_BODY = {
    "vertex": "beginShape();for(let i=0;i<%d;i++){h=(h*1103515245+12345)&0x7fffffff;vertex((h %% 380),((h >> 9) %% 380));}endShape();",
    "shapepair": "for(let i=0;i<%d;i++){h=(h*1103515245+12345)&0x7fffffff;beginShape();vertex((h %% 380),((h >> 9) %% 380));vertex((h %% 380)+8,((h >> 9) %% 380));vertex((h %% 380),((h >> 9) %% 380)+8);endShape();}",
}

HEAD = """let score=0,lives=1,gameState='PLAYING',t=0;
function mulberry32(s){let a=s>>>0;return function(){a+=0x6D2B79F5;let n=Math.imul(a^(a>>>15),a|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
let rng=mulberry32(42);
function setup(){createCanvas(400,400);noStroke();resetGame(42);}
function resetGame(s){rng=mulberry32(s===undefined?42:s);score=0;lives=1;gameState='PLAYING';t=0;}
function getGameState(){return {score:score,lives:lives,gameState:gameState};}
function draw(){background(0);t++;score=t;fill(200,100,50);let h=t&255;
for(let i=0;i<%d;i++){h=(h*1103515245+12345)&0x7fffffff;%s}}
"""


def bind(lib):
    lib.vec_set_count_draws.argtypes = [ctypes.c_int]
    lib.vec_get_draw_calls.restype = ctypes.c_ulonglong
    lib.vec_draw_kinds.restype = ctypes.c_int
    lib.vec_draw_name.restype = ctypes.c_char_p
    lib.vec_draw_name.argtypes = [ctypes.c_int]
    lib.vec_draw_count.restype = ctypes.c_ulonglong
    lib.vec_draw_count.argtypes = [ctypes.c_int]


def run(game, games_dir, steps=200, n_envs=4, secs=3.0):
    env = NativeVecEnv(game, num_envs=n_envs, obs_size=64, max_steps=100000,
                       num_threads=1, autoreset=True, frame_skip=1,
                       render_skip=False, games_dir=games_dir)
    lib = env._lib
    bind(lib)
    rng = np.random.default_rng(0)
    env.reset(seeds=np.arange(n_envs).astype(np.int32))
    acts = rng.integers(0, 8, size=(64, n_envs), dtype=np.int32)
    for i in range(20):
        env.step(acts[i % 64])
    lib.vec_reset_draw_calls(); lib.vec_set_count_draws(1)
    for i in range(steps):
        env.step(acts[i % 64])
    lib.vec_set_count_draws(0)
    per = {}
    for k in range(lib.vec_draw_kinds()):
        nm = lib.vec_draw_name(k).decode()
        c = lib.vec_draw_count(k)
        if c:
            per[nm.replace('js_', '')] = c / float(steps * n_envs)
    t0, n = time.perf_counter(), 0
    while time.perf_counter() - t0 < secs:
        env.step(acts[n % 64]); n += 1
    us = (time.perf_counter() - t0) / (n * n_envs) * 1e6
    try:
        env.close()
    except Exception:
        pass
    return per, us


PROBE.mkdir(exist_ok=True)
print("=== per-primitive cost")
price = {}
for prim, call in PRIM.items():
    xs, ys = [], []
    for n in NS:
        g = f"probe_p_{prim}_{n}"
        (PROBE / f"{g}.js").write_text(HEAD % (n, call))
        _, us = run(g, str(PROBE))
        xs.append(n); ys.append(us)
    price[prim] = np.polyfit(xs, ys, 1)[0] * 1000
    print(f"  {prim:<9} {price[prim]:7.1f} ns per call")

for tag, body in SHAPE_BODY.items():
    xs, ys = [], []
    for n in NS:
        g = f"probe_s_{tag}_{n}"
        (PROBE / f"{g}.js").write_text(SHAPE_HEAD % (body % n))
        _, us = run(g, str(PROBE))
        xs.append(n); ys.append(us)
    price[tag] = np.polyfit(xs, ys, 1)[0] * 1000
    print(f"  {tag:<9} {price[tag]:7.1f} ns per call")
# vertex() is NOT separable: sweeping vertices inside one beginShape grows a
# single polygon, so the slope measures fill AREA, not per-vertex cost (it came
# out at 1207 ns and implied a NEGATIVE begin/end pair, and billed qbert at 137%
# of its own step). The measurable unit is a whole small polygon, so charge that
# and scale it by how many vertices the game puts in each shape.
SHAPE_UNIT_NS = price.pop('shapepair')   # beginShape + 3 vertex + endShape
price.pop('vertex', None)
price['beginShape'] = 0.0                # folded into the shape unit below
price['endShape'] = 0.0
price['vertex'] = 0.0
print("\n=== games, per-binding counts")
SUITE = ("plunder bigfish bossfight ninja starpilot heist leaper maze dodgeball "
         "jumper chaser caveflyer coinrun fruitbot climber miner pong freeway "
         "seaquest space_invaders asteroids frostbite breakout qbert").split()
VAR = ["breakout.multi", "qbert.v2", "flappy_bird", "flappy_bird.dunk2",
       "frostbite.jungle"]
grid = json.load(open('outputs/grid.json'))
t0_us = grid['fit']['t0_us']
rows = []
for g in SUITE + VAR:
    per, us = run(g, GAMES)
    missing = [k for k in per if k not in price]
    if missing:
        print(f"    WARNING {g}: no price for {missing}, charged at rect rate")
    drawn = sum(per[k] * price.get(k, price['rect']) / 1000 for k in per)
    # shape API, charged per polygon and scaled by vertices-per-shape
    ns_ = per.get('endShape', 0)
    if ns_:
        vps = per.get('vertex', 0) / ns_
        drawn += ns_ * SHAPE_UNIT_NS * max(vps, 1) / 3 / 1000
    rows.append({"game": g, "per_cmd": per, "us_per_step": us,
                 "draw_us": drawn, "logic_us": max(us - t0_us - drawn, 0),
                 "sps": 1e6 / us})
    print(f"  {g:<20} draw {100 * drawn / us:3.0f}%  "
          f"({', '.join(f'{k} {v:.0f}' for k, v in sorted(per.items(), key=lambda kv: -kv[1])[:3])})")
json.dump({"price_ns": price, "shape_unit_ns": SHAPE_UNIT_NS, "rows": rows}, open('outputs/percmd.json', 'w'), indent=1)
print("wrote outputs/percmd.json")
