# PLAN — CHIP-8 on PlayTrain, with Octax as the reference

Octax (Radji, 2025; arXiv 2510.01764) is a JAX CHIP-8 emulator plus 22 arcade
games with reward and termination read from CPU registers. This port makes the
same games ordinary PlayTrain catalog games: one JS file each, human-playable in
a browser, bit-exact against Octax at every step, on every PlayTrain backend.
"Octax on PlayTrain": same ROMs, same rewards, same episode semantics, but a
CPU-side substrate people can play, with the parity manifest the VGDL family has.

Written 2026-09-19 from the VGDL port (`../vgdl/`, `playtrain-internal/docs/DSL_PORTS_DESIGN.md`).
Its lessons are section 7; read them before section 8.

## 1. Reference pins

| what | value |
|---|---|
| repo | https://github.com/riiswa/octax |
| commit | `3aa53b516152e97f2ed91eae6e33b6ee9a97596b` (branch main, cloned 2026-09-19) |
| license | MIT (code). ROMs: mixed hobbyist / public-domain, per-ROM authorship in each `octax/environments/<game>.py` `metadata`; four ROMs (cavern, spacejam, flightrunner, target_shooter) are Octax's own modified builds with `.8o` sources in `roms/` |
| engine | `octax/emulator.py`, `octax/instructions/*.py`, `octax/state.py` |
| env | `octax/env.py` (`OctaxEnv`), game defs `octax/environments/*.py` |
| python | 3.10-3.13, JAX CPU is enough for the oracle |

## 2. Reference semantics (what "exact" means here)

From `octax/env.py` and `octax/instructions/`. The oracle in U01 confirms each line
before any JS is written; any line the oracle contradicts is corrected here first.

**Reset.** `create_state(PRNGKey(0))`: 4 KB memory zeroed, font at 0x50, ROM at
0x200, pc 0x200, I 0, V zero, 16-entry uint16 stack, display 64x32 bool, timers 0,
keypad clear, `modern_mode=True`. Then `startup_instructions` (per game, 0 to
13,800) run with no keys, using that PRNGKey(0). Then `reset(rng)` REPLACES the
rng with the caller's `PRNGKey(seed)`; the startup randomness is therefore always
the seed-0 stream and the episode randomness the caller's. Score baseline = the
game's `score_fn` after startup.

**Step.** Press key `action_set[a]` (the last action index is NOOP: no key).
Run `instructions_per_step * frame_skip` = `(700 // 60) * 4` = **44 instructions**.
Timers: if the game sets `disable_delay = True`, delay and sound timers are ZEROED
after the 44 instructions; otherwise each becomes `max(t - 1, 0)` **in uint8**, so a
timer at 0 becomes 255 (confirmed live in U01: tetris sound 0 -> 255 -> 254, delay
0 -> 255). `create_environment` defaults `disable_delay` to **False**; only brix,
pong, shooting_stars, spacejam, tank and vertical_brix set True, so 16 of 22 games
run with the underflowing timers. Release the key. Observation = the display after
instruction 11, 22, 33, 44 (a 4-frame stack of the single frame every 11
instructions). Reward = `score_fn(after) - score_fn(before)`. Terminated =
`terminated_fn`. Truncated at `time >= 4500` steps. There is no win state. Octax
keeps stepping after terminated; the oracle records that too (`--no-stop`).

**Opcodes (modern_mode).** 8XY6/8XYE shift VX itself (not VY) and put the shifted
bit in VF; **every 8XYN writes VF**: 8XY0-8XY3 and the undefined N set VF = 0, and
when X == F the flag overwrites the result (U01, `alu.py execute_alu_operation`);
BNNN jumps to `(NN + V[X]) & 0xFFF` (the "BXNN" quirk: into the low page, never
NNN + V0); FX55/FX65 leave I unchanged (`misc.py` `modern_mode` branches); DXYN wraps
the START coordinate (`% 64`, `% 32`) and CLIPS the sprite at the edges, VF =
`any(display & sprite)`; FX1E computes `I + VX` in uint16, sets VF when the sum
exceeds 0xFFF and masks I; FX29 computes `0x50 + VX * 5` **in uint8** (VX = 60 gives
I = 124, not 380); FX0A rewinds pc by 2 until any key is down, then loads the
LOWEST pressed key index; CXNN draws `jax.random.randint(subkey, 0, 256, uint8) & NN`
after `split(state.rng)`, so the random stream is JAX threefry2x32 keyed by the
episode seed, with `jax_threefry_partitionable=True` (JAX 0.6.2, the oracle venv);
00E0 clears; 00EE pops; every other 0NNN and every undefined opcode is a no-op;
arithmetic is uint8 wraparound with VF set per `alu.py`. The stack has no bounds
check: the 17th push is dropped but the pointer still increments; a pop at pointer
0 reads and zeroes `stack[15]` and leaves pointer -1. `fetch` clamps out-of-range
memory reads and pc is an unmasked uint16. Mirror all of it.

