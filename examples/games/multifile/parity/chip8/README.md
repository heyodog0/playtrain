# `parity/chip8/` — Octax's CHIP-8 games on PlayTrain, bit-exact

One CPU, 22 games (37 bundles with levels). `src/` is a CHIP-8 interpreter whose
semantics are Octax's (Radji 2025, arXiv 2510.01764, `riiswa/octax` @ `3aa53b5`):
the JAX emulator's exact opcode behaviour, its env step (one key press, 44
instructions, its timer rule, release), its register-read rewards and
terminations, and its `jax.random` stream for `CXNN`. `games/<game>.json` holds
each game's definition transcribed from `octax/environments/<game>.py`; `roms/`
holds the ROM bytes from the pinned commit. `tools/bundle_all.mjs` produces one
ordinary PlayTrain game per definition in `dist/`, so every game is discoverable by
name (`chip8_brix`, `chip8_cavern6`, `chip8_space_flight10`, …) and runs on every
PlayTrain backend and in the browser unchanged.

```
manifest.json          family manifest: Octax pin, oracle versions, 39 ROM sha1s, per-game constants,
                       reference_quirks, not_matched
games/<game>.json      rom, action_set, startup, disable_delay, score/terminated expression trees, human keys
roms/                  the .ch8 files of the pinned commit (never edited)
src/
  10_threefry.js       CXNN's randint(0, 256, uint8) over ../../common/threefry2x32.js (JAX threefry, split)
  20_cpu.js            the CPU: Uint8Array memory/V/display, JAX's index rules made explicit, every quirk
  30_env.js            OctaxEnv: cached post-startup state, 44 instructions, timers, score/terminated (c8Eval)
  90_prelude.js        PlayTrain contract; one drawTiles call per frame; gate hooks __chip8
tools/bundle_chip8.mjs one game -> dist/chip8_<game>.js (+ sidecar with --sidecar); bundle_all.mjs [--check]
tests/
  oracle.py            the Octax driver: same ROM, seed, actions -> full state per step (JSON)
  gate_oracle.mjs      G3 lockstep gate, every step, every field (needs CHIP8_ORACLE_PY, CHIP8_OCTAX)
  export_vectors.py    G1: records every execute() call Octax's own tests make -> vectors/octax_tests.json
  export_randint.py    G2: 10k keys of split + randint -> vectors/randint_10k.json
  golden.mjs           G4: committed trajectory hashes, checked without Python
  browser_smoke.mjs    G8: headless Chromium over the built play pages
  test_*.py            pytest: G0-G8 (oracle, vectors, threefry, lockstep, goldens, freshness, engine gate,
                       runtime, browser); the oracle and browser tests skip, and only skip, when unconfigured
dist/                  GENERATED. Never edit.
```

## What parity means here

Same ROM bytes, seed and action sequence give the same `pc, I, V[0..15], stack
pointer, stack[0..15], delay, sound, keypad[0..15], display, rng key, score, reward,
terminated, truncated` as Octax after reset and after every step, including the
steps after `terminated` (Octax keeps stepping; so does the gate). Checked:

| gate | result |
|---|---|
| G1 opcode vectors | 193/193 `execute` calls from Octax's own 69 tests (11 CXNN, 15 legacy-mode) |
| G2 threefry | 10,000 keys: `split` and `randint(0, 256, uint8)` identical to jax 0.6.2 |
| G3 lockstep | 111/111 trajectories: 37 bundles x 3 seeds x 500 steps, every field every step |
| G4 goldens | 222 trajectories (6 seeds), full state, without Python |
| G6 cross-engine | 37 bundles byte-identical between the V8 + wasm reference and the QuickJS host, obs hash included |
| G8 browser | brix, tetris, blinky play in headless Chromium |

Deliberately not matched (manifest `reference.not_matched`): pixels (Octax renders
8x, PlayTrain draws the 64x32 display 1:1 into rows 16..47 of a 64x64 frame),
Octax's 4-frame observation stack (the last frame is observed, by decision; the
runtime's `frame_stack=4` gives a stack of the last four *steps'* displays, which is
Octax's intra-step stack only when the display does not change within a step), the
reset's one NOOP frame, stopping at GAMEOVER, and sound.

## Quirks that are the reference

Everything under `manifest.json` `reference_quirks` was probed against a live Octax
and is reproduced, not fixed. The ones that matter for anyone reading a CHIP-8 manual
alongside: in 16 of 22 games the timers underflow (`max(t - 1, 0)` in uint8 turns 0
into 255 every step); every `8XYN` writes VF (`8XY0`-`8XY3` set it to 0, and when
X == F the flag overwrites the result); `FX29` computes its address in uint8; `BNNN`
jumps to `(NN + VX) & 0xFFF`; the stack has no bounds check. Three ROMs' sha1s in
Octax's own metadata do not match the shipped files; the file bytes are the reference.

## Running the oracle

The reference runs in its own venv, never in the playtrain one:

```bash
git clone https://github.com/riiswa/octax /tmp/octax && git -C /tmp/octax checkout 3aa53b516152e97f2ed91eae6e33b6ee9a97596b
uv venv -p 3.12 /tmp/octax-venv
uv pip install -p /tmp/octax-venv/bin/python 'jax[cpu]~=0.6.1' 'flax~=0.10.6' 'numpy~=2.2.6' \
    'opencv-python-headless~=4.11.0' 'pillow~=11.2.1'      # octax imports cv2 and PIL at import time
export CHIP8_OCTAX=/tmp/octax CHIP8_ORACLE_PY=/tmp/octax-venv/bin/python
node tests/gate_oracle.mjs brix --steps 500 --seeds 1,2,3     # one game
node tests/gate_oracle.mjs                                    # the corpus (~100 s)
uv run --no-sync python -m pytest examples/games/multifile/parity/chip8/tests -q   # from the repo root
```

The cross-engine gate needs `native/build/qjs_host`; each game has its own action
table, so `tests/test_engine_gate.py` sets `PLAYTRAIN_QJS_ACTIONS` from the sidecar
per game (the V8 reference reads the sidecar itself). The browser test needs
`playwright-core` (resolvable from this directory, or `PLAYWRIGHT_CORE_DIR`) and a
Chromium (`PLAYWRIGHT_CHROMIUM`).

## Speed

QuickJS runs a bundle at 8.4k-13.2k steps/s per env (`benchmarks/bench_chip8.py`);
20 envs on 10 threads give 58k-116k steps/s per game. V8 runs the env alone at 110k.
The cost is interpreting 44 CHIP-8 instructions per step under QuickJS (vgdl_aliens
gets 17k on the same host; a 64px canvas changes nothing), not rendering. The
per-game table is in `PROGRESS.md`.

## Action space and controls

Per game: Octax's `action_set` keys in Octax's index order, then NOOP, so an action
index means the same thing in both. The sidecar's `actions` carry browser key codes
for the CHIP-8 keypad in the conventional layout (1 2 3 C / 4 5 6 D / 7 8 9 E /
A 0 B F on 1 2 3 4 / Q W E R / A S D F / Z X C V); `human.controls` names the
game's keys. Episodes truncate at 4500 steps (sidecar `max_steps`).

## Adding a game

Write `games/<name>.json` from the Octax module (a levelled game carries `env_id`),
copy its ROM into `roms/` and add the sha1 to `manifest.json`, then
`node tools/bundle_all.mjs`, `node tests/gate_oracle.mjs <name>`, and
`node tests/golden.mjs --write`. A `custom_startup` needs a transcription in
`src/30_env.js` `C8_CUSTOM_STARTUP`.
