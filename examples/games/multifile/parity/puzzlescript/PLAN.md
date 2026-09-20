# PLAN — PuzzleScript on PlayTrain, with the PuzzleScript engine itself as the reference

PuzzleScript (increpare, MIT) is a JavaScript engine for turn-based rewrite-rule
puzzle games and a corpus of games written in it. This port makes PuzzleScript games
ordinary PlayTrain catalog games: one JS file each, human-playable in a browser,
steppable on every PlayTrain backend, and **identical to the reference by
construction**: the bundle carries the reference engine's own source files (pinned,
hash-checked, never edited) plus a game's text, and drives them through a PlayTrain
prelude. No re-implementation. The work is the harness around the engine, proving
it runs unchanged under QuickJS, and the gates that show the prelude drives it the
way the reference's own test runner does.

Written 2026-09-20 from the VGDL and CHIP-8 ports (`../vgdl/`, `../chip8/`,
`playtrain-internal/docs/DSL_PORTS_DESIGN.md` section 5). Their lessons are section 7.

## 1. Reference pins

| what | value |
|---|---|
| repo | https://github.com/increpare/PuzzleScript |
| commit | `d236596d993b6ebb7988f1a078f582c0840ccbca` (branch master, cloned 2026-09-20, "remove ai docs", 2026-09-06) |
| license | MIT (engine). Games in `src/demo/`: the README there says only the ones linked from the editor's example dropdown can be assumed MIT; the rest are "private records" of others' games. The corpus is the dropdown list (U01 extracts it from the editor source), authorship from each game's `author` line. |
| engine files (vendored verbatim) | `src/js/{storagewrapper,bitvec,level,languageConstants,globalVariables,debug,font,rng,riffwave,sfxr,colorhelpers,colors,engine,parser,compiler,soundbar}.js`, `src/js/codemirror/stringstream.js` (the list `src/tests/run_tests_node.js` loads), plus `src/js/graphics.js` for the render gate |
| reference test-suite (vendored) | `src/tests/resources/{testdata,errormessage_testdata,testingFrameWork}.js`: 770 tests, all pass under node on this Mac in 6.6 s (`node src/tests/run_tests_node.js`) |
| oracle | the pinned checkout run under node with the reference's own browser shims (`run_tests_node.js`); JS on both sides, so "oracle" means the unmodified checkout, not our vendored copy |

## 2. Reference semantics (what "exact" means here)

From `src/js/engine.js`, `compiler.js`, `globalVariables.js`, `inputoutput.js` and
`tests/resources/testingFrameWork.js`. Confirm each line from the live checkout in
U01 before writing the prelude; correct here first if it disagrees.

**Compile and load.** `compile(["loadLevel", n], text, randomseed)` parses the game,
builds `state` (objects, layers, rules compiled to matcher functions via
`new Function`, win conditions, `levels[]`, `metadata`), then `setGameState` loads
level `n` with `loadLevelFromLevelDat(state, leveldat, randomseed)`: `RandomGen = new
RNG(randomseed)` (RC4 keyed by the seed **string**; `rng.js`, public domain), `level =
leveldat.clone()`, `backups = []`, and if `run_rules_on_level_start` is set one
`processInput(-1, true)`. A falsy seed becomes `(Math.random() + Date.now())`, so the
prelude always passes a string. Levels whose `leveldat.message` is defined are message
screens, not playable levels.

**Turn.** `processInput(dir)` with `dir` in `0 up, 1 left, 2 down, 3 right, 4 action,
-1 no input (tick)`: marks player movement, applies rules (with the rigid-body retry
loop, at most 50 iterations), resolves movements, applies late rules, then
`processCommandQueue`: `cancel` undoes the turn, `restart` restores the restart
target, a modified level pushes an undo state, sounds are queued, `checkWin` runs when
not in text mode, `checkpoint` saves, and `again` schedules another turn if a dry run
shows it would change something (`againing = true`). The reference's own test runner
and its browser loop both resolve `again` to completion: `while (againing) { againing
= false; processInput(-1); }`. **One PlayTrain step = one input followed by that loop.**
`require_player_movement` cancels a turn in which no player moved. Undo and restart are
inputs in the reference but not actions here.

**Win.** `checkWin` sets `winning = true` (via `DoWin`) when every win condition holds
or a rule issued `win`. In the browser, the next key press after `winning` calls
`nextLevel()`; under `unitTesting` `DoWin` calls `nextLevel()` directly. The prelude
runs with `unitTesting = false`, reads `winning` after the step, and by default ends
the episode there (`gameState = 'WIN'`, reward 1). `episode: "game"` (sidecar) would
instead call `nextLevel()` and skip message levels; that is section 9.

**Levels.** A bundle holds the whole game. `level_mode: "seed"` (default) picks
playable level `seed % nPlayable`; `"fixed"` pins one. Message levels are never
picked. The engine's own `curlevel` is set accordingly before `loadLevelFromState`.