**Games.** 22 environment modules; levelled games (cavern 1,2,3,5,6 (4a/4b exist as
ROMs but `create_environment` needs a trailing digit), space_flight 1-10,
target_shooter 1-3) take the level in the ROM name. `deep` and `vertical_brix` use a
`custom_startup` function instead of a count. Reward and termination are
small register expressions (e.g. brix: score `V5`, terminated `V14 == 4`; pong:
score `V14 // 10 - V14 % 10`, terminated `V14 // 10 == 9 or V14 % 10 == 9`;
shooting_stars: a `lax.cond` on `V0 > 128`; airplane: `-V11 - V12`). They are
transcribed by hand into `games/<game>.json` (U04) and checked by the lockstep gate,
not trusted.

## 3. Architecture (mirrors `../vgdl/`)

```
parity/chip8/
  manifest.json           family manifest: Octax pin, per-game rewards/actions/ROM sha1, not_matched
  PLAN.md PROGRESS.md LOOP.md
  roms/                   the .ch8 files, copied from the pinned Octax commit, sha1 recorded in manifest.json
  games/<game>.json       per-game def transcribed from octax/environments/<game>.py: rom, action_set,
                          startup_instructions, disable_delay, score, terminated, human keymap, authorship
  src/
    10_threefry.js        JAX threefry2x32 + split + randint(uint8), extended from
                          ../craftax_classic/src/16_threefry.js (move the shared core to ../../common/ in U03)
    20_cpu.js             the CPU: Uint8Array(4096) memory, V, I, pc, stack, timers, keypad, Uint8Array(2048) display
    30_env.js             Octax step semantics: press, 44 instructions, timers, release, score/terminated
    90_prelude.js         PlayTrain contract; drawTiles(display as Uint16 kinds, 2-entry palette); gate hooks __chip8
  tools/bundle_chip8.mjs  one game -> dist/chip8_<game>.js (+ sidecar), ROM inlined as base64; bundle_all.mjs
  tests/
    oracle.py             Octax driver: same ROM, seed, actions -> per-step full state dump (JSON)
    gate_oracle.mjs       lockstep gate, every step, every field
    vectors/              opcode vectors generated from Octax's own tests/ (U02)
    golden.mjs golden.json
    test_*.py             pytest: freshness, goldens, lockstep (skips w/o oracle), cross-engine gate, runtime, browser
  dist/                   GENERATED, committed
```

One PlayTrain `draw()` = one Octax step (44 instructions, 4 frames). Observation is
the final frame; Octax's 4-frame stack is `not_matched` at the pixel level and
recoverable with the runtime's `frame_stack=4` in grayscale. `max_steps = 4500`
in the sidecar. Reward = score delta via `getGameState().score`; terminated ->
`gameState = 'GAMEOVER'`; there is no `WIN`.

**Action space.** Per game: `action_set` keys then NOOP last, exactly Octax's
index order, so a policy trained in either transfers. Sidecar `actions` carry
`held` browser key codes for the CHIP-8 keypad in the conventional layout
(1 2 3 C / 4 5 6 D / 7 8 9 E / A 0 B F -> keys 1 2 3 4 / Q W E R / A S D F / Z X C V);
`human.controls` names the game's keys in that layout.

**Render.** `drawTiles(kinds, 64, 32, palette, 1, 2, x, y, w, h)` with `kinds` the
display as Uint16 0/1 and a two-colour palette, one host call per frame.
Colours from Octax's `classic` scheme (`rendering.py`); the browser display uses
the same. Pixels are `not_matched` (Octax scales 8x; PlayTrain fits a 64x32 image
into 64x64, letterboxed).

