# Round-3 obs-checksum probe: same seeds + action sequence through each .so
# variant; every observation/reward/done byte hashed; any mismatch vs live =
# FAIL. Clone of playtrain-trainers/benchmarks/tune_obs_checksum.py with one
# addition: a variant named cb* (except cb0) runs with PLAYTRAIN_QJS_CMDBUF=1.
import hashlib
import os
import sys

import numpy as np

WT = "/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-tuning"
LIVE = "/n/holylabs/gershman_lab/Users/rtruong/playtrain"
sys.path.insert(0, WT + "/src")
from playtrain.runtime.native_vec_env import NativeVecEnv  # noqa: E402

GAMES = ["breakout", "miner", "maze", "bigfish", "plunder"]
STEPS = int(sys.argv[1]) if len(sys.argv) > 1 else 300
VARIANTS = sys.argv[2].split(",") if len(sys.argv) > 2 else []
ENVS = 32
GDIR = LIVE + "/examples/games/js"


def lib(v):
    if v == "live":
        return LIVE + "/native/build/libqjs_vec.so"
    return WT + f"/native/build/variants/libqjs_vec.{v}.so"


def run(game, v):
    os.environ["PLAYTRAIN_QJS_CMDBUF"] = \
        "1" if (v.startswith("cb") and v != "cb0") else "0"
    env = NativeVecEnv(game, num_envs=ENVS, obs_size=64, max_steps=2000,
                       num_threads=2, autoreset=True, frame_skip=1,
                       games_dir=GDIR, lib_path=lib(v))
    h = hashlib.md5()
    obs = env.reset(seeds=np.arange(ENVS, dtype=np.int32))
    h.update(np.ascontiguousarray(obs).tobytes())
    rng = np.random.default_rng(7)
    for _ in range(STEPS):
        acts = rng.integers(0, 8, ENVS).astype(np.int32)
        out = env.step(acts)
        obs = out[0] if isinstance(out, tuple) else out
        h.update(np.ascontiguousarray(obs).tobytes())
        if isinstance(out, tuple):
            for x in out[1:]:
                if isinstance(x, np.ndarray):
                    h.update(np.ascontiguousarray(x).tobytes())
    env.close()
    return h.hexdigest()


fails = 0
for g in GAMES:
    ref = run(g, "live")
    row = [f"{g:<10} live={ref[:10]}"]
    for v in VARIANTS:
        h = run(g, v)
        ok = h == ref
        fails += 0 if ok else 1
        row.append(f"{v}:{'OK' if ok else 'MISMATCH'}")
    print("  ".join(row), flush=True)
print("CHECKSUM_PASS" if fails == 0 else f"CHECKSUM_FAIL n={fails}")
sys.exit(1 if fails else 0)
