# Craftax-Classic in PlayTrain: a parity port

Status: plan, nothing built. Branch: `release`. Written 2026-09-14.

This document is the full plan for a multi-file JavaScript Craftax-Classic that
steps bit-for-bit like PufferLib's C implementation, ships as one PlayTrain
catalog file, trains on pixels, and is playable by a human in the browser from
the same file. It also lays the ground for full Craftax without redoing the
scaffolding.

Read `AGENTS.md` and `GAME_TEMPLATE.md` first. Everything here obeys them.

---

## 0. Decisions already made (in conversation, 2026-09-14)

| Decision | Choice | Why |
|---|---|---|
| Reference implementation | PufferLib 5.0 `ocean/craftax_classic/craftax_classic.h`, commit `6ffa5b10dbbbe4d1e8288367c7d9d3acd3bad4a2` (2026-09-13), MIT | Imperative, single-env, integer state, 1222 lines. The JAX original is `vmap`ped and uses threefry splitting; porting from it exactly is far harder. |
| Parity target | The C, not the JAX original | PufferLib's Classic port is itself **not** JAX-exact (own PCG RNG, derived from `Infatoshi/craftax.c`). Only the full-Craftax `craftax_parity.h` is JAX-exact. We match the C; the paper says so. |
| Fidelity of dynamics | Bit-exact state trace vs the C, every step | This is what earns the `parity/` directory. |
| Fidelity of pixels | None claimed | PufferLib's textures are a raylib viewer only; training there is symbolic. We render in house style. Craftax-Classic-Pixels (JAX) is a *different observation*, and our comparison row says so. |
| Directory | `examples/games/multifile/parity/craftax_classic/` | Outer level = how it is built (bundle step). Inner level = what it claims (`parity/` earned by a test, `custom/` otherwise). |
| Shipped artifact | One flat `dist/craftax_classic.js` plus `dist/craftax_classic.json` sidecar, committed | Play tab, gates, AOT cache, `uvx playtrain games` all glob flat files and learn nothing new. |
| Actions | 17, declared by the game via sidecar | Not authored against default8. This is the first game that declares its own space. |
| Observation | Pixels 64x64x3 first; symbolic 1345-vector as a later obs mode | Pixels carry every claim we want. Symbolic mode re-couples content to network shape and puts us in PufferLib's own lane. |
| Full Craftax | Designed for, not built | Shared modules are split so `parity/craftax/` reuses them. |

**Correction (task 1a, 2026-09-14).** The plan as written gave the upstream path
as `pufferlib/ocean/craftax_classic/craftax_classic.h`. At the pinned commit the
repository has no `pufferlib/` prefix: the real paths are
`ocean/craftax_classic/craftax_classic.h`, `ocean/craftax/{craftax,constants,craftax_net}.h`
and `src/pufferenv.h`. The reference wins; the path is corrected here and in the
`manifest.json` sketch in 2.3. Everything else the plan asserts about the header
was checked against the vendored copy and holds (1222 lines; PCG at 135-141;
`c_init` at 938-948; `puf_step` at 957-1009, in the step order given in 1.3).

---

## 1. What the C does (the spec we port)

Everything below is read from `craftax_classic.h` at the pinned commit. Line
numbers refer to that file.

### 1.1 State (struct `Env`, lines 163-230)

| Field | Type | Notes |
|---|---|---|
| `pcg` | `uint64_t` | The only RNG state. Seeded once in `c_init` from `env->rng` (a `uint32`). |
| `map_packed[64*64]` | `uint8_t` | One block id per byte. 17 block ids, 0..16. |
| `mob_bits`, `zombie_bits`, `cow_bits`, `skel_bits`, `arrow_bits` | `uint64_t[64]` | Per-row occupancy bitmaps. Redundant with the mob arrays but **read by game logic** (`has_mob_at`, `can_move_mob`), so they are state, not cache. |
| `player_r`, `player_c` | `int16_t` | |
| `player_dir` | `int8_t` | 1..4 = left, right, up, down (index into `DIR_DR/DIR_DC`). |
| `health`, `food`, `drink`, `energy` | `int8_t` | **Signed 8-bit, no clamp on health.** Zombie hit while asleep is `-7`. |
| `is_sleeping` | `bool` | |
| `recover`, `hunger`, `thirst`, `fatigue` | `float` | Accumulators stepped by `±0.5f`, `±1.0f`, `±2.0f`. Dyadic, so exact in float32 and float64 alike. |
| `inv[12]` | `int8_t` | wood, stone, coal, iron, diamond, sapling, wpick, spick, ipick, wsword, ssword, isword. Clamped to 0..9 **after** all sub-steps (line 979). |
| zombies ×3, cows ×3, skeletons ×2, arrows ×3, plants ×10 | parallel `int16/int8/bool` arrays | Fixed slots. Slot order matters: `do_action` attacks the first matching slot, spawns fill the first free slot. |
| `light_level` | `float` | Recomputed every step from `timestep` (see 1.4). |
| `achievements[22]` | `bool` | |
| `timestep` | `int32_t` | Episode ends at 10000. |

