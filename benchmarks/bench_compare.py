"""Head-to-head per-core environment-throughput benchmark: PlayTrain vs ale-py
vs procgen, on matched methodology. This is the harness behind the paper's
environment-layer figure.

One backend per invocation (each baseline lives in its own venv, since procgen
and envpool pin incompatible gym/numpy):

    # PlayTrain, QuickJS + native rasterizer -- the canonical backend, and the
    # one the paper reports. Needs the native build (native/build_qjs.sh):
    python benchmarks/bench_compare.py --backend qjs  --suite procgen --trials 7
    python benchmarks/bench_compare.py --backend qjs  --suite atari   --trials 7

    # PlayTrain, Node.js/node-canvas fallback -- 3-4x slower, superseded. Kept
    # only for machines with no native build; do NOT mix into a qjs figure:
    python benchmarks/bench_compare.py --backend node --suite procgen

    # Atari baseline (venv with ale_py + gymnasium):
    python benchmarks/bench_compare.py --backend ale     --suite atari   --trials 7

    # ProcGen baseline (needs the `procgen` package + old gym; see note below):
    python benchmarks/bench_compare.py --backend procgen --suite procgen --trials 7

Each run writes outputs/compare/<backend>_<suite>.json. Merge + plot separately.

Methodology (identical across backends):
  * 1 env step = 1 emulated/drawn frame (no frameskip). ALE uses the
    NoFrameskip-v4 ids; PlayTrain is natively 1 draw/step; procgen is 1 frame/step.
  * single env, one core -- no vectorization, no coordinator, on either side.
  * random actions from each env's own action space.
  * `warmup` steps discarded, then `frames` timed steps, `trials` times; report
    steps/sec median (+ mean and pstdev). Fresh env per trial. Auto-reset on
    terminal.
  * observations are each system's native resolution (PlayTrain 64x64 RGB,
    ALE 210x160 RGB, procgen 64x64 RGB). Resolution differences are recorded
    in the JSON, not normalized away -- state them in the paper.
"""
from __future__ import annotations
import argparse, json, statistics, time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "outputs" / "compare"

# PlayTrain game name -> ALE env id (NoFrameskip-v4 == frameskip 1, no sticky actions)
ATARI = {
    "breakout": "BreakoutNoFrameskip-v4",
    "space_invaders": "SpaceInvadersNoFrameskip-v4",
    "freeway": "FreewayNoFrameskip-v4",
    "frostbite": "FrostbiteNoFrameskip-v4",
    "asteroids": "AsteroidsNoFrameskip-v4",
    "qbert": "QbertNoFrameskip-v4",
    "seaquest": "SeaquestNoFrameskip-v4",
    "pong": "PongNoFrameskip-v4",
}
PROCGEN = ["bigfish", "bossfight", "caveflyer", "chaser", "climber", "coinrun",
           "dodgeball", "fruitbot", "heist", "jumper", "leaper", "maze",
           "miner", "ninja", "plunder", "starpilot"]


FIXED = False   # set from CLI; pin one action sequence, reused verbatim each trial


def _summ(fps):
    return {
        "fps_median": statistics.median(fps),
        "fps_mean": statistics.fmean(fps),
        "fps_std": statistics.pstdev(fps) if len(fps) > 1 else 0.0,
        "fps_min": min(fps), "fps_max": max(fps),
        "fps_trials": fps,
    }


def _run(make_env, close_env, do_reset, do_step, n_actions,
         frames, warmup, trials, seed):
    """Fresh env per trial. do_step(action)->done. Reports per-trial fps.

    A fixed (seeded) action sequence is pinned once and reused across trials
    when FIXED; otherwise a fresh seeded rng is drawn per trial (still
    deterministic across trials, but re-derived). Fresh env per trial isolates
    heap/GC accumulation; report median to shrug off GC/thermal spikes.
    """
    total = warmup + frames
    pinned = np.random.default_rng(seed).integers(0, n_actions, size=total) if FIXED else None
    fps = []
    for _ in range(trials):
        env = make_env()
        try:
            do_reset(env, seed)
            rng = np.random.default_rng(seed)
            def nexta(i):
                return int(pinned[i]) if FIXED else int(rng.integers(0, n_actions))
            for i in range(warmup):
                if do_step(env, nexta(i)):
                    do_reset(env, seed)
            t0 = time.perf_counter()
            for i in range(warmup, warmup + frames):
                if do_step(env, nexta(i)):
                    do_reset(env, seed)
            fps.append(frames / (time.perf_counter() - t0))
        finally:
            close_env(env)
    return fps


_shape = {}


def _bench(games, make, reset, step, n_actions, frames, warmup, trials, seed, label=lambda g: g):
    results = []
    for g in games:
        print(f"  {label(g):<32} ", end="", flush=True)
        try:
            fps = _run(lambda g=g: make(g), lambda e: e.close(),
                       reset, step, n_actions(g) if callable(n_actions) else n_actions,
                       frames, warmup, trials, seed)
            r = {"game": g, **_summ(fps)}
            print(f"median {r['fps_median']:7.0f}   mean {r['fps_mean']:7.0f} +/- {r['fps_std']:5.0f}")
            results.append(r)
        except Exception as e:
            print(f"ERROR {str(e)[:110]}")
            results.append({"game": g, "error": str(e)[:200]})
    return results, {"obs_shape": _shape.get("last")}