## 4. Gates, in the order they must go green

| gate | what it proves | file |
|---|---|---|
| G0 oracle | Octax runs locally under `uv`; dumps full state per step for brix, 100 steps | `tests/oracle.py` |
| G1 opcode vectors | every instruction test in Octax's `tests/` reproduced by the JS CPU | `tests/vectors/`, `tests/test_cpu.py` |
| G2 randint | `threefryRandint8(key, n)` matches `jax.random.randint(..., 0, 256, uint8)` for 10k keys | `tests/test_threefry.py` |
| G3 lockstep | for every game, level, 3 seeds, 500 steps: identical `pc, I, V[0..15], sp, stack, delay, sound, keypad, display sha1, score, terminated` every step | `tests/gate_oracle.mjs`, `test_lockstep.py` |
| G4 goldens | committed per-run hashes of G3's runs, checked without Python | `tests/golden.mjs`, `test_golden.py` |
| G5 freshness | `dist/` is what `bundle_all.mjs` produces | `test_bundle_fresh.py` |
| G6 cross-engine | `native/gate_qjs.sh` over all bundles with the per-game action table | `test_engine_gate.py` |
| G7 runtime | discoverable by name, sidecar honoured, `NativeVecEnv` steps | `test_runtime.py` |
| G8 browser | headless Chromium plays three games (skips without playwright) | `tests/browser_smoke.mjs`, `test_browser.py` |
| G9 throughput | steps/s per game on QuickJS, 1 env and 20 env / 10 thr, recorded in PROGRESS.md | `benchmarks/` row |

The "full state every step" rule is G3's whole value. Score-only gates passed a
frozen VGDL game for a week.

## 5. Not matched (write these into `manifest.json` in U05)

- pixels: 8x scaled 64x32 vs a 64x32 image fitted into PlayTrain's 64x64 frame; frame stack of 4 vs last frame
- the reset consumes one NOOP frame before the first agent action (PlayTrain draws and steps in the same frame)
- Octax's `render()` colour schemes other than `classic`
- anything a ROM does with sound (the sound timer is emulated, nothing is played)

## 6. Speed expectation

44 instructions per step is roughly 2,000 interpreted operations, plus one
`drawTiles` call. **Measured in U07 (G9, this Mac, arm64):** V8 runs the env alone at
110k steps/s; QuickJS (`qjs_host bench`) runs the bundles at 8.4k-13.2k steps/s per
env, and `vgdl_aliens` gets 17k on the same host, so the cost is QuickJS interpreting
the 44-instruction loop, not rendering (a 64px canvas variant measured the same as the
256px one). 20 envs on 10 threads give 58k-116k steps/s per game. The original 60-120k
single-env expectation was wrong; the interpreter already has the 16-way switch and
typed-array state that section suggested. Do not build a compiler; the AOT tier, if it
is ever wanted, is a separate decision for the human (section 9).

## 7. Lessons from the VGDL port that bind here

1. **Run the reference the way its authors ran it, and check the configuration
   with an experiment, not a reading.** VGDL's gate passed at block size 1 while
   every fractional-speed sprite was frozen. Here: confirm 44 instructions per
   step, the timer rule, the key press/release timing and the seed-0 startup by
   printing them from a live Octax env in G0 before writing JS.
2. **The corpus is the reference's corpus, verified by hash.** The vgdl-metagen
   "fMRI" games were re-dialected copies. Copy ROMs from the pinned Octax commit
   and record each file's sha1 in `manifest.json`; the `metadata.roms` keys in the
   game modules are not reliable (U01 found three plain mismatches).
3. **Full-state lockstep, then JS-vs-JS goldens, then everything else.** State
   includes every register and the display. Six seeds for the JS-vs-JS check;
   the goldens' three seeds missed a frozen-missile bug the oracle caught.
4. **The reference's RNG is part of the spec.** VGDL needed a bit-exact MT19937
   and Python 2's `choice`; here it is JAX threefry and `randint`. Craftax already
   has the block function in `../craftax_classic/src/16_threefry.js`; extend, do
   not rewrite.
