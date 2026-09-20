# Package split: `native/twins` -> a sibling `playtrain-engines` (U13 notes for the human)

Decision recorded by the human on 2026-09-20 (PLAN section 9): after U12 the native engines move to their own
package. This file is the migration note. Nothing has been moved yet; it is a plan with the facts measured from the
tree as it stands at U12.

## 1. The rule that makes the split safe

**Nothing ships from `playtrain-engines` that does not pass the gates against a PlayTrain bundle.** The JS bundles
in `examples/games/multifile/parity/<family>/dist` ARE the specification; the engines are accelerators. Concretely:

- the engines repo pins one playtrain commit in `playtrain.lock` (commit + sha256 of every bundle, sidecar,
  `tests/golden.json` and `twin/` data file it was gated against);
- `make gate` (the T0-T7 suite, `tests/`) runs against `$PLAYTRAIN_ROOT` and refuses to run when that checkout's
  commit differs from the lock (an explicit `--repin` re-runs the whole suite and rewrites the lock);
- a release (`libtwin_vec.{dylib,so}`, `twin_host`, the `.wasm` games) is cut only from a green `make gate`, and
  the release notes name the pinned playtrain commit;
- the engines repo never edits a family: the JS front-end tools (`tools/twin_spec.mjs`, `tools/twin_state.mjs`,
  `tools/precompile_caches.mjs`) and their committed outputs (`twin/`) stay in playtrain, because they run the JS
  compilers and their outputs are hash-checked against the JS sources there.

## 2. What moves, what stays

Moves (git history preserved with `git subtree split -P native/twins` or `git filter-repo --path native/twins
--path benchmarks/bench_twins.py`):

| path | role |
|---|---|
| `native/twins/common/` | Twin interface, vec host (the `vec_*` ABI), registry, file abstraction, jsnum |
| `native/twins/chip8/`, `vgdl/`, `puzzlescript/` | the three engines (the ports) |
| `native/twins/wasm/` | Emscripten build (`build_game.mjs`, `p5_wasm.cpp`, `wasm_game.cpp`) |
| `native/twins/tests/` | T0-T7 gates + the wasm gates (pytest + node harnesses) |
| `native/twins/third_party/json.hpp` | nlohmann 3.11.3 (sha256 in manifest.json) |
| `native/twins/{build.sh,manifest.json,PLAN.md,PROGRESS.md,LOOP.md,PACKAGE_SPLIT.md}` | build + record |
| `benchmarks/bench_twins.py` | T7 (needs `playtrain.runtime.NativeVecEnv`, see below) |

Stays in playtrain (the engines READ these through `$PLAYTRAIN_ROOT`):

| path | why it stays |
|---|---|
| `native/runtime/p5.hpp`, `p5.cpp`, `jsmath.h` | the drawing surface the QuickJS host and the twins share; one copy |
| `crates/rasterizer` (staticlib) | the pixels; one copy for every backend |
| `native/frozenmath`, `native/qjs/v8libm/ieee754.cc` | the host's math ABI (twins call none of it today; the link line does) |
| `native/reference_trace.mjs`, `runtime/p5/game-env.mjs`, `tools/build-pages.mjs`, `tools/play-templates.mjs` | the V8 reference the gates compare against; the wasm loaders |
| `src/playtrain/runtime/native_vec_env.py` | the Python consumer of the `vec_*` ABI (T5, T7, training) |
| `examples/games/multifile/parity/<family>/{dist,games,roms,tests,twin,tools}` | the specification, goldens, serialised data, front-end tools |
| `native/qjs/qjs_vec_host.cpp` | the ABI's reference implementation and T5's other side |

## 3. Interfaces that must stay stable (the contract between the two repos)

1. The `vec_*` C ABI as `native_vec_env.py` binds it (create/reset/step/close, obs modes, actions table, seed
   modes, frame_skip, the async/analog/box entry points as loud stubs). Versioned by the Python loader; a change on
   either side is a coordinated release.
