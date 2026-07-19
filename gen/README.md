# gym-gen

LLM-driven generation and natural-language modification of p5.js 2D RL environments. Built on [`node-gym`](https://github.com/heyodog0/node-gym) (the headless runtime); this repo owns the game catalog, the generation pipeline, and the ProcGen-style validation harness that gates which generated games ship.

- **Game generation**: Gemini generates p5.js (Discrete(8), 64×64 RGB) games from strict templates
- **Headless runtime**: Games run in Node.js via `node-canvas` — no browser. Runtime lives in the sibling [`node-gym`](https://github.com/heyodog0/node-gym) repo.
- **Validation harness**: 5-check ProcGen-style suite (shape, action-space, determinism, throughput, episode bounds) — generated games must pass before being added to the catalog.
- **Game tester**: Browser UI for playtesting + Gemini-powered refinement via feedback.

> Training, evaluation, and figure generation for the paper live in the sibling `paper/` repo (`gym-gen-experiments`). gym-gen itself stays focused on generation + the contract its games must satisfy. The pre-refactor snapshot with training code inline is preserved at the `v0.1-paper-submission` tag.

## Setup

Requires Node.js 24+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), and [`just`](https://just.systems) (`brew install just`).

```bash
git clone https://github.com/heyodog0/gym-gen
cd gym-gen
just bootstrap   # clones sibling node-gym + installs deps in both repos
```

After future pulls, run `just sync-all` to refresh both repos.

## Commands

Run `just` (no args) to see every recipe with a one-line description. The most common ones:

```bash
just sync-all                # pull node-gym + reinstall deps in both repos
just validate                # run 5-check ProcGen validation suite
just bench                   # FPS per game
just tester                  # browser playtest UI (localhost:3000)
```

Generate a new game from a Gemini catalog (the `games/catalogs/*.json` files — `atari`, `arcade`, `mobile`, `nes`, `procgen` — each list 25 game specs). The second arg matches the `name` field inside the catalog JSON:

```bash
just gen-game games/catalogs/atari_games.json breakout
just gen-game games/catalogs/procgen_games.json caveflyer
```

Game variants (prototype forks) and CI:

```bash
just variant parent "prompt"     # derive a variant of an existing game
just promote name                # promote a variant into the catalog
just ci                          # validate + bench (what CI covers)
```

> Training, evaluation, and figure generation moved to the sibling `paper/` repo; those recipes no longer live here.

## Games

**p5** games in `games/js/` — Discrete(8), 64×64 RGB, seeded determinism. Two use Matter.js physics (`angry_birds`, `suika`); the rest are pure p5.

The generation pipeline writes to `games/js/`. See `GAME_TEMPLATE.md` for the per-game contract.

## Repo Map

```text
src/gym_gen/      validation + benchmark entrypoints (the shipping package)
tools/            generation / refinement / tester scripts
games/            game source (js/), catalogs, procgen refs, variants
docs/             LLM prompts + validation write-ups + atari specs
outputs/          benchmark + validation results
```

The Node.js runtime (game worker + p5 shim) lives in sibling [`node-gym`](https://github.com/heyodog0/node-gym). Training, evaluation, and paper figures live in the sibling `paper/` repo (`gym-gen-experiments`).

## Design

- **Action space**: Discrete(8) — abstract directional + button, identical across all games
- **Observations**: 64×64×3 RGB, matching ProcGen conventions
- **Seed-based determinism**: same seed + actions ⇒ same trajectory
- **Train/test split & metrics**: seeds 0–199 train / 1000–1099 test, IQM over normalized scores — the evaluation methodology, exercised in the sibling `paper/` repo

See `GAME_TEMPLATE.md` for the per-game spec and `docs/llm/VALIDATION.md` for the validation harness.