The observation buffer, log struct, and reward scratch are **not** state.

### 1.2 RNG (lines 135-141)

PCG-XSH-RR with a 64-bit LCG:

```
s = s * 6364136223846793005 + 1442695040888963407          (mod 2^64)
x = (uint32)(((s >> 18) ^ s) >> 27);  rot = s >> 59
out = rotr32(x, rot)
rf(s) = (out >> 8) * (1/16777216)                            exact in float32 and float64
ri(s, n) = out % n
```

Seeding (`c_init`, lines 938-948): `pcg = seed * 0x9E3779B97F4A7C15 + 0x87C37B91114253D5`,
then 8 warm-up draws. **The stream is not reset between episodes** in PufferLib
(auto-reset continues the stream). See 3.4 for how we reconcile that with
`resetGame(seed)`.

### 1.3 Step order (`puf_step`, lines 957-1009)

```
clamp action to 0..16
snapshot old_health, old_achievements
eff = is_sleeping ? NOOP : action
do_crafting(eff)                                  needs table (and furnace for iron)
if eff == DO:            do_action()              attack first mob in facing cell, else interact with block
if eff in PLACE_*:       place_block(eff)
move_player(eff)                                  sets player_dir even when blocked
update_mobs()                                     zombies, cows, skeletons, arrows, in that order
spawn_mobs()                                      cow (p=.1), zombie (p=.02+.1*(1-light)^2), skeleton (p=.05)
update_plants()                                   ripe at age 600
update_intrinsics(action)                         NOTE: raw action, not eff
clamp inv to 0..9
timestep++
light_level = 1 - |cos(pi * (fmod(t/300, 1) + 0.3))|^3
reward = (#new achievements) + 0.1 * (health - old_health)
done = timestep >= 10000 || health <= 0 || standing on lava
```

Every `cr_rf`/`cr_ri` call site must be reproduced in the same order. There are
about 20. The port keeps the C function boundaries so this is auditable by
diffing side by side.

### 1.4 Floating point, exhaustively

Integer logic dominates. The float paths are:

| Where | C expression | JS equivalent | Risk |
|---|---|---|---|
| Worldgen gradient angles (line 312) | `cr_rf()*2.0f*3.14159265f`, then `cosf`, `sinf` | `fround(fround(rf*2)*PI_F)`, then **see below** | `cosf/sinf` are libm-dependent |
| Perlin (lines 397-430, scalar path) | ~20 float32 mul/add per cell | `fround` after every op | FMA contraction. PufferLib's AVX-512 path (lines 324-395) **uses FMA** and so already differs from their own scalar path in the last bit. We pin the scalar, no-FMA path. |
| Worldgen thresholds (lines 434-461) | `sqrtf`, float compares | `fround(Math.sqrt(x))` | Double-then-round is provably exact for sqrt, +, -, *, /. |
| Intrinsics | `±0.5f/1.0f/2.0f` accumulators | plain doubles are exact here; still `fround` for uniformity | none |
| Light (line 982-984) | `fmodf`, `cosf`, `fabsf`, `cv*cv*cv` | `fround` chain, **`cosf` again** | libm |
| Zombie spawn chance (line 813) | `0.02f + 0.1f*(1-l)*(1-l)` | `fround` chain | none beyond `light_level` |
| Reward | `ach + 0.1f*dhp`, accumulated in float32 | keep `score` as a `fround`ed running sum | host reads a double, see 3.5 |

**The one real hazard is `cosf`/`sinf`.** PlayTrain already solved the analogous
problem for `Math.*`: every engine links the same V8 `ieee754` implementation
(`native/qjs/v8libm/ieee754.cc`, reached through `js::cos` in
`native/runtime/jsmath.h`; **not** `native/frozenmath`, which is openlibm and
measurably 1 ULP off V8 — see the task 2a correction in 4.2). So:

- The reference C driver (section 4) is compiled with `-ffp-contract=off`,
  without AVX-512, and with `cosf(x)`/`sinf(x)` redirected to
  `(float)cc_ieee754_cos((double)x)` from `native/qjs/v8libm/ieee754.cc`.
