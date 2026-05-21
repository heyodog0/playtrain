# Environment Validation

This document describes how the headless Kazuki RL environment is validated, following patterns from [Procgen](https://github.com/openai/procgen) and standard Gymnasium practices.

## Why validate

The environment runs a p5.js browser game headlessly via node-canvas. We need to prove:

- The Gymnasium API contract is correct
- The environment is deterministic (same seed + actions = same trajectory)
- Observations are well-formed and non-degenerate
- Rewards and terminal signals match actual game state

## Validation axes

| # | Check | What it proves |
|---|---|---|
| 1 | **API compliance** | `gymnasium.utils.env_checker.check_env()` passes — spaces, dtypes, shapes, reset/step contract |
| 2 | **Determinism** | Two independent env instances with identical seed and actions produce bit-identical observations, rewards, and game states at every step |
| 3 | **Observation sanity** | Shape `(84,84,4)`, dtype `uint8`, range `[0,255]`, non-degenerate (many unique values), frames change over time |
| 4 | **Reward / terminal** | Reward equals score delta at each step, `terminated` iff `gameState` in `{WIN, EXIT, GAMEOVER}`, cumulative reward equals final minus initial score |

## Running

```bash
uv run python -m gym_gen.validate.validate --all
```

All checks pass/fail to stdout. Exit code 0 if all pass, 1 otherwise.

## Artifacts

Generated under `outputs/validation/`:

| File | Description |
|---|---|
| `observation_grid.png` | 5x4 grid of 84x84 grayscale frames sampled across a 200-step episode |
| `determinism_proof.png` | Three rows: run A frames, run B frames, absolute pixel diff (all-black = identical) |
| `frame_stack.png` | The 4 channels of one `84x84x4` stacked observation (t-3, t-2, t-1, t) |
| `validation_results.json` | Machine-readable pass/fail results with timestamps |

## Design notes

**Determinism** is tested with two separate `KazukiGymEnv` instances, each spawning its own Node worker subprocess. This proves there is no leaked state across process boundaries. The seeded RNG (mulberry32 in `envs/kazuki-env.mjs`) controls all procedural generation.

**Observation equivalence vs pixel equivalence**: We validate that the headless env is internally deterministic. We do not pixel-compare against Playwright/Chromium because Cairo (node-canvas) and Skia (Chrome) rasterize differently. For RL, what matters is that the same seed and actions always produce the same MDP trajectory — not that two rendering engines produce identical anti-aliasing.

**Procgen alignment**: Like Procgen, this validation emphasizes determinism guarantees, observation standardization (fixed 84x84 grayscale), and reproducibility via seeded state. The scripted policy used for validation mirrors the `actionForFrame` pattern from the benchmarks.