2. The p5 surface the twins use: `createCanvas`, `background`, `fill`, `noStroke`, `rect`, `drawTiles`,
   `keyIsDown`, plus the host-side `newState/selectState/setRasterRes/setKeysDown/render_obs_rgb/frameBegin/End`.
   `wasm/p5_wasm.cpp` lists the exact subset; adding a p5 call to a twin means adding it there and in the glue.
3. The sidecar schema: `family`, `game`, `corpus`/`level_mode`/`render`/`level_index` (vgdl), `actions[].held`,
   `obs.symbolic`, `playable_levels`/`level_mode` in the family's `games/<game>.json` (puzzlescript).
4. The serialised-data shapes: `twin/<corpus>/<game>.json` (vgdl spec), `twin/state/ps_<game>.json` and
   `twin/caches/` (puzzlescript), `games/<game>.json` + `roms/` (chip8). Produced in playtrain, consumed here.
5. The trace protocol of `reference_trace.mjs` (T4) and the families' gate hooks (`__chip8`, `__vgdl`, `__ps`:
   snap/step/reset/tiles) that T2/T3/T6 drive.
6. The wasm game format: glue declaring `const __PT_WASM_FILE = "<name>.wasm"`, loaders supplying
   `__PT_WASM_BYTES` (node) or `__PT_WASM_MODULE` (page), imports `pt_*` + `emscripten_notify_memory_growth`,
   exports `pt_setup/pt_reset/pt_draw/pt_score/pt_lives/pt_state/pt_obs_dim/pt_observation`.

## 4. Migration steps (about one day)

1. `git subtree split -P native/twins -b engines-split` in playtrain; new repo `playtrain-engines` pulls that
   branch; `benchmarks/bench_twins.py` moves with a one-line path fix.
2. Paths: `build.sh` takes `PLAYTRAIN_ROOT` (default `../playtrain`) instead of `NATIVE=..`; `tests/conftest.py`
   derives `REPO` from `PLAYTRAIN_ROOT`; `wasm/build_game.mjs` the same; the T5/T7 tests import
   `playtrain.runtime` from a `pip install -e $PLAYTRAIN_ROOT` (or the wheel).
3. `playtrain.lock` written by `make repin` (commit + the sha256 list); `make gate` checks it first.
4. CI: macOS arm64 + Linux x86-64 runners; steps = build rasterizer (`native/build_qjs.sh` once, it also builds
   frozenmath), `build.sh` release + `DEBUG=1`, pytest `tests/` (T0-T7 + wasm), with emsdk pinned at 6.0.9 and
   playwright-core installed in the job (the repo's `node_modules/playwright-core` symlink is dead, see PROGRESS).
5. Releases: `libtwin_vec.{dylib,so}`, `twin_host`, and `dist_wasm/<name>.{wasm,js,json}` for the 82 bundles.
   `make install-wasm PLAYTRAIN_ROOT=..` copies the wasm games into the families' `dist/` (the loaders already
   support them; the families' own gates keep running on the JS bundles).
6. playtrain keeps a one-paragraph pointer in `native/README` and the `NativeVecEnv(lib_path=...)` option; whether it
   defaults to the twin for `chip8_*`/`vgdl_*`/`ps_*` is PLAN section 9 question 1 (U11).

## 5. Alternatives weighed

- **Stay in-tree.** Simplest; the gates already run from one checkout. Right until a second consumer of the
  engines exists (another game repo, the wasm games served from a site) or the engines' build (Emscripten,
  sanitizers) starts slowing playtrain's CI. Recommended if neither is imminent.
- **Git submodule** of playtrain inside the engines repo instead of `PLAYTRAIN_ROOT` + lock. Same pin, more
  friction (nested checkout of a large repo); the lock file gives the same guarantee with a plain sibling checkout.
- **Vendor the serialised data** (`twin/`) into the engines repo. Rejected: it would duplicate hash-checked
  outputs whose source of truth is the JS; the lock's sha256 list covers them without a copy.

## 6. Recommendation

Do the split as written above once U11's decisions are in (default `lib_path`, symbolic vs pixel default, cluster
numbers): the engines repo's first release should be cut against the same playtrain commit those decisions land in,
so the lock, the release notes and PROGRESS.md all name one commit. Until then, in-tree costs nothing.