- The JS uses `Math.fround(Math.cos(x))`, which in every PlayTrain engine is the
  same V8 function.

This makes the parity target "PufferLib Craftax-Classic with transcendental
functions bound to V8 ieee754", which the plan states openly. Integer logic and
RNG are untouched. Fallback if the redirect proves awkward: a table of the 400
gradient angles per seed cannot be tabulated, so there is no fallback for
worldgen; for `light_level` alone a 10000-entry float32 table would work (it is
**not** periodic in float32 because `(float)t/300` rounds differently per `t`).
Prefer the redirect.

### 1.5 Observation (`compute_observations`, lines 878-917) and action mask

1345 float32: 63 tiles × (17 block one-hot + 4 mob flags) = 1323, then 12 inventory /10, 4 intrinsics /10, 4 direction one-hot, light, sleeping. No action mask in Classic. This is what the later symbolic obs mode emits; pixels do not need it.

---

## 2. Directory layout

```
examples/games/multifile/
  README.md                        the contract for this tree (section 2.2)
  common/                          shared across multifile games, bundled by reference
    f32.js                         F = Math.fround alias, float32 helpers, PI_F
    rng_pcg32.js                   PCG-XSH-RR 64-bit state as two uint32 words; rf, ri, seed
    rng_rand_r.js                  glibc rand_r LCG (full Craftax uses it), for later
    u64bits.js                     64-entry uint64 bitmaps as Uint32Array pairs: set/clear/get
    parity.js                      canonical state serializer -> Uint8Array, FNV-1a 64
    tilegrid.js                    p5 helpers: draw an N×M tile grid aligned to obs pixels
  parity/
    craftax_classic/
      PLAN.md                      this file
      README.md                    provenance, what is exact, what is not, how to run gates
      manifest.json                see 2.3
      src/
        00_header.js               game banner comment, conforms-to line, version
        10_constants.js            BLK_*, ACT_*, ACH_*, sizes, DIR tables (mirror constants in C)
        20_state.js                one ArrayBuffer, typed-array views mirroring the C struct
        30_worldgen.js             generate_world, perlin (scalar), ore/tree pass, diamond guarantee
        40_player.js               do_crafting, do_action, place_block, move_player, get_damage
        50_mobs.js                 update_mobs, try_spawn, spawn_mobs, can_move_mob
        60_world_tick.js           update_plants, update_intrinsics, light_level
        70_step.js                 step(action): the exact puf_step order, reward, done
        80_render.js               setup(), draw(): tiles, mobs, inventory strip, status bars
        85_obs_symbolic.js         getObservation(): 1345 floats (unused until obs mode lands)
        90_playtrain.js            resetGame(seed), getGameState(), input -> action, getParityState()
      reference/
        build.sh                   compiles the C driver against games/craftax_src (section 4)
        cc_ref_driver.c            steps the C with a seed + action file, dumps canonical state
        stubs/raylib.h             typedefs only; the header includes raylib.h unconditionally
        stubs/ini.h                same
      traces/
        corpus.json                seeds + policy ids that make up the parity corpus
        golden/*.fnv               per-step FNV-1a 64 chain per corpus episode (small, committed)
      tests/
        test_rng.py                G0
        test_worldgen.py           G1
        test_lockstep.py           G2 (needs the C driver; skipped when absent)
        test_golden.py             G2 against committed hashes (no C needed; runs in CI)
        test_coverage.py           G3
        test_bundle_fresh.py       committed dist == fresh bundle
      dist/
        craftax_classic.js         bundled, committed
        craftax_classic.json       sidecar, committed (copied from manifest at bundle time)
    craftax/                       later; same shape, shares common/
  custom/                          large games with no parity claim; empty for now
games/craftax_src/                 vendored reference C, pinned commit, LICENSE, README
  craftax_classic.h  craftax.h  constants.h  craftax_net.h  pufferenv.h  LICENSE  README.md
                     upstream paths: ocean/craftax_classic/, ocean/craftax/, src/, / (LICENSE)
tools/bundle_multifile.py          the bundler (section 2.4)
```

### 2.1 Why one ArrayBuffer for state

`20_state.js` lays the whole game state out in one `ArrayBuffer` with typed-array
views (`Int8Array` for `health`, `Uint8Array` for the map, `Int16Array` for
positions, `Uint32Array` pairs for the bitmaps and the PCG word pair, `Float32Array`
for the accumulators). Three wins:

- **Wrap semantics for free.** `health -= 7` on an `Int8Array` wraps like C `int8_t`.
  No hand-written masking.
- **Parity dump is the buffer.** `getParityState()` returns the buffer bytes. The C
  driver writes the same layout. Comparison is `memcmp`.