5. **Interpreter first, measure, then decide.** The VGDL compile pass bought 7 to
   25 percent because dispatch was not the bottleneck. A CHIP-8 step is 44
   instructions; the interpreter will be fast enough. G9 decides, not intuition.
6. **Sidecars carry the per-game action space, and every gate must be told about
   it.** `gate_qjs.sh` needs `PLAYTRAIN_ACTION_SPACE` and `PLAYTRAIN_QJS_ACTIONS`
   (JSON); `NativeVecEnv` reads the sidecar; the browser page reads it for the
   keymap. Forgetting one produced a day of false divergences.
7. **Name every function the emitter or a table might reference.** Anonymous
   arrows have no `.name`; that produced a silent no-op once.
8. **Keep the reference's quirks and document them in `manifest.json`
   `not_matched` or `reference_quirks`.** Do not fix Octax; if a ROM behaves
   oddly under Octax, that is the behaviour to match, with a note.
9. **`uv run --no-sync` in the playtrain repo; a separate `uv venv` for the
   oracle.** A bare `uv run` once rewrote the lockfile.
10. **Never edit `dist/`; never weaken a gate; one task per iteration; commit
    only green gates.**

## 8. Units

Branch: `chip8`, created from `vgdl` after U00. The VGDL branch holds the
`drawTiles` primitive and the rebuilt hosts this port needs; both are uncommitted
at the time of writing.