def _bench_playtrain(env_cls, games, frames, warmup, trials, seed):
    def step(env, a):
        obs, _, term, trunc, _ = env.step(a)
        _shape["last"] = list(obs.shape)
        return term or trunc

    return _bench(games,
                  make=lambda g: env_cls(game=g, max_steps=frames + warmup + 100),
                  reset=lambda env, s: env.reset(seed=s),
                  step=step, n_actions=8,
                  frames=frames, warmup=warmup, trials=trials, seed=seed)


def bench_qjs(games, frames, warmup, trials, seed):
    """QuickJS + native rasterizer (playtrain.runtime.GameEnv) — the canonical backend."""
    from playtrain.runtime import GameEnv

    return _bench_playtrain(GameEnv, games, frames, warmup, trials, seed)


def bench_node(games, frames, warmup, trials, seed):
    """Node.js + node-canvas fallback — superseded by qjs; 3-4x slower."""
    from playtrain.runtime import PlayTrainEnv

    return _bench_playtrain(PlayTrainEnv, games, frames, warmup, trials, seed)


def bench_ale(games, frames, warmup, trials, seed):
    import gymnasium as gym, ale_py
    gym.register_envs(ale_py)

    def step(env, a):
        obs, _, term, trunc, _ = env.step(a)
        _shape["last"] = list(obs.shape)
        return term or trunc

    return _bench(games,
                  make=lambda g: gym.make(ATARI[g], frameskip=1, repeat_action_probability=0.0),
                  reset=lambda env, s: env.reset(seed=s),
                  step=step,
                  n_actions=lambda g: gym.make(ATARI[g]).action_space.n,
                  frames=frames, warmup=warmup, trials=trials, seed=seed,
                  label=lambda g: f"{g} ({ATARI[g]})")


def bench_procgen(games, frames, warmup, trials, seed):
    try:
        import gym  # old-style gym required by procgen
        import procgen  # noqa: F401  (registers procgen-* envs on import)
    except Exception as e:
        raise SystemExit(f"procgen baseline needs the `gym` + `procgen` packages "
                         f"(not installed): {e}")

    def step(env, a):
        obs, _, done, _ = env.step(a)
        _shape["last"] = list(getattr(obs, "shape", []))
        return done

    return _bench(games,
                  make=lambda g: gym.make(f"procgen-{g}-v0", num_levels=0, start_level=0),
                  reset=lambda env, s: env.reset(),
                  step=step,
                  n_actions=lambda g: gym.make(f"procgen-{g}-v0").action_space.n,
                  frames=frames, warmup=warmup, trials=trials, seed=seed)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--backend", choices=["qjs", "node", "ale", "procgen"], required=True,
                   help="qjs = PlayTrain QuickJS + native rasterizer (canonical); "
                        "node = PlayTrain Node/canvas fallback (superseded); "
                        "ale / procgen = baselines")
    p.add_argument("--suite", choices=["atari", "procgen"], required=True)
    p.add_argument("--frames", type=int, default=500)
    p.add_argument("--warmup", type=int, default=100)
    p.add_argument("--trials", type=int, default=10)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--games", type=str, default=None, help="comma-separated subset to bench")
    p.add_argument("--fixed-actions", action="store_true",
                   help="pin one seeded action sequence, reused verbatim each trial")
    a = p.parse_args()
    global FIXED
    FIXED = a.fixed_actions

    games = list(ATARI.keys()) if a.suite == "atari" else PROCGEN
    if a.games:
        want = set(a.games.split(","))
        games = [g for g in games if g in want]
    if a.backend == "ale" and a.suite != "atari":
        raise SystemExit("ale backend only supports --suite atari")
    if a.backend == "procgen" and a.suite != "procgen":
        raise SystemExit("procgen backend only supports --suite procgen")

    print(f"=== {a.backend} / {a.suite} : {len(games)} games, "
          f"{a.frames}f x {a.trials}t, warmup {a.warmup}, seed {a.seed} ===")
    fn = {"qjs": bench_qjs, "node": bench_node,
          "ale": bench_ale, "procgen": bench_procgen}[a.backend]
    results, meta = fn(games, a.frames, a.warmup, a.trials, a.seed)

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{a.backend}_{a.suite}.json"
    payload = {"backend": a.backend, "suite": a.suite,
               "frames": a.frames, "warmup": a.warmup, "trials": a.trials, "seed": a.seed,
               "fixed_actions": a.fixed_actions,
               "note": "1 step = 1 frame (no frameskip); native obs resolution per system; report median",
               **meta, "results": results}
    # cannot call datetime.now under some sandboxes; guard it
    try:
        payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    except Exception:
        pass
    out.write_text(json.dumps(payload, indent=1))
    ok = [r for r in results if "fps_median" in r]
    if ok:
        print(f"\nsuite median-of-medians: {statistics.median(r['fps_median'] for r in ok):.0f} FPS "
              f"({len(ok)}/{len(results)} games)  ->  {out}")


if __name__ == "__main__":
    main()