- **Reset is `fill(0)`** plus the few fields `generate_world` sets.

The layout is documented as a table in `20_state.js` and mirrored in
`cc_ref_driver.c`. A unit test checks both sides agree on total length and field
offsets.

### 2.2 The contract of `multifile/` (goes in its README)

- A game lives here if and only if it needs a bundle step.
- `parity/<name>/` requires: `manifest.json` with a `reference` block, a lockstep
  test against that reference, and committed golden hashes. CI runs the golden
  test. If the test is removed or fails on `release`, the game moves to `custom/`.
- `custom/<name>/` requires only a manifest and the ordinary catalog validation.
- `dist/` holds exactly one `.js` and one `.json`, both committed, both produced by
  `tools/bundle_multifile.py`. A test fails if they are stale.
- Tooling reads `manifest.json` and the sidecar, never directory names.

### 2.3 `manifest.json`

```json
{
  "name": "craftax_classic",
  "version": "0.1.0",
  "title": "Craftax-Classic",
  "sources": [
    "../../common/f32.js", "../../common/rng_pcg32.js", "../../common/u64bits.js",
    "../../common/parity.js", "../../common/tilegrid.js",
    "src/00_header.js", "src/10_constants.js", "..." , "src/90_playtrain.js"
  ],
  "action_space": "craftax17",
  "actions": [
    {"name": "NOOP",             "held": [],   "press": null},
    {"name": "LEFT",             "held": [37], "press": null},
    {"name": "RIGHT",            "held": [39], "press": null},
    {"name": "UP",               "held": [38], "press": null},
    {"name": "DOWN",             "held": [40], "press": null},
    {"name": "DO",               "held": [],   "press": 32},
    {"name": "SLEEP",            "held": [],   "press": 9},
    {"name": "PLACE_STONE",      "held": [],   "press": 49},
    {"name": "PLACE_TABLE",      "held": [],   "press": 50},
    {"name": "PLACE_FURNACE",    "held": [],   "press": 51},
    {"name": "PLACE_PLANT",      "held": [],   "press": 52},
    {"name": "MAKE_WOOD_PICK",   "held": [],   "press": 53},
    {"name": "MAKE_STONE_PICK",  "held": [],   "press": 54},
    {"name": "MAKE_IRON_PICK",   "held": [],   "press": 55},
    {"name": "MAKE_WOOD_SWORD",  "held": [],   "press": 56},
    {"name": "MAKE_STONE_SWORD", "held": [],   "press": 57},
    {"name": "MAKE_IRON_SWORD",  "held": [],   "press": 48}
  ],
  "obs": {"rgb": true, "symbolic": 1345},
  "max_steps": 10000,
  "human": {
    "steps_per_second": 8,
    "controls": "Arrows move and face. SPACE interacts. TAB sleeps. 1-4 place stone/table/furnace/sapling. 5-7 craft pickaxes, 8-9-0 craft swords (stand next to a table; iron needs a furnace too).",
    "keymap_overlay": true
  },
  "reference": {
    "name": "PufferLib craftax_classic",
    "repo": "https://github.com/PufferAI/PufferLib",
    "commit": "6ffa5b10dbbbe4d1e8288367c7d9d3acd3bad4a2",
    "file": "ocean/craftax_classic/craftax_classic.h",
    "license": "MIT",
    "parity": "full-state trace, every step, scalar no-FMA build, libm bound to V8 ieee754",
    "not_matched": ["pixels", "auto-reset RNG continuation across episodes"]
  }
}
```

The action indices 0..16 are exactly the C's `ACT_*` values, so an action file is
valid for both sides with no mapping. The key codes mirror the JAX `play_craftax_classic`
layout where it has one, so someone who has played the original is not relearning.

### 2.4 The bundler

`tools/bundle_multifile.py <manifest>`: concatenates `sources` in order with a
`// ---- <path> ----` separator line, prepends a generated banner (name, version,
source hash, "GENERATED, edit src/"), writes `dist/<name>.js`, and copies the
manifest minus `sources` to `dist/<name>.json`. Plain concatenation, no ES modules,
no minifier. QuickJS, the AOT tier (`qjsc`), node, and the browser embed all see
one global script, as today.

`just bundle <name>` and `just bundle-all` wrap it.

---

## 3. Runtime integration

Small, and every change is optional for existing games.

### 3.1 Second games root

`_paths.games_dir()` stays the catalog. Add `_paths.multifile_dist_dirs()` returning
every `examples/games/multifile/*/*/dist/`. `_resolve_games_dir` becomes a search
list: explicit arg, `$PLAYTRAIN_GAMES_DIR`, catalog, multifile dists.
`list_available_games()` merges. `reference_trace.mjs` and `qjs_host` take a path,
so they need nothing.

