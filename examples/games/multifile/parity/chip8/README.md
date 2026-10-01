# CHIP-8 (Octax games)

The 22 CHIP-8 arcade games from Octax, on a CHIP-8 interpreter that steps
exactly like Octax's JAX emulator. Games with several levels ship one bundle
per level, so there are 39 games: `chip8_brix`, `chip8_tetris`,
`chip8_cavern1` and so on.

Reference: [`riiswa/octax`](https://github.com/riiswa/octax) at `3aa53b5`, MIT.
Radji, Michel and Piteau, [Octax](https://arxiv.org/abs/2510.01764), ICLR 2026.
Each ROM keeps its original author, listed in `manifest.json`.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/parity/chip8/dist \
    --out dist/chip8-play --title "CHIP-8"
$ uv run python -m http.server -d dist/chip8-play 8000
```

Open <http://localhost:8000/game/chip8_brix/>. Games run at 15 steps/s. The keys
are the CHIP-8 keypad laid over the left of a QWERTY keyboard, so `1 2 3 4`,
`Q W E R`, `A S D F` and `Z X C V`. Each game's page lists the keys it uses.

## Train an agent

```json
{
  "game": "chip8_brix",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 3,
  "obs_shape": [3, 64, 64],
  "net": "impala",
  "total_steps": 10000000,
  "log_dir": "outputs/chip8_brix"
}
```

```console
$ python -m playtrain_trainers.train_impala --config chip8_brix.json
```

Each game has its own action count. Set `num_actions` to the length of the
`actions` list in `dist/chip8_<game>.json`.

## Observation and actions

The 64x32 CHIP-8 display drawn 1:1 into rows 16 to 47 of a 64x64 frame. Octax
stacks four frames per step. PlayTrain observes the last one, and
`frame_stack=4` stacks the last four steps instead.

The actions are Octax's `action_set` keys in Octax's order, then NOOP. An action
index means the same thing in both. Episodes stop at 4,500 steps.

## What is exact

- Full machine state, every step, against Octax: registers, stack, timers,
  keypad, display, RNG key, score, reward and termination. Checked on all 39
  bundles, 3 seeds of 500 steps each, including steps after the game ends.
- All 193 opcode cases from Octax's own tests, and `jax.random` threefry over
  10,000 keys.
- QuickJS and V8 produce byte-identical runs.
- Not matched: pixel scale, Octax's in-step frame stack, sound, and the NOOP step
  every PlayTrain game takes at reset.

Octax's quirks stay in, because matching them is the point. Timers underflow
to 255 in 16 of the games, and `8XYN` always writes VF. `manifest.json` lists
them all.

## Tests

```console
$ uv run pytest examples/games/multifile/parity/chip8/tests -q
```

CI checks the golden hashes. The lockstep test needs Octax in its own venv:

```console
$ git clone https://github.com/riiswa/octax /tmp/octax && git -C /tmp/octax checkout 3aa53b5
$ uv venv -p 3.12 /tmp/octax-venv
$ uv pip install -p /tmp/octax-venv/bin/python 'jax[cpu]~=0.6.1' 'flax~=0.10.6' \
    'numpy~=2.2.6' 'opencv-python-headless~=4.11.0' 'pillow~=11.2.1'
$ export CHIP8_OCTAX=/tmp/octax CHIP8_ORACLE_PY=/tmp/octax-venv/bin/python
```

## Adding a game

Write `games/<name>.json` from the Octax module, copy the ROM into `roms/`, add
its sha1 to `manifest.json`, then run `node tools/bundle_all.mjs` and
`node tests/golden.mjs --write`.