**Realtime.** `realtime_interval` games autotick (`processInput(-1)`) every interval
in the browser. Two of 94 demos use it; neither is in the editor dropdown, so the
corpus (U01: 17 games, 0 realtime) has none. A step model (`ticks_per_step`) exists
only if the human asks (section 9).

**RNG.** `random` rules and `randomDir` draw from `RandomGen` (RC4: `RandomGen._state.{s,i,j}`).
The only other randomness in the engine is the fallback seed above. Seed string = `String(seed)`.

**Level indices count message screens** (U01: microban has 21 levels, playable 1,3,5,...,19).
`compile(["loadLevel", n])` on a message level leaves `textMode` true and no `level`.

**State that the gate compares every step.** `convertLevelToString()` (the reference's
own serialiser: every cell's sorted object names, `debug.js`), `curlevel`, `winning`,
`againing` (always false after the loop), `textMode`, `messagetext`, `backups.length`,
`RandomGen`'s RC4 state (`s`, `i`, `j`), and the movements array (all zero after a
turn). Plus, for the render gate, the sprite draw list (below).

**Render.** `graphics.js redraw()` draws, per visible cell, the sprites of the objects
present in layer order (layer 0 first, so higher layers paint over lower ones), each a
5x5 sprite from `state.objects[name].spritematrix` with colours from
`state.objects[name].colors` (already resolved to hex by the compiler using the
game's `color_palette`), transparent where the matrix has `.`; the background is
`state.bgcolor`. `flickscreen` / `zoomscreen` select a viewport around the player
(`oldflickscreendat`). The prelude composites each distinct object-stack into a 5x5
tile in a growing atlas and draws the level with one `drawTiles` call per frame; the
render gate records the reference's `drawImage` calls through a stub 2D context and
compares (cell, ordered sprite ids, viewport).

## 3. Architecture (mirrors `../chip8/`)

```
parity/puzzlescript/
  manifest.json           family manifest: PuzzleScript pin, vendored-file sha256s, corpus, per-game metadata, not_matched
  PLAN.md PROGRESS.md LOOP.md
  reference/js/           the vendored engine files, byte-identical to the pinned commit (test_vendor.py)
  reference/tests/        testdata.js, errormessage_testdata.js, testingFrameWork.js (vendored, 4 MB + 1.2 MB)
  games/<game>.txt        the game text, byte-identical to src/demo/<file> at the pin (sha256 in manifest)
  games/<game>.json       per-game def: title, author, source file, level_mode, playable level count, action names, not_matched
  src/
    05_shims.js           what run_tests_node.js stubs for the browser (localStorage, document, window, canvas, sound, console
                          hooks), written for QuickJS too (no process, no performance)
    90_prelude.js         PlayTrain contract: setup compiles once; resetGame(seed) loads the seed's level with seed String;
                          draw() = one input + the again loop; WIN on winning; tile atlas render; gate hooks __ps
  tools/bundle_puzzlescript.mjs   one game -> dist/ps_<game>.js (+ sidecar): header consts, shims, reference/js/*.js in the
                          reference's load order, prelude; bundle_all.mjs [--check]
  tests/
    oracle.mjs            the reference checkout under node with its own shims: same game text, level, seed, inputs ->
                          per-step state dump (JSON). Needs PS_REF=<checkout at the pin>
    gate_oracle.mjs       lockstep gate: bundle (node vm) vs oracle, every step, every field
    run_reference_tests.mjs   the 770 reference tests through the BUNDLE's engine (node), and through qjs_host (U04)
    render_gate.mjs       reference redraw() with a recording context vs the prelude's tile list
    golden.mjs golden.json
    test_*.py             pytest: vendor identity, reference tests, lockstep, render, goldens, freshness, engine gate,
                          runtime, browser
  dist/                   GENERATED, committed
```

**Action space.** `[UP, LEFT, DOWN, RIGHT, ACTION, NOOP]` in the engine's own `dir`
order 0..4, NOOP last. NOOP does nothing in a turn-based game (no `processInput`;
the reference does nothing without a key either). Browser keys: arrows and X (the
reference's action key), also Z/space? No: the reference binds action to X, space,
enter; the sidecar's `held` uses X (88). Undo (Z) and restart (R) are not actions.

**Observation.** The level drawn at 5 px per cell into a canvas sized for the
largest playable level, letterboxed like VGDL; flickscreen/zoomscreen games draw the
viewport instead. Pixels vs the reference are checked only through the draw-list
gate (positions and sprite ids), not pixel values: the reference draws at a window-
dependent cell size.

## 4. Gates, in the order they must go green

| gate | what it proves | file |
|---|---|---|
| G0 vendor | every vendored file is byte-identical to the pinned commit; the reference's own test runner passes on the checkout | `tests/test_vendor.py`, `tests/oracle.mjs --selftest` |
| G1 reference tests in the bundle | the 770 reference tests pass through the shims + vendored engine as bundled (node) | `tests/run_reference_tests.mjs`, `test_reference_tests.py` |
| G2 corpus compiles | every corpus game compiles with zero errors in the bundle and has >= 1 playable level | `test_corpus.py` |
| G3 lockstep | every corpus game, 3 seeds, 300 random actions: identical state (section 2 list) every step vs the checkout | `tests/gate_oracle.mjs`, `test_lockstep.py` |
| G4 goldens | committed per-run hashes of G3's runs plus three more seeds, checked without the checkout | `tests/golden.mjs`, `test_golden.py` |
| G5 freshness | `dist/` is what `bundle_all.mjs` produces | `test_bundle_fresh.py` |
| G6 QuickJS | the 770 reference tests pass under `qjs_host` too; `native/gate_qjs.sh` byte-identical V8 vs QuickJS over all bundles | `test_engine_gate.py` |
| G7 runtime | discoverable by name, sidecar honoured, `NativeVecEnv` steps | `test_runtime.py` |
| G8 render | reference `redraw()` draw list == prelude tile list on 200 random states per game, viewport included | `tests/render_gate.mjs`, `test_render.py` |
| G9 browser | headless Chromium plays three games | `tests/browser_smoke.mjs`, `test_browser.py` |
| G10 throughput | steps/s per game on QuickJS, 1 env and 20 env / 10 thr; compile time per game on QuickJS | `benchmarks/bench_puzzlescript.py` |

G3 is real even though both sides run the same engine: it is the prelude, the shims,
the seed string, the level choice and the again loop that can be wrong, and the
oracle is the unmodified checkout driven the way its author's test runner drives it.

## 5. Not matched (write these into `manifest.json` in U03)

- pixels: the reference draws at a window-dependent cell size; PlayTrain draws 5 px cells into a fixed canvas. Sprite ids and positions are gated, pixel values are not
- undo, restart, level select, the title screen, message screens and the win-to-next-level key press: the episode ends at `winning`
- sound (`sfxr` is loaded because the compiler needs it; nothing is played)
- realtime games (`realtime_interval`): excluded from the parity corpus
- key repeat and the browser's input buffering: one action per step, no repeats
- the reset consumes one NOOP frame before the first agent action (PlayTrain draws and steps in the same frame)

## 6. Speed expectation

Unknown until measured; that is the point of T0. The reference runs its 770 tests
(compile + simulate) in 6.3 s on V8 here. Compile is heavy and uses `new Function`;
QuickJS supports it but the AOT tier cannot compile dynamically generated functions,
so `qjsc -A` will not help the rule matchers. Measure compile time per game and
steps/s on QuickJS in G10; if compile on QuickJS is more than a few seconds for a
corpus game, cache the compiled state per bundle at bundle time is a section 9
question, not a unit. Do not build a compiler.

## 7. Lessons from the VGDL and CHIP-8 ports that bind here

1. **Run the reference the way its authors ran it.** The reference's own test runner
   (`run_tests_node.js` + `testingFrameWork.js`) is the driving protocol: `compile
   (["loadLevel", n], text, seed)`, the `again` loop after every input, `unitTesting`
   semantics. Print the constants from the live checkout in U01 before writing the
   prelude; CHIP-8's timer rule and `disable_delay` default were both wrong in the plan.
2. **The corpus is the reference's corpus, verified by hash**, and its license is a
   human question. Game texts are copied from the pinned commit with sha256 recorded;
   the demo README's warning goes into the manifest and a `games/NOTICE.md`.
3. **Full-state lockstep every step, then JS-vs-JS goldens, then everything else.**
   Here the state is the reference's own `convertLevelToString()` plus the flags and
   the RC4 state; a score-only gate would pass a frozen level.
4. **The reference's RNG is part of the spec.** RC4 keyed by the seed string; the
   prelude passes `String(seed)`; the gate compares `RandomGen.s/i/j`.
5. **Interpreter first, measure, then decide.** T0 means no engine of ours at all.
6. **Sidecars carry the action space, and every gate must be told about it.** Six
   actions; `gate_qjs.sh` needs `PLAYTRAIN_QJS_ACTIONS`; the browser page reads the
   sidecar for the keymap.
7. **Name every function a table may reference.** Applies to the prelude and shims.
8. **Never edit the reference.** Vendored files are hash-checked against the pin
   (G0). A shim may add a missing global; it may not patch engine behaviour. If the
   engine misbehaves under QuickJS, that is a `blocked` note naming the construct.
9. **`uv run --no-sync python -m pytest`** in the playtrain repo (`uv run --no-sync
   pytest` cannot spawn the binary here); node for everything JS.
10. **Never edit `dist/`; never weaken a gate; one unit per iteration; commit only
    green gates.** Goldens use six seeds.
11. **The page template scopes a bundle's top-level `const`s**: anything a gate or the
    browser smoke needs must be exported through the hook object (`__ps`).
12. **Per-game action tables**: not needed here (one space for all games), but the
    runtime reads `actions` from the sidecar, so ship it there anyway.

## 8. Units

Branch: `puzzlescript`, created from `chip8` in U00.

| unit | task | done when |
|---|---|---|
| U00 | `git checkout -b puzzlescript` from `chip8`; commit PLAN/PROGRESS/LOOP | `git status` clean except `native/aotfork/out/`, `examples/games/js/analogen_*`; chip8 suite still `52 passed` |
| U01 | Pin + vendor + oracle: clone the reference at the pin into the scratchpad; `reference/js/` and `reference/tests/` vendored with sha256s in `manifest.json`; extract the editor dropdown example list and copy those `src/demo/*.txt` into `games/` (sha256 each; exclude `realtime_interval` games, record them); `tests/oracle.mjs` drives the checkout with the reference's own shims: `--game <txt> --level n --seed s --actions 0,1,2,3,4,5 --json` dumps the section-2 state per step, plus the constants it observes (levels, playable levels, metadata keys, again loop count per input); `test_vendor.py` (G0) | G0 green: every vendored file matches the pin; `oracle.mjs --selftest` runs the 770 reference tests on the checkout and they pass; corpus list and exclusions in manifest.json; section 2 corrected if anything differs |
| U02 | Shims + reference tests through the bundle: `src/05_shims.js` (what `run_tests_node.js` provides, without node globals), `tests/run_reference_tests.mjs` concatenating shims + vendored engine + vendored tests exactly as the bundler will, running all 770 | G1 green: 770/770 under node |
| U03 | Prelude, bundler, sidecars, corpus compile: `src/90_prelude.js`, `tools/bundle_puzzlescript.mjs` + `bundle_all.mjs`, `games/*.json`, `manifest.json` `not_matched`, `test_corpus.py` | G2 green: every corpus game compiles in its bundle with zero errors and reports its playable level count; `list_available_games()` shows `ps_<first game>` |
| U04 | Lockstep: `tests/gate_oracle.mjs` (bundle in node vm vs `oracle.mjs`), `test_lockstep.py`; goldens (6 seeds) and freshness | G3 exact for every corpus game x 3 seeds x 300 steps; G4, G5 green |
| U05 | QuickJS: the 770 reference tests through `qjs_host` (a bundle variant that runs the test data, or `qjs_host` executing the concatenation directly); `native/gate_qjs.sh` over all bundles with `PLAYTRAIN_QJS_ACTIONS`; any QuickJS incompatibility is a `blocked` note naming the construct, never a patch to the engine | G6 green |
| U06 | Runtime + throughput: `test_runtime.py` (discovery, sidecar, `NativeVecEnv` 4 envs), `benchmarks/bench_puzzlescript.py` (compile time on QuickJS per game; steps/s 1 env and 20 env / 10 thr); numbers in PROGRESS.md | G7 green; G10 numbers recorded; section 6 corrected |
| U07 | Render gate: `tests/render_gate.mjs` loads `graphics.js` with a recording 2D context and compares the reference draw list with the prelude's tiles (viewport included) on 200 random states per game; `test_render.py` | G8 green |
| U08 | Browser: build-pages smoke via playwright (`PLAYWRIGHT_CORE_DIR`, `PLAYWRIGHT_CHROMIUM` as in chip8), keymap overlay from the sidecar; screenshot inspected and described in PROGRESS.md | G9 green |
| U09 | Report: `README.md`, `games/NOTICE.md` (author per game, the demo README's license warning, removal procedure), status log in `playtrain-internal/docs/DSL_PORTS_DESIGN.md`, memory note; all gates green in one pytest run | files written; one `uv run --no-sync python -m pytest examples/games/multifile/parity/puzzlescript/tests -q` green |
| U10 | handoff: play three games in a real browser; decide section 9 | notes for the human in PROGRESS.md |

## 9. Open questions for the human (do not block on them)

1. Episode = one level (default, `WIN` at `winning`) or the whole game (`nextLevel()` auto-advance, reward per level)? Affects what "score" means.
2. Corpus license: only the editor-dropdown examples are safe per the demo README. Ship those only (default), or ask the other authors?
3. Realtime games (`chaos wizard`, `easyenigma`): exclude (default) or define `ticks_per_step`?
4. Reward shaping: none by default (0 until win). A manifest `reward` block naming counted objects is a design-doc idea; want it?
5. If QuickJS compile time per game is seconds: precompile at bundle time (serialise `state`) or accept it?