### 3.2 Sidecar manifest

When `GameEnv`, `NativeVecEnv`, and the node `GameEnv` resolve `<game>.js`, they
look for `<game>.json` beside it. If present and the caller passed no
`action_space`, the sidecar's `actions` array is used; `max_steps` likewise
defaults from it. Catalog games have no sidecar and behave exactly as now. This
is the only behavioural change to the env classes.

### 3.3 Action delivery inside the game

The runtime already delivers `press` keys as one-frame `keyPressed()` events and
`held` keys via `keyIsDown()`. `90_playtrain.js` turns the frame's input into one
action index: a pressed key maps to its action; otherwise a held arrow maps to a
move; otherwise NOOP. Exactly one action per frame, matching one `puf_step`.
Because moves are `held`, a human can hold an arrow to walk; because everything
else is `press`, crafting cannot fire twice from one keystroke.

### 3.4 Seeds and episodes

PlayTrain calls `resetGame(seed)` with a fresh `uint32` per episode. The port seeds
the PCG in `resetGame` exactly as `c_init` does, then runs `generate_world`. So
"episode with seed s" means the same world on both sides **when the C is
initialised with `env->rng = s` and stepped once from fresh**. PufferLib's
auto-reset continuation is not reproduced, and is listed under `not_matched`.
The C driver re-inits per episode to match.

### 3.5 Score, reward, terminal

`getGameState()` returns `{score, lives, gameState}`. `score` is the `fround`ed
running sum of the C's per-step reward, so `score` equals PufferLib's
`episode_return_accum` bit-for-bit at every step. The host computes reward as a
double difference of two float32 values, so the **host** reward can differ from
the C reward in the last bits; the parity test compares the game's own per-step
reward (carried in the parity dump) exactly, and the host reward to 1e-6.
`lives` is 1 while alive, 0 on death. `gameState` is `GAMEOVER` on death or lava,
`WIN` never (Classic has no win), and the timestep cap is the sidecar's
`max_steps: 10000`, enforced by the runtime as truncation.

### 3.6 Symbolic observation mode (later, not blocking)

Add `obs_mode="symbolic"` to the Python envs and the three hosts: the game exposes
`getObservation()` returning a `Float32Array` of `manifest.obs.symbolic` length;
the host reads the typed array buffer and copies it into the obs slot, skipping
the rasterizer. Gate extension: hash the buffer alongside the frame. A `both`
mode returning a dict makes pixel-vs-symbolic on identical dynamics a one-flag
experiment. Estimated two to three days, done after G2 passes.

---

## 4. The reference harness (running PufferLib's C)

This is built first, before any JS, because it is also the spec extractor.

### 4.1 Vendoring

Copy into `games/craftax_src/` at the pinned commit: `craftax_classic.h`,
`craftax.h`, `constants.h`, `craftax_net.h`, `src/pufferenv.h`, PufferLib's
`LICENSE`, and a `README.md` stating commit, date, upstream paths, that Classic
derives from `Infatoshi/craftax.c`, and that the files are unmodified. Add a row
to `THIRD_PARTY_LICENSES.md` next to the ProcGen one. The AVX-512 worldgen block
is compiled out by not defining `__AVX512F__`, not by editing the file.

### 4.2 The driver

`reference/cc_ref_driver.c` includes `craftax_classic.h` unmodified and provides
what `pufferenv.h` expects: `Dict`/`dict_set` no-op stubs, `stubs/raylib.h` with
the handful of typedefs (`Texture2D`, `Rectangle`, `Vector2`, `Color`) and no-op
functions the render path references, and an `Agent` with malloc'd
`observations[1345]`, `actions[1]`, `rewards[1]`, `terminals[1]`.

**Correction and addition (task 2a, 2026-09-14).**

1. *The `Dict` stub is `stubs/ini.h`, not part of the driver.* `craftax_classic.h`
   includes only `raylib.h` and `pufferenv.h`; it is `pufferenv.h` that includes
   `ini.h`, for the `Dict` its `puf_init`/`puf_log` take. So `stubs/` holds two
   files, as the section 2 layout already said.
