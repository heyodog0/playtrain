"""Ladder arms A1 (shared_cpu) / A2 (central_gpu): one qjs GameEnv per actor.

Mirrors playtrain_trainers.train_impala's CLI, but injects the canonical
QuickJS GameEnv as env_fn. The default config-file path (env_backend=
"playtrain", env_fn=None) would silently use the superseded Node/canvas
fallback, 3-4x slower per env — see benchmarks/bench_impala.py's docstring.
That fallback is NOT what any reported number uses, so the ladder's A1/A2
rungs must not use it either.

Usage:  .venv/bin/python tools/bench_ladder_a12.py --config cfg.json
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import logging
from pathlib import Path

# Anchor assertions: fail immediately if the trainer API drifted.
from playtrain_trainers.impala.train import ImpalaConfig, train
from playtrain.runtime import GameEnv

assert "inference_mode" in {f.name for f in dataclasses.fields(ImpalaConfig)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()

    logging.basicConfig(
        format="[%(levelname)s %(asctime)s] %(message)s", level=logging.INFO
    )

    raw = json.loads(args.config.read_text())
    valid = {f.name for f in dataclasses.fields(ImpalaConfig)}
    ignored = set(raw) - valid
    if ignored:
        logging.warning("Ignoring unknown config keys: %s", sorted(ignored))
    cfg = ImpalaConfig(**{k: v for k, v in raw.items() if k in valid})
    if cfg.inference_mode not in ("shared_cpu", "central_gpu"):
        raise SystemExit(
            f"this launcher is for A1/A2 only, got {cfg.inference_mode!r}")

    game, seed = cfg.game, cfg.seed

    def env_fn(actor_index: int):
        return GameEnv(game=game, obs_size=64), seed * 1_000_000 + actor_index

    result = train(cfg, env_fn=env_fn)
    logging.info("Done: %s", result)


if __name__ == "__main__":
    main()
