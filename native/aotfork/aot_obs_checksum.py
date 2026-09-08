# Obs-checksum determinism probe for explicit .so paths (no .so swapping).
# Same seeds + action sequence through every lib; every observation/reward/done
# byte hashed. Any digest mismatch vs the first lib (the reference arm) = FAIL.
#   aot_obs_checksum.py <steps> <games csv> name=/path.so [name=/path.so ...]
# For a per-game lib (F1: libqjs_vec.fut_<game>.so) use the literal "{game}" in
# the path; it is substituted per game.
import hashlib
import os
import sys

import numpy as np

WE = os.environ["WE"]
GDIR = os.environ["GDIR"]
sys.path.insert(0, WE + "/src")
from playtrain.runtime.native_vec_env import NativeVecEnv  # noqa: E402

STEPS = int(sys.argv[1])
GAMES = sys.argv[2].split(",")
ARMS = [a.split("=", 1) for a in sys.argv[3:]]
ENVS = 32


def run(game, lib):
    env = NativeVecEnv(game, num_envs=ENVS, obs_size=64, max_steps=2000,
                       num_threads=2, autoreset=True, frame_skip=1,
                       games_dir=GDIR, lib_path=lib)
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
    ref = None
    row = []
    for name, path in ARMS:
        p = path.replace("{game}", g)
        if not os.path.exists(p):
            row.append(f"{name}=MISSING"); fails += 1; continue
        d = run(g, p)
        if ref is None:
            ref = d
        ok = d == ref
        fails += 0 if ok else 1
        row.append(f"{name}={d[:10]}{'' if ok else ' MISMATCH'}")
    print(f"{g:16s} " + "  ".join(row), flush=True)
print(f"CHECKSUM {'PASS' if fails == 0 else 'FAIL'} ({STEPS} steps x {ENVS} envs, {len(GAMES)} games, {fails} mismatches)")
sys.exit(1 if fails else 0)