2. *The libm redirect binds to `native/qjs/v8libm/ieee754.cc`, not to
   `native/frozenmath`.* The plan named the wrong directory. `native/frozenmath`
   is openlibm, and `native/runtime/jsmath.h` records that openlibm's sin/cos do
   **not** match V8's: 18 sin and 23 cos disagreements in 2001 samples, 1 ULP
   each, enough to fail `native/gate_qjs.sh`. `Math.cos` in every PlayTrain
   engine resolves to `js::cos` -> `v8::base::ieee754::cos`, from
   `native/qjs/v8libm/ieee754.cc`. The driver links that object, compiled with
   node's own per-architecture FMA setting (contraction on for arm64, off for
   x86-64), exactly as `native/build_qjs.sh` does. The intent in 1.4 — "the same
   V8 function the engines link" — is unchanged; only the path was wrong.
3. *The driver must transcribe `puf_step`, and cross-check the transcription.*
   `puf_step` auto-resets on the terminal step: it calls `add_log` then
   `puf_reset`, and `generate_world` destroys precisely the state the gate needs
   to compare for that step. The reference is not editable, and the reset cannot
   be interposed — renaming `puf_reset` with `-D` renames its definition and its
   call site to the same token, so there is no seam. The driver therefore carries
   `cc_step_no_reset`, a line-for-line transcription of lines 957-1009 whose only
   change is that the terminal branch records `done` instead of resetting.
   Because a transcription that drifted would silently corrupt every later gate,
   `run` mode steps a **shadow env with the real `puf_step`** alongside and
   asserts identical canonical state, reward bits and `done` after every
   non-terminal step, exiting non-zero on the first disagreement. On the terminal
   step the shadow has already reset, so only reward bits and `done` are
   cross-checked there. The transcription is thus validated against the real
   function on every step it is used for, bar the one step the real function
   cannot answer.
4. *`world` mode emits the whole canonical record* (`CC_STATE_BYTES`), not a
   map-plus-block subset. Its leading fields are the 4096 map bytes and the
   player/intrinsics block the plan asked for, and emitting the full record keeps
   one serializer on each side instead of two.

Modes:

```
cc_ref rng    <seed> <n>                       -> n lines: pcg out, rf bits, ri(64)
cc_ref world  <seed>                           -> 4096 bytes map + player/intrinsics block
cc_ref run    <seed> <actions.bin> [--dump-every K]
                                               -> per step: 8-byte FNV-1a 64 of canonical state,
                                                  reward bits (u32), done (u8);
                                                  every K steps and at done: full canonical state
cc_ref layout                                  -> prints the canonical layout table (offsets, sizes)
```

Canonical state = the `Env` fields listed in 1.1, in declaration order, with the
per-step reward appended, written with fixed widths and no padding. `parity.js`
produces the identical bytes from the JS `ArrayBuffer`.

Build (`reference/build.sh`):

```
clang -O2 -std=c11 -ffp-contract=off -fno-fast-math $ARCH_FLAGS \
  -Dcosf=pt_cosf -Dsinf=pt_sinf \
  -I games/craftax_src -I reference/stubs \
  -c reference/cc_ref_driver.c -o build/cc_ref_driver.o
clang++ -O2 -o build/cc_ref build/cc_ref_driver.o build/v8_shim.o build/v8_ieee754.o -lm

# ARCH_FLAGS is -march=x86-64-v2 on x86 (no FMA at all) and empty on arm64,
# where -ffp-contract=off is the only guard. build/v8_ieee754.o is
# native/qjs/v8libm/ieee754.cc built with node's per-arch FMA setting
# (contraction on for arm64, off for x86-64); build/v8_shim.o gives its
# C++-linkage cos/sin a C entry point. See correction 2 above.
```

`pt_cosf(x)` is `(float)ieee754_cos((double)x)` defined in the driver. Verify the
redirect with `nm`: no `cosf`/`sinf` symbols may remain. `x86-64-v2` has no FMA, so
the compiler cannot contract even if the flag were lost; both are belt and braces.
On the Mac the same flags work with Apple clang; on FASRC use the pinned clang
from the AOT toolchain. Run the driver on both and diff: the C must agree with
itself across machines before it is allowed to judge the JS.

### 4.3 The corpus

Random actions never craft an iron sword. The corpus mixes policies so every
branch runs:

| Policy | Purpose | Episodes |
|---|---|---|
| uniform random | mob movement, spawning, intrinsics, death by zombie, night | 100 seeds × full episode |
| sticky random (repeat last action p=.7) | walking far: despawn at distance 14, out-of-bounds | 50 |
| scripted forager | wood → table → picks → stone → furnace → coal/iron → iron tools → diamond; drinks and eats; sleeps at night | 30 seeds, scripted in Python against the C driver's dumps, actions recorded to `.bin` |
| adversarial | stands on sand by water, places stone on water, plants and waits 600 steps, gets shot by skeletons on paths | 20 |
| lava walk | ends on lava for the terminal branch | 10 |

