# browserless-game-RL

Generate p5.js games via LLM and train RL agents on them at native speed — no browser.

- **Game generation**: Gemini generates p5.js games from a strict template with fixed Discrete(8) action space and 64x64 RGB observations (matching ProcGen)
- **Headless runtime**: Games run in Node.js via a p5.js shim on `node-canvas` — no browser process, no DOM
- **RL training**: Python Gymnasium wrapper + SB3 PPO, validated against ProcGen-style criteria
- **Game tester**: Browser UI for playtesting + Gemini-powered refinement via feedback

## What Exists

- `tools/`: game generator CLI + browser-based tester with Gemini refinement
- `games/`: game catalogs (10 Atari, 10 mobile) + generated game files
- `GAME_TEMPLATE.md`: strict spec for LLM-generated games (action space, observations, visual rules, mechanical constraints)
- `poc/p5/`: headless Canvas 2D runtime
- `envs/`: Node-side environment + IPC worker
- `src/fast_llm_games/`: Python Gymnasium wrapper, PPO training, validation
- `benchmarks/`: headless vs Playwright comparison

## Setup

```bash
npm install
uv sync
```

Requires Node.js 24+, Python 3.11+, and `uv`.

## Game Generation

Generate games from catalogs using Gemini:

```bash
# Set your API key
export GEMINI_API_KEY=your-key

# Generate one game
uv run python tools/generate.py --catalog games/atari_games.json --name breakout

# Generate all Atari games with reference context
uv run python tools/generate.py --catalog games/atari_games.json --ref

# Generate all games (both catalogs) with Gemini Pro
uv run python tools/generate.py --all --model pro
```

## Game Tester

Playtest games in the browser and refine them via Gemini feedback:

```bash
uv run python tools/tester.py
# open http://localhost:3000
```

Select a game from the sidebar, play it, type feedback, and click Refine. The game file is updated in-place and reloads automatically.

## RL Training

```bash
uv run python -m fast_llm_games.train_sb3_ppo --config configs/kazuki_short_ppo.json
uv run python -m fast_llm_games.eval_sb3_ppo --model-path outputs/models/kazuki_ppo.zip
```

## Benchmarks

Apple M4 Pro, 84x84 grayscale observations:

| Approach | FPS | Speedup |
|---|---:|---:|
| Node headless render only | 2,570 | — |
| Node headless RL step | 1,623 | 20x vs Playwright |
| Playwright base64 | 1,154 | 14x vs getImageData |
| Playwright getImageData | 82 | 1x (baseline) |
| Playwright screenshot | 23 | 0.3x |

The bottleneck is never the game — rendering costs ~0.4 ms either way. The gap is entirely in how pixels get from the game to the RL agent. See the [marimo notebook](notebooks/headless_node_vs_playwright.py) for the full breakdown.

```bash
npm run bench:kazuki
uv run python -m fast_llm_games.bench_kazuki_gym --frames 1000
```

## Validation

The environment is validated against Procgen-style criteria: API compliance, determinism, observation sanity, and reward/terminal correctness. See [VALIDATION.md](VALIDATION.md) for details.

```bash
uv run python -m fast_llm_games.validate_kazuki
```

Visual proof artifacts (observation grids, determinism proof, frame stack) are saved to `outputs/validation/`.

## Notebooks

Interactive marimo notebook for benchmarking analysis:

```bash
uv run marimo edit notebooks/headless_node_vs_playwright.py
```

A pre-rendered HTML export is also available at `notebooks/headless_node_vs_playwright.html`.

## Repo Map

```text
tools/                    game generator + browser tester
games/                    game catalogs (.json) + generated games (.js)
GAME_TEMPLATE.md          strict spec for LLM-generated games
envs/                     Node-side environment runtime + IPC worker
poc/p5/                   headless p5.js shim + helpers
src/fast_llm_games/       Python Gymnasium wrapper, PPO training, validation
benchmarks/               headless vs Playwright comparison
notebooks/                marimo notebooks + Node demos
configs/                  PPO presets
outputs/                  generated benchmarks, evals, models, validation
```

## Design

See `GAME_TEMPLATE.md` for the full game spec. Key points:

- **Action space**: Discrete(8) — abstract directional + button, identical across all games (like ProcGen's Discrete(15))
- **Observations**: 64x64x3 RGB, no frame stacking (matches ProcGen)
- **Games**: single `.js` files, seeded RNG for deterministic procedural generation, ProcGen-style visuals
- **Runtime**: 1,623 FPS headless / 1,154 FPS base64 / 82 FPS getImageData / 23 FPS screenshot

See `llm-games-rl-pipeline.md` for the broader research motivation.
