# archive/

Quarantined predecessors of current code. Nothing in here is imported by active
code paths; everything is kept for historical reference and to support the
`notebooks/headless_node_vs_playwright.py` legacy-comparison cell.

## Contents

| Path | Notes |
|---|---|
| `fast_games/kazuki_gym_env.py` | Original single-game Gymnasium wrapper. Superseded by `src/fast_games/env.py` (`GameGymEnv`). Still imported by the headless-vs-playwright notebook via the `fast_games.archive` shim. |
| `fast_games/validate_kazuki.py` | Old single-game validation script. Superseded by `src/fast_games/validate/validate.py`. |
| `fast_games/bench_kazuki_gym.py` | Old single-game benchmark. Superseded by `src/fast_games/validate/bench.py`. |
| `fast_games/train_sb3_ppo.py` | Minimal early PPO trainer (no configs, no W&B). Superseded by `src/fast_games/train/ppo.py`. |
| `fast_games/eval_sb3_ppo.py` | Minimal early evaluator (no seed splits). Superseded by `src/fast_games/eval/evaluate.py`. |
| `configs/kazuki_short_ppo.json` | Orphaned config from kazuki-only era. Not consumed by any current entry point. |

## Compatibility shim

`src/fast_games/archive/__init__.py` extends its package `__path__` to include
`archive/fast_games/`, so `from fast_games.archive.X import Y` still resolves.
Add nothing new under `src/fast_games/archive/` — put new archived code here
instead and the shim picks it up.