Action files are committed (`traces/corpus/*.bin`, a byte per step, small). Golden
hash chains are committed. Full dumps are not; they regenerate from the driver.

---

## 5. Gates

Each gate is a pytest, ordered so a failure points at one module.

| Gate | Checks | Needs C | In CI |
|---|---|---|---|
| **G0 rng** | 10^6 PCG outputs, `rf` bit patterns, `ri` for n in {4, 8, 64}, seeding + warm-up for 1000 seeds | yes | golden copy |
| **G1 worldgen** | map bytes + initial state for 1000 seeds | yes | golden copy |
| **G2 lockstep** | canonical state equal every step for every corpus episode; per-step reward bits equal; done flag equal; host reward within 1e-6 | yes | golden chains |
| **G3 coverage** | every `ACH_*` fires at least once in the corpus; every action index appears; C line coverage of `craftax_classic.h` game functions is 100% under `--coverage`; JS branch coverage of `src/` via node `c8` is 100% excluding render | yes | yes |
| **G4 engines** | `native/gate_qjs.sh craftax_classic` with `PLAYTRAIN_ACTION_SPACE`/`PLAYTRAIN_QJS_ACTIONS` set to the sidecar's actions; `gate_async.py`; V8 vs QuickJS vs AOT tier; browser via `reference_trace.mjs` | no | yes |
| **G5 catalog** | `tools/validate.py --game craftax_classic` passes all five checks with the 17-action space; bundle-fresh test; sidecar schema test | no | yes |
| **G6 human** | one `study/quickplay.mjs craftax_classic` session replays through the training env to the same score | no | manual, recorded in README |

G2 is the parity claim. G4 is PlayTrain's existing invariant, and it is what lets
the human session and the training run be the same environment.

---

## 6. Rendering (house style, obs-aligned)

Canvas 512×512. Obs is 64×64, so each obs pixel is an 8×8 canvas block. Tiles are
56×56 canvas px (7 obs px), 9 columns × 7 rows for the view = 504×392, then two
rows of 56 for inventory and status = 504×504, with an 8 px margin on the right
and bottom. Every tile edge lands on an obs pixel boundary, so a block is a crisp
7×7 in the observation. This is Crafter's own 9×9-units-of-7 layout.

- Blocks: flat fill per block id, plus at most one primitive glyph (a darker
  square for ore, a triangle for tree, wavy `rect`s for water). No images, no
  `text()`; digits in the inventory strip are drawn from a 3×5 segment table so
  the rasterizer path stays the one every catalog game already gates on.
- Mobs: zombie green square with eyes, cow brown, skeleton grey, arrow a short
  line in its direction. Player: a square with a facing mark, dimmed while asleep.
- Night: multiply tile colours by `light_level`. The obs then carries time of day,
  as the original pixel env does.
- The render reads state only; it never mutates and never draws from RNG.

Render cost is well under any ProcGen catalog game. Expect per-core env throughput
in the catalog's range; measure with `benchmarks/` on the same node as the paper.

---

## 7. Human play

- Sidecar `human.steps_per_second: 8` tells the study page and Play tab to tick
  the game at 8 steps/s instead of 60. Craftax is turn-based; 60 steps/s is
  unplayable. Check the study harness: `study-serve.mjs` already reports `fps`
  per block, so pacing exists per block and needs only to read the sidecar.
- Controls overlay from `human.controls`; the same text goes into
  `study-config.json` if the game joins the study.
- The `quantized` action mode of the study harness must accept a 17-action
  space. It currently hardcodes the Discrete(8) recency stack; make it read the
  sidecar `actions` array. This is the largest harness change and is G6's blocker.
- 100-second blocks reach roughly 800 steps. Expect humans to collect wood, place
  a table, make wood tools, maybe stone. Report achievements unlocked, not score.

---

## 8. Website

`playtrain-website/build.sh` unions two game directories today. Add the multifile
dist directories as a third source and have the Play page read the sidecar for
the keymap overlay and step pacing. Label from `manifest.reference`: "exact
dynamics vs PufferLib Craftax-Classic" for parity games, nothing extra for others.

---

## 9. Training and the paper row

- PPO from the trainers repo, pixels 64×64×3, 17-way head, the same CNN as the
  catalog, `frame_skip=1` (turn-based; see the IMPALA note in memory: frame skip
  changes the game here, so do not use it).
- Report: steps/s end to end on the paper node, achievements-unlocked curve, and
  the 22-achievement success rates PufferLib and the JAX baselines report.