| unit | task | done when |
|---|---|---|
| U00 | Commit the `vgdl` branch: everything under `examples/games/multifile/parity/vgdl/`, `crates/rasterizer/src/tiles.rs` + `lib.rs` + `three.rs`, `native/runtime/p5.*`, the four host `.cpp`, `aot_intr_list.h`, `runtime/action_spaces.json`, `runtime/p5/{p5-shim,raster-wasm}.mjs`, `runtime/p5/rasterizer.wasm`. NOT the pre-existing `reproduction/*` and `REPRODUCING.md` edits, which belong to another branch. Then `git checkout -b chip8`. | `git status` clean except `reproduction/*`, `REPRODUCING.md`, `native/aotfork/out/`, `examples/games/js/analogen_*`; `uv run --no-sync pytest examples/games/multifile/parity/vgdl/tests -q` green |
| U01 | Scaffold + oracle: directory tree from section 3, `manifest.json` with the pinned commit, `roms/` copied and sha1-verified against the pinned commit's files (the `metadata.roms` hashes are wrong for flight_runner, spacejam, worm and every levelled game, so the file bytes are the reference), `uv venv` for the oracle with `jax[cpu]` and the Octax checkout on `sys.path`, `tests/oracle.py` dumping per-step full state and the reset/step constants it observes (instructions per step, timer rule, key timing, startup rng) | G0: `oracle.py roms/Brix*.ch8 --game brix --seed 1 --actions 1,0,1,2 --json` prints 5 states; section 2 corrected if anything differs |
| U02 | CPU core `src/20_cpu.js` + opcode vectors generated from Octax's `tests/test_*.py` via a small Python exporter into `tests/vectors/*.json` | G1 green: every vector's post-state matches |
| U03 | `src/10_threefry.js`: split + `randint` uint8 over the shared threefry core (move the block function to `../../common/threefry2x32.js`, keep craftax's tests green) | G2 green; `uv run --no-sync pytest examples/games/multifile/parity/craftax_classic/tests/test_rng.py -q` still green |
| U04 | `src/30_env.js` + `games/*.json` for brix, pong, tetris; lockstep gate script | G3 green on those three games, 3 seeds, 500 steps |
| U05 | Prelude, `drawTiles` render, bundler + sidecars (per-game action space, keypad codes, human controls), `bundle_all.mjs --check`, goldens, `manifest.json` `not_matched` | G4, G5 green; `list_available_games()` shows `chip8_brix` |
| U06 | All 22 games and their levels: transcribe the remaining `games/*.json`; run G3 over everything | G3 green for every game/level; any Octax quirk found is in `manifest.json` |
| U07 | Cross-engine gate + runtime tests + benchmark row (`benchmarks/`, following the VGDL row) | G6, G7, G9 green; numbers in PROGRESS.md |
| U08 | Browser: build-pages smoke via playwright, keymap overlay from sidecar | G8 green; screenshot inspected and described in PROGRESS.md |
| U09 | Report: `README.md` for the family (what parity means, how to run the oracle, the numbers), status log in `playtrain-internal/docs/DSL_PORTS_DESIGN.md`, memory note | files written; all gates green in one `uv run --no-sync pytest examples/games/multifile/parity/chip8/tests -q` |
| U10 | handoff: play three games in a real browser and confirm they feel like the Octax GIFs; decide whether the 4-frame stack should be the default observation | notes for the human in PROGRESS.md |
| U11 | Observation default (Q1, human: last frame): `manifest.json` `obs` gains `octax_frame_stack: 4` with a note; README and `not_matched` say how to recover the stack; rebundle (sidecars embed `obs`) | G4, G5 green; `dist/chip8_brix.json` `obs.octax_frame_stack == 4` |
| U12 | cavern4a/4b (Q2, human: ship): `tests/oracle.py --module cavern` builds OctaxEnv from the module with the given ROM (bypassing create_environment's env_id regex); `games/cavern4a.json`, `games/cavern4b.json` with `oracle_module: "cavern"`; `gate_oracle.mjs` passes it; goldens rewritten; test counts 39 | G3 exact for both x 3 seeds x 500 steps; full suite green with 39 bundles |
| U13 | ROM notice (Q3, human: keep + NOTICE): `roms/NOTICE.md` generated by `tools/rom_notice.py` from manifest.json (file, sha1, bytes, title, authors, release, Octax module, modified-by-Octax flag, metadata-sha1 mismatch flag); `tests/test_rom_notice.py` checks every ROM in roms/ is listed with its current sha1 | test green |
| U14 | AOT tier measurement (Q5, human: measure only): build the AOT host for chip8_brix, chip8_tetris, chip8_blinky with the existing `native/aotfork` toolchain, run the cross-engine trace against the V8 reference, record steps/s next to the QuickJS numbers in PROGRESS.md. Change nothing in the runtime, hosts or engine; if the toolchain does not build here, record the first error and mark blocked | numbers (or the blocked reason) in PROGRESS.md Numbers; G6-style byte-identical trace for the three or a recorded divergence |

## 9. Open questions for the human (do not block on them)

1. Observation: last frame (PlayTrain default) or Octax's 4-frame stack via `frame_stack=4`? Affects any "same as Octax" training claim.
2. Which of the 48 ROMs to ship: Octax's 22 game modules plus their levels, or every `.ch8` in `roms/`?
3. ROM redistribution: Octax ships them under MIT for its modified ones and lists authorship for the rest; confirm that is acceptable for the PlayTrain repo.
4. cavern4a.ch8 and cavern4b.ch8 ship in Octax's `roms/` but `create_environment("cavern4a")` cannot load them (the env_id must end in digits), so U06 ships cavern 1, 2, 3, 5, 6 only. Add them as `cavern4a`/`cavern4b` defs (the oracle would need a `--rom-only` path that bypasses create_environment) or leave them out?
5. Throughput: 8-13k steps/s per QuickJS env (G9). Is that enough for the intended training runs, or should the AOT tier be tried on these bundles? Nothing in this port depends on the answer.

**Answered by the human, 2026-09-19 (after U09):** (1) last frame stays the default;
document that `frame_stack=4` grayscale recovers Octax's stack. (2) ship cavern4a and
cavern4b via an oracle path that builds OctaxEnv from the cavern module directly.
(3) keep the ROMs, add `roms/NOTICE.md` with per-ROM author, year, sha1 and Octax
provenance. (5) measure the AOT tier on three bundles, change nothing either way. These
became U11-U14 in section 8; (4) cavern4a/4b is (2).

**Q5 measured (U14, 2026-09-19):** the existing AOT harness (`native/aotfork`, `qjsc -A`)
runs chip8 bundles at 28.6k-34.6k steps/s per env, 2.5-2.7x the adopted QuickJS host and
1.6x the fork interpreter, byte-identical to the V8 reference on 18/18 traces. Whether to
adopt it for training is still the human's call (the fork host is a separate lineage from
`qjs_host`); numbers in PROGRESS.md Numbers.
