# PGO profile driver for the fork vec .so's (copy of pgo/_t2prof_driver.py,
# explicit lib path). Runs the published iteration shape (128 envs, 5 threads)
# for `dur` seconds so the profraw reflects the vec workload, not qjs_host.
#   LLVM_PROFILE_FILE=<dir>/<tag>-%m-%p.profraw python vec_prof_driver.py <lib.so> <game.js> <dur>
import sys, time
import numpy as np
from playtrain.runtime.native_vec_env import NativeVecEnv
lib, game_js, dur = sys.argv[1], sys.argv[2], float(sys.argv[3])
env = NativeVecEnv(game_js, num_envs=128, obs_size=64, max_steps=2000,
                   num_threads=5, autoreset=True, frame_skip=1, lib_path=lib)
env.reset(seeds=np.arange(128, dtype=np.int32))
rng = np.random.default_rng(0)
acts = rng.integers(0, 8, size=(64, 128), dtype=np.int32)
t0, n = time.time(), 0
while time.time() - t0 < dur:
    env.step(acts[n % 64]); n += 1
print(f"{game_js.split('/')[-1]} {n*128/(time.time()-t0):,.0f} steps/s (instrumented)", file=sys.stderr)
env.close()