- Comparison rows: JAX Craftax-Classic-Pixels (same observation kind; our speed
  claim), PufferLib Classic (same dynamics, symbolic obs, faster; not a speed
  comparison), JAX Classic-Symbolic (context).
- The transfer experiment the JS version uniquely allows: train on base, evaluate
  and fine-tune on a `custom/` variant with the same 17 actions and pixel obs, no
  architecture change.

---

## 10. Full Craftax, prepared for

`craftax.h` is 3055 lines against Classic's 1222, 43 actions, 9 floors, a 48×48
map per floor, item and light maps, 5 mob classes with type ids, projectiles from
both sides, potions, attributes, an action mask, and a boss. What carries over
unchanged from this plan:

- `common/`: `f32`, `u64bits`, `parity`, `tilegrid`. Add `rng_rand_r.js` (full
  Craftax uses glibc `rand_r`, a 32-bit LCG; trivial) and `rng_f32_at` (seed-mixed
  per-cell draws for worldgen).
- The one-`ArrayBuffer` state pattern, the driver design, the corpus design, the
  gate ladder, the bundler, the sidecar, the loader, the website hook.
- The file numbering scheme, with `30_worldgen.js` split per floor type
  (smooth, dungeon, boss) and `50_mobs.js` per class.

What is new: level switching and per-level state arrays, the action mask (the
sidecar gains `"action_mask": true` and the host learns to read a `Uint8Array`
mask, which PufferLib's trainer also consumes), float health, and the rendering
of items and light. Estimate after Classic is done: 4 to 6 weeks, most of it the
corpus, because reaching floor 8 needs a competent scripted agent. The JAX
parity header `craftax_parity.h` offers a second oracle for the full game if we
ever want JAX-exactness; Classic has none.

---

## 11. Work plan

Days are working days for one person who knows the runtime.

| # | Task | Days | Done when |
|---|---|---|---|
| 1 | Vendor `games/craftax_src/`, license rows, `multifile/README.md`, directory skeleton | 0.5 | files in place, `THIRD_PARTY_LICENSES.md` updated |
| 2 | `cc_ref_driver.c`, stubs, `build.sh`, `layout` mode; builds on Mac and FASRC; cross-machine self-diff on 100 episodes | 2 | identical hashes on both machines |
| 3 | Corpus: policies in Python against the driver, action files, golden chains | 2 | G3 coverage of the C reaches 100% of game functions |
| 4 | `common/f32.js`, `rng_pcg32.js`, `u64bits.js`, `parity.js`; `10_constants.js`, `20_state.js` | 1.5 | G0 passes, layout test passes |
| 5 | `30_worldgen.js` | 1.5 | G1 passes on 1000 seeds |
| 6 | `40_player.js`, `50_mobs.js`, `60_world_tick.js`, `70_step.js` | 3 | G2 passes on the whole corpus |
| 7 | Bundler, `just` recipes, sidecar loader in Python and node envs, second games root | 1.5 | `GameEnv("craftax_classic")` steps with 17 actions |
| 8 | `80_render.js`, `90_playtrain.js`; validate suite | 2 | G5 passes |
| 9 | Engine gates with the 17-action table; AOT tier compile | 1 | G4 passes |
| 10 | Study harness: sidecar-driven quantizer and pacing; quickplay session | 2 | G6 recorded |
| 11 | Website: third source dir, overlay, label | 1 | game live on the Play tab |
| 12 | Throughput bench on the paper node; first PPO run | 1 + cluster time | numbers in `benchmarks/results/` |
| 13 | Symbolic obs mode (3.6) | 2.5 | G2 extended to the 1345-vector |

About 22 working days to the pixel-trained, human-playable, parity-tested game,
plus 2.5 for symbolic mode. Steps 4 to 6 are the port proper and are where a
second person could join, since each gate isolates a module.

---

## 12. Open questions, with the default we take if nobody objects

1. **Is `cosf`→V8 ieee754 an acceptable definition of parity?** Default: yes,
   stated in the README and the paper's appendix. The alternative, matching
   glibc's `cosf`, would make the JS depend on a libm we do not ship.
2. **Should the C driver live in `native/` instead of the game directory?**
   Default: game directory. It is a test fixture for one game, not part of the
   runtime.
3. **Do we also commit full dumps for a few episodes?** Default: no; hashes only.
   Dumps regenerate in seconds from the driver.
4. **Does the Play tab upscale a 512 canvas or run at 512?** Default: run at 512
   and let CSS scale. Confirm with the website build before step 11.
5. **Name of the shared action table in `runtime/action_spaces.json`.** Default:
   do not add it there. The sidecar is the source; the gate scripts read the
   sidecar via the existing env-var hooks.
