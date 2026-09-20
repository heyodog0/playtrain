# `parity/puzzlescript/` — PuzzleScript games on PlayTrain, by identity

The reference engine runs inside every bundle. `reference/js/` is PuzzleScript's own
engine (increpare, MIT, `increpare/PuzzleScript` @ `d236596`), vendored byte for byte
and never edited; `games/*.txt` are the 17 games the PuzzleScript editor offers as
examples; `src/` is only what PlayTrain needs around the engine: browser shims and a
prelude that drives `compile()` / `processInput()` exactly as the reference's own test
runner does. `tools/bundle_all.mjs` produces one ordinary PlayTrain game per text in
`dist/` (`ps_microban`, `ps_midas`, …), steppable on every backend and playable in the
browser. There is no engine of ours to be wrong; the gates check the harness.

```
manifest.json          family manifest: pin, vendored-file sha256s, corpus, per-game metadata, not_matched, quirks
reference/js/          the vendored engine (17 files in the reference's load order + graphics.js for the render gate)
reference/tests/       the reference's own 770 tests (testdata, errormessage_testdata, testingFrameWork)
games/<game>.txt       game text, byte-identical to src/demo/<game>.txt at the pin;  games/NOTICE.md: authorship
games/<game>.json      per-game def: title, author, level_mode, playable_levels, controls
src/05_shims.js        what the reference's node runner stubs for the browser, plus performance/console/Audio for QuickJS,
                       and the eval-scope probe the bundler's bridge is guarded by
src/90_prelude.js      PlayTrain contract; one draw() = one processInput + the again loop; tile-atlas render; hooks __ps
tools/bundle_puzzlescript.mjs   one game -> dist/ps_<game>.js (+ sidecar); bundle_all.mjs [--check]
tools/game_notice.py   games/NOTICE.md from the manifest
tests/oracle.mjs       the UNMODIFIED checkout under node (PS_REF=<checkout>) driven like its own runner
tests/gate_oracle.mjs  G3 lockstep, every step, every field;  golden.mjs: G4;  render_gate.mjs: G8;  browser_smoke.mjs: G9
tests/run_reference_tests.mjs   G1/G6: the 770 tests through the bundle (node; --emit for qjs_host)
tests/test_*.py        pytest for all of it; the checkout, qjs_host and browser tests skip, and only skip, when absent
dist/                  GENERATED. Never edit.
```

## What parity means here

The same game text, playable level, seed string and action sequence give the same
`convertLevelToString()` (the reference's own level serialiser), `sha1(level.objects)`,
`curlevel`, `winning`, `againing`, `textMode`, `messagetext`, undo depth, movement
buffer and RC4 state as the unmodified checkout after reset and after every step, and
the same `again` loop count per input. Checked:

| gate | result |
|---|---|
| G0 vendor | every vendored file sha256 == the pin; the reference's runner passes 770/770 on the checkout |
| G1 reference tests | 770/770 through the bundle's shims + engine under node (8 s) |
| G2 corpus | 17/17 games compile with zero errors, playable counts match, three seeds step |
| G3 lockstep | 51/51 trajectories: 17 games x 3 seeds x 300 steps, 15 fields every step, vs the checkout |
| G4 goldens | 102 trajectories (6 seeds), full state, without the checkout |
| G6 QuickJS | 770/770 under `qjs_host` (80 s); 17/17 bundles byte-identical V8 vs QuickJS, obs hash included |
| G7 runtime | discoverable by name, sidecar honoured, `NativeVecEnv` steps, the level is drawn |
| G8 render | the reference's own `redraw()` (recording 2D context) == the prelude's tiles on 3,538 states |
| G9 browser | microban, kettle, midas play in headless Chromium |

Deliberately not matched (manifest `reference.not_matched`): pixel size (5 px cells vs a
window-sized canvas; sprite ids and positions are gated, pixel values are not), undo,
restart, the title and message screens and the key press after a win (the episode ends
at `winning`, reward 1), sound, key repeat, the reset's NOOP frame.

## What the harness had to get right

- **Drive it like the author's test runner.** `compile(["loadLevel", n], text, String(seed))`
  with `unitTesting = false` (so `winning` is observable) and `lazyFunctionGeneration =
  false`; after every input `while (againing) { againing = false; processInput(-1); }`.
- **Seed is a string.** RC4 keyed by the seed string; a falsy seed falls back to `Math.random()`.
- **Level indices count message screens.** microban has 21 levels, 10 playable; the
  prelude picks `playable[seed % n]`. Loading a message level leaves no `level`.
- **Mute through the engine.** With `unitTesting` false, a rule-triggered sound reaches
  `new Audio()` and, headless, dies inside the sound synthesiser. Both the prelude and the
  oracle set the engine's own `muted = 1`.
- **Never wrap the engine as CommonJS.** `sfxr.js` calls `require()` whenever `exports`
  exists. QuickJS has no `performance` or `console`; the shim adds both.
- **The play page evals the game.** Under an indirect eval, top-level `let`/`const` are
  invisible to the matchers the engine builds with `new Function`. The bundler emits a
  guarded accessor bridge for the 191 engine-level names (see manifest `reference_quirks`),
  a no-op wherever the bundle runs as a classic script.
- **Two of my own bugs the gates caught:** `BitVec.get` returns a boolean (`!== 0` merged
  every cell into one tile; G6's observation check); `Object.keys` reorders integer-like
  atlas keys (G8).

## Running the reference gates

```bash
git clone https://github.com/increpare/PuzzleScript /tmp/puzzlescript && git -C /tmp/puzzlescript checkout d236596d993b6ebb7988f1a078f582c0840ccbca
export PS_REF=/tmp/puzzlescript
node tests/oracle.mjs --selftest                                   # the reference's own runner on the checkout
node tests/gate_oracle.mjs microban --steps 300 --seeds 1,2,3      # one game;  no args: the corpus (~3 s)
node tests/render_gate.mjs                                         # reference redraw() vs prelude tiles
uv run --no-sync python -m pytest examples/games/multifile/parity/puzzlescript/tests -q   # from the repo root
```

The QuickJS gates need `native/build/qjs_host`; the browser test needs `playwright-core`
(`PLAYWRIGHT_CORE_DIR`) and a Chromium (`PLAYWRIGHT_CHROMIUM`).

## Speed

QuickJS: 1.2k-13.4k steps/s per env (rule-heavy games low, sokoban-likes high),
4.7k-97k on 20 envs / 10 threads; compile is ~20 ms per game. V8 is ~10x faster. The
matchers are `new Function`-generated, so the AOT tier cannot help them. Table in
`PROGRESS.md`.

## Action space and controls

`ps6`: UP LEFT DOWN RIGHT ACTION NOOP, the engine's `processInput` codes 0..4 then no
input. Held browser keys: arrows and Space (a reference action key the play page
forwards; X is not forwarded). Episodes truncate at 1000 steps (sidecar `max_steps`).

## Adding a game

Only games whose license is established (PLAN section 1). Copy the text into `games/`,
write `games/<name>.json`, add it to `manifest.json` (`corpus`, sha256), run
`node tools/bundle_all.mjs`, `node tests/gate_oracle.mjs <name>`, `node tests/golden.mjs --write`,
`uv run --no-sync python tools/game_notice.py`.
