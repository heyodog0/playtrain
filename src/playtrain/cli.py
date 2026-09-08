"""One entry point, so the tools are reachable without installing anything:

    uvx playtrain games
    uvx playtrain bench --game bigfish --num-envs 64

Subcommands that belong to the generation pipeline need the ``gen`` extra
(``uvx --from 'playtrain[gen]' playtrain generate``); they are imported lazily
so the runtime subcommands work without it.
"""
from __future__ import annotations

import argparse
import sys
import time


def _cmd_games(args: argparse.Namespace) -> int:
    from playtrain.runtime import list_available_games

    for name in list_available_games():
        print(name)
    return 0


def _cmd_bench(args: argparse.Namespace) -> int:
    import numpy as np

    from playtrain.runtime import NativeVecEnv

    venv = NativeVecEnv(game=args.game, num_envs=args.num_envs,
                        num_threads=args.threads, obs_size=args.obs_size)
    venv.reset(0)
    actions = np.zeros(args.num_envs, dtype=np.int64)
    for _ in range(20):
        venv.step(actions)

    start = time.perf_counter()
    for _ in range(args.steps):
        venv.step(actions)
    elapsed = time.perf_counter() - start
    venv.close()

    total = args.steps * args.num_envs
    print(f"{args.game}: {total / elapsed:,.0f} steps/s "
          f"({args.num_envs} envs, {args.threads} threads, {elapsed:.2f}s)")
    return 0


def _cmd_delegate(module: str) -> int:
    # The generation tools keep their own argument parsing; hand off argv.
    import importlib

    sys.argv = sys.argv[1:]
    return importlib.import_module(module).main()


def main() -> int:
    parser = argparse.ArgumentParser(prog="playtrain", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("games", help="list the game catalog")

    bench = sub.add_parser("bench", help="measure environment throughput")
    bench.add_argument("--game", default="bigfish")
    bench.add_argument("--num-envs", type=int, default=64)
    bench.add_argument("--threads", type=int, default=0, help="0 = one per core")
    bench.add_argument("--obs-size", type=int, default=64)
    bench.add_argument("--steps", type=int, default=300)

    for name, mod in (("validate", "playtrain.gen.validate.validate"),
                      ("generate", "playtrain.gen.generate"),
                      ("variant", "playtrain.gen.variant"),
                      ("refine", "playtrain.gen.refine")):
        sub.add_parser(name, add_help=False, help=f"{name} (needs the 'gen' extra)")

    args, rest = parser.parse_known_args()
    if args.cmd == "games":
        return _cmd_games(args)
    if args.cmd == "bench":
        return _cmd_bench(args)
    return _cmd_delegate({"validate": "playtrain.gen.validate.validate",
                          "generate": "playtrain.gen.generate",
                          "variant": "playtrain.gen.variant",
                          "refine": "playtrain.gen.refine"}[args.cmd])


if __name__ == "__main__":
    raise SystemExit(main())
