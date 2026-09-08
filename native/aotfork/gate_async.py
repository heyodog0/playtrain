# Async/group-path gate for explicit .so paths — the path the double-buffered
# trainer uses (vec_create_async + vec_set_group_mode + worker_async), which no
# other gate exercises. For every game and every lib:
#   1. determinism: PingPongVecEnv and NativeVecEnv are driven with the SAME
#      seeds and per-env action stream; every obs/rew/term/trunc byte is hashed
#      and must equal the reference arm's SYNC digest (first lib given), so the
#      async path is checked against sync as well as lib against lib;
#   2. throughput: pingpong steps/s must be >= PP_FLOOR x the reference lib's
#      pingpong rate and >= SYNC_FLOOR x the lib's own sync rate. The shipped
#      tier-3 regression read 0.14-0.17 on the first ratio and ~0.35 on the
#      second; healthy libs read ~1.2-1.4 and ~1.4.
#   gate_async.py <steps> <games csv> name=/path.so [name=/path.so ...]
# "{game}" in a path is substituted per game. Env: WE, GDIR, GROUP (256),
# THREADS (5), PP_FLOOR (0.8), SYNC_FLOOR (0.6), QJS_DIRTY as for training.
import hashlib
import os
import sys
import time

import numpy as np

WE = os.environ["WE"]
GDIR = os.environ["GDIR"]
sys.path.insert(0, WE + "/src")
from playtrain.runtime.native_vec_env import NativeVecEnv, PingPongVecEnv  # noqa: E402

STEPS = int(sys.argv[1])
GAMES = sys.argv[2].split(",")
ARMS = [a.split("=", 1) for a in sys.argv[3:]]
GROUP = int(os.environ.get("GROUP", 256))
THREADS = int(os.environ.get("THREADS", 5))
PP_FLOOR = float(os.environ.get("PP_FLOOR", 0.8))
SYNC_FLOOR = float(os.environ.get("SYNC_FLOOR", 0.6))
N = 2 * GROUP
COMMON = dict(obs_size=64, max_steps=2000, num_threads=THREADS, frame_skip=1, games_dir=GDIR)


def actions(env):
    rng = np.random.default_rng(7)
    return rng.integers(0, env.n_actions, size=(64, N)).astype(np.int32)


def absorb(h, obs, rew, term, trunc):
    for x in (obs, rew, term, trunc):
        h.update(np.ascontiguousarray(x).tobytes())


def run_sync(game, lib):
    env = NativeVecEnv(game, num_envs=N, lib_path=lib, autoreset=True, **COMMON)
    env.reset(seeds=np.arange(N, dtype=np.int32))
    acts = actions(env)
    h = hashlib.blake2b(digest_size=8)
    t0 = time.perf_counter()
    for k in range(STEPS):
        out = env.step(acts[k % 64])
        absorb(h, *out[:4])
    dt = time.perf_counter() - t0
    env.close()
    return h.hexdigest(), STEPS * N / dt


def run_pingpong(game, lib):
    env = PingPongVecEnv(game, group_size=GROUP, lib_path=lib, **COMMON)
    env.reset(seeds=np.arange(N, dtype=np.int32))
    acts = actions(env)
    # group g's k-th step uses action row k, same as sync step k; hash per group
    # then combine in env order so the digest equals the sync one.
    hs = [hashlib.blake2b(digest_size=8) for _ in range(2)]
    parts = [[], []]
    k = [0, 0]
    env.send(0, acts[0][:GROUP]); env.send(1, acts[0][GROUP:])
    t0 = time.perf_counter()
    for i in range(2 * STEPS):
        g = i & 1
        obs, rew, term, trunc = env.wait(g)
        parts[g].append((obs.copy(), rew.copy(), term.copy(), trunc.copy()))
        k[g] += 1
        if k[g] < STEPS:
            row = acts[k[g] % 64]
            env.send(g, row[:GROUP] if g == 0 else row[GROUP:])
    dt = time.perf_counter() - t0
    env.close()
    h = hashlib.blake2b(digest_size=8)
    for s in range(STEPS):
        o0, r0, t0_, u0 = parts[0][s]; o1, r1, t1, u1 = parts[1][s]
        absorb(h, np.concatenate([o0, o1]), np.concatenate([r0, r1]),
               np.concatenate([t0_, t1]), np.concatenate([u0, u1]))
    return h.hexdigest(), 2 * STEPS * GROUP / dt


fails = 0
for g in GAMES:
    ref_digest = ref_pp = None
    row = []
    for name, path in ARMS:
        p = path.replace("{game}", g)
        if not os.path.exists(p):
            row.append(f"{name}=MISSING"); fails += 1; continue
        ds, sps_s = run_sync(g, p)
        dp, sps_p = run_pingpong(g, p)
        if ref_digest is None:
            ref_digest, ref_pp = ds, sps_p
        bad = []
        if ds != ref_digest: bad.append("SYNC-MISMATCH")
        if dp != ref_digest: bad.append("PP-MISMATCH")
        r_ref, r_sync = sps_p / ref_pp, sps_p / sps_s
        if r_ref < PP_FLOOR: bad.append(f"PP/REF={r_ref:.2f}<{PP_FLOOR}")
        if r_sync < SYNC_FLOOR: bad.append(f"PP/SYNC={r_sync:.2f}<{SYNC_FLOOR}")
        fails += 1 if bad else 0
        row.append(f"{name}: {dp[:8]} pp={sps_p:,.0f} sync={sps_s:,.0f} pp/ref={r_ref:.2f}"
                   + (" FAIL " + ",".join(bad) if bad else ""))
    print(f"{g:16s} " + "  |  ".join(row), flush=True)
print(f"ASYNC GATE {'PASS' if fails == 0 else 'FAIL'} ({STEPS} steps x {N} envs, group {GROUP}, "
      f"{THREADS} threads, {len(GAMES)} games, {fails} failures)")
sys.exit(1 if fails else 0)
