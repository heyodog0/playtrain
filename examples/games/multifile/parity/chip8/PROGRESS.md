# PROGRESS — CHIP-8 on PlayTrain (Octax parity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 11
BRANCH: chip8 (from vgdl @ 0f341a0)
LAST_COMMIT: 67b1d8c

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 commit vgdl, branch chip8 | done | `9 passed, 3 skipped in 153.81s` | 0f341a0 (vgdl), af2e251 (chip8 harness) | vgdl committed as 306 files; `reproduction/*`/`REPRODUCING.md` edits were not present in the tree; skips = playwright, qjs_host not built, RC_RL oracle. `uv run --no-sync pytest` cannot spawn the binary here: use `uv run --no-sync python -m pytest` |
| U01 scaffold + oracle | done | `2 passed in 1.85s` (2 skipped without CHIP8_ORACLE_PY/CHIP8_OCTAX) | 83321ba | Oracle venv is in the session scratchpad (`uv venv -p 3.12 octax-venv`; `jax[cpu]~=0.6.1 flax~=0.10.6 numpy~=2.2.6 opencv-python-headless~=4.11.0 pillow~=11.2.1`; got jax 0.6.2); re-create it and re-clone Octax @ 3aa53b5 when the scratchpad is gone. Run gates with `CHIP8_OCTAX=<checkout> CHIP8_ORACLE_PY=<venv>/bin/python`. Octax imports cv2 and PIL at package import, hence the two image libs. 39 ROMs copied; sha1 of the pinned files is the reference (metadata hashes wrong for flight_runner, spacejam, worm, all levelled). Display hash = packbits of display[x][y] C-order, sha1. Oracle ~1.4 s per invocation (JIT). |
| U02 CPU core + opcode vectors | done | `193/193 vectors match (15 legacy-mode)`; pytest `3 passed` | 087c13f | `tests/export_vectors.py` wraps `octax.execute` while Octax's own 69 tests run (all pass) and records every call -> `tests/vectors/octax_tests.json` (193 vectors, incl. 11 CXNN and 15 legacy-mode; the CPU carries a `modern` flag so legacy vectors replay too). Because CXNN needs threefry, `src/10_threefry.js` already has split + bits + randint8 (block fn copied from craftax); U03 is now: move the block fn to `../../common/`, G2 over 10k keys, keep craftax green. Probed live: FX29 is uint8 end to end (V=40 -> I=24); legacy FX55 bumps I unmasked (0xFFF -> 4111); any EXNN other than A1 acts as EX9E; 5XYN/9XYN ignore N. |
| U03 threefry split + randint | done | `keys ok; randint 10000/10000; split sha1 ok`; chip8 pytest `5 passed`; craftax test_rng+test_render+test_bundle_fresh `16 passed, 2 skipped` (skips: C driver absent, pre-existing); craftax_fp_free `11 passed` | b2d772d | Block fn, PRNGKey, split, bits32 now live in `examples/games/multifile/common/threefry2x32.js`; craftax `16_threefry.js` keeps uniform + craftaxStateRng; the three craftax-family manifests list the common file first and their dist/ bundles were rebuilt (`bundle_multifile.py <manifest>` per manifest; `--all` KeyErrors on the vgdl/chip8 family manifests because they have no `sources`, pre-existing). craftax's `test_bundle_is_not_stale` was deselected because it shells out to a bare `uv run` (rewrites the lockfile on this Mac); its `--check` was run by hand with `--no-sync`: ok x3. chip8 sources for gates/bundler are `conftest.SOURCES` = common/threefry2x32.js + src/*.js; U05's bundler must use the same list. G2 reference `tests/vectors/randint_10k.json` (keys = split(PRNGKey(20260919), 10000)) is regenerated and diffed when the oracle is configured. |
| U04 env step + 3 games lockstep | done | `9/9 trajectories exact` (brix, pong, tetris x seeds 1,2,3 x 500 steps, every field, past terminated); pytest `6 passed` | 753fa40 | `src/30_env.js`: c8EnvCreate/Reset/Step mirror OctaxEnv incl. the cached post-startup state and the uint8 timer rule `(t - 1) & 0xFF`. Score/terminated are JSON expression trees in `games/<game>.json` evaluated by `c8Eval` with JAX dtype rules (V is u8, consts weak, `i32` node promotes; u8 ops wrap) so U06 can transcribe airplane's `-V11 - V12` (uint8) faithfully; ops: V const i32 u8 neg add sub mul floordiv mod eq ne gt lt ge le or and not cond true false. `tests/gate_oracle.mjs [games] --steps --seeds` also checks games/*.json against the module's action_set/disable_delay/startup/custom_startup as reported by the oracle. Lockstep compares all 500 steps regardless of termination (oracle `--no-stop`); PlayTrain's own stop-at-GAMEOVER is U05. `C8_CUSTOM_STARTUP` table is empty: deep and vertical_brix need their startup functions transcribed in U06. Levelled games: def may carry `env_id` (e.g. cavern1) for the oracle. brix terminates at step 20-38 under random play, pong 332-380, tetris never within 500. |
| U05 prelude, bundles, sidecars, goldens | done | `golden ok (18 trajectories)`, `dist/ fresh (3 games)`, pytest `10 passed` (G0-G5 + runtime discovery/sidecar) | be6ea32 | `src/90_prelude.js`: one draw() = one env step; action = first held key in action_set order else NOOP; GAMEOVER on terminated; canvas 256x256 with the display drawn by one drawTiles call into the 256x128 middle band (at 64x64 obs each CHIP-8 pixel is one pixel, rows 16..47); classic green-on-black; own base64 decoder (no atob in QuickJS). `tools/bundle_chip8.mjs <game> [--sidecar]` inlines games/<game>.json + ROM (sha1 checked against def and manifest) + common/threefry2x32.js + src/*.js; `tools/bundle_all.mjs [--check]`. Sidecar: name chip8_<game>, `actions` = KEY_<hex> (held = browser keyCode, layout 1234/QWER/ASDF/ZXCV) then NOOP, `action_space` 'chip8_<game>' (informational; the runtime takes the `actions` list, env.py:176), max_steps 4500, rom sha1, reference pin. Goldens: 6 seeds x 500 steps, full state, stepping past terminated (a `--steps` parsing bug made the first write hash zero steps; fixed before commit). `not_matched` written into manifest.json. `list_available_games()` shows chip8_brix/pong/tetris (test_runtime.py). draw()-path check: brix GAMEOVER at draw 19 with key Q held. |
| U06 all 22 games lockstep | done | `111/111 trajectories exact` (37 defs x seeds 1,2,3 x 500 steps, every field); pytest `10 passed in 104s`; goldens 222; dist fresh (37) | 442b271 | 37 `games/*.json`: 19 single games + cavern 1,2,3,5,6 + space_flight 1-10 + target_shooter 1-3 (levelled defs carry `env_id`). cavern4a/4b are not loadable via create_environment: PLAN section 9 Q4, not shipped. `C8_CUSTOM_STARTUP` has deep (hold key 0 for 150 instr) and vertical_brix (hold key 7 for 1000). Score/terminated transcribed by hand into expression trees (airplane's uint8 `-V11 - V12`, shooting_stars' cond, space_flight's `V12 >= 0x3E`), all verified by the gate. Lockstep over the corpus takes ~100 s (37 x 3 oracle processes). Termination under random play recorded in manifest reference_quirks (cavern2+ die at step 2-3, deep at 49 every seed, 9 games never within 500). test_lockstep now runs the whole corpus; test_runtime expects 37 chip8_* games. |
| U07 cross-engine gate, runtime, benchmark | done | G6 `41 passed` (37 bundles x seeds 1,42 x 300 steps, V8+wasm vs qjs_host byte-identical incl. obs hash); G7 NativeVecEnv 4 env steps, obs 64x64x3, display in rows 16..47, colours black/green only; G9 table under Numbers; full suite `49 passed in 115s` | f0e6599 | `tests/test_engine_gate.py` sets PLAYTRAIN_QJS_ACTIONS per game from the sidecar and leaves PLAYTRAIN_ACTION_SPACE unset (GameEnv reads the sidecar's actions itself); PLAYTRAIN_GAMES_DIR must be absolute. `native/build/qjs_host` exists on this Mac (built 2026-09-18 17:38 on the vgdl branch), so the old 'native build broken locally' note is stale for qjs_host; qjs_vec is a dylib (`libqjs_vec.dylib`), no qjs_vec_host binary. G9: 8.4k-13.2k steps/s per QuickJS env vs PLAN's 60-120k expectation: profiled (V8 110k env-only; vgdl_aliens 17k on the same host; 64px canvas variant identical) -> QuickJS interpretation of the 44-instruction loop is the cost; PLAN section 6 corrected, section 9 Q5 asks whether the AOT tier is wanted. No engine change made. |
| U08 browser smoke | done | `PASS chip8_brix / chip8_tetris / chip8_blinky` (steps advance at 15/s, the game's first keypad key taken, canvas colours exactly 000000 + 00ff00, overlay from the sidecar, no console errors); pytest `3 passed` (browser + fresh + golden); skips as `playwright-core not resolvable` without PLAYWRIGHT_CORE_DIR | b219cf0 | playwright-core 1.58.2 lives in the scratchpad (`npm i playwright-core@1.58` in `<scratch>/pw`); its own browser revision (headless_shell-1208) is not installed, so run with `PLAYWRIGHT_CORE_DIR=<scratch>/pw PLAYWRIGHT_CHROMIUM=~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell` (1234 also works). The page template scopes the bundle's top-level consts, so `__chip8` now also exports keyNames/keyCodes (dist rebuilt, goldens unchanged). Screenshot (scratch `shots/chip8_brix.png`, inspected): two panels, 'PlayTrain rasterizer' 256x256 and the 64x64 agent-obs preview, both showing brix letterboxed in the middle band: four rows of green bricks with one gap, the paddle below, score '01' top right, four lives dots top left, pure green on black; header 'score: 1 | lives: 1 | GAMEOVER' (brix loses its life at ~step 20 with Q held); the parity label 'exact dynamics vs Octax (Radji 2025, arXiv 2510.01764) ... 3aa53b5 . 7 documented caveats' and the overlay 'Q (key 4) moves the paddle left, E (key 6) right.' |
| U09 report + docs | done | full suite `50 passed in 120s` with oracle + browser configured (G0-G8 in one run) | 67b1d8c (playtrain); playtrain-internal: `DSL ports design: CHIP-8 status log` | README.md written (what parity means, gate table, quirks, oracle recipe, speed, action space, adding a game). `playtrain-internal/docs/DSL_PORTS_DESIGN.md`: section 6 marked superseded (it planned a quirk-profile reference; Octax replaced it) and a 2026-09-19 status-log entry appended; that file was untracked in playtrain-internal and is now committed there on master. Memory note `chip8-loop.md` rewritten with the resume command and the facts that matter later. |
| U10 human handoff | done | | | For the human. Play three games in a real browser (`node tools/build-pages.mjs --games examples/games/multifile/parity/chip8/dist --out /tmp/pages`, open `/tmp/pages/game/chip8_brix/index.html`, also tetris and blinky; keys 1234/QWER/ASDF/ZXCV) and confirm they feel like the Octax GIFs at 15 steps/s. Decide PLAN section 9: (1) observation last frame vs Octax's 4-frame stack (`frame_stack=4`); (2) ship cavern4a/4b (unloadable through Octax's create_environment; would need an oracle path that bypasses it); (3) ROM redistribution: Octax's MIT covers its four modified builds, the rest carry hobbyist authorship in the module metadata; (4) throughput 8-13k steps/s per QuickJS env: enough, or try the AOT tier?  Human answered 2026-09-19: last frame default; ship cavern4a/4b; keep ROMs + NOTICE; measure AOT only. -> U11-U14. Browser play-feel check not reported. |
| U11 obs default docs | todo | | | |
| U12 cavern4a/4b | todo | | | oracle needs a `--module` path; create_environment cannot load these env_ids |
| U13 ROM NOTICE | todo | | | |
| U14 AOT measurement | todo | | | measure only; never change runtime/hosts/engine; blocked-with-reason is an acceptable outcome |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

G9, U07, this Mac (arm64, `benchmarks/bench_chip8.py`, qjs_host bench 20k steps; NativeVecEnv 20 env / 10 threads, 300 batched steps after 20 warm-up). V8 (node, env only, brix): 110,132 steps/s. vgdl_aliens on the same qjs_host: 17,054. The 20-env column drifts downward through the run (space_flight1 96k -> space_flight9 59k); treat +-30% as run-to-run noise on this laptop, not a per-game difference.

| game | 1 env / 1 thread (qjs_host bench) | 20 env / 10 thr (NativeVecEnv) |
|---|---|---|
| airplane | 12,547 | 114,447 |
| blinky | 11,798 | 99,390 |
| brix | 11,866 | 92,654 |
| cavern1 | 12,698 | 103,584 |
| cavern2 | 12,659 | 71,497 |
| cavern3 | 12,701 | 72,717 |
| cavern5 | 12,845 | 64,440 |
| cavern6 | 12,266 | 62,105 |
| deep | 11,835 | 94,095 |
| filter | 12,484 | 110,952 |
| flight_runner | 12,491 | 106,402 |
| missile | 13,154 | 112,385 |
| pong | 10,883 | 94,264 |
| rocket | 8,751 | 68,577 |
| shooting_stars | 12,021 | 89,015 |
| space_flight1 | 12,554 | 95,975 |
| space_flight10 | 9,623 | 58,227 |
| space_flight2 | 11,981 | 80,906 |
| space_flight3 | 11,470 | 70,691 |
| space_flight4 | 11,242 | 69,516 |
| space_flight5 | 10,893 | 66,047 |
| space_flight6 | 10,740 | 63,293 |
| space_flight7 | 10,350 | 60,670 |
| space_flight8 | 10,077 | 60,073 |
| space_flight9 | 9,741 | 58,746 |
| spacejam | 12,297 | 107,303 |
| squash | 12,717 | 111,078 |
| submarine | 8,938 | 77,406 |
| tank | 11,894 | 103,698 |
| target_shooter1 | 12,952 | 111,570 |
| target_shooter2 | 12,798 | 91,912 |
| target_shooter3 | 12,346 | 106,986 |
| tetris | 13,030 | 115,511 |
| ufo | 8,385 | 73,286 |
| vertical_brix | 12,484 | 109,299 |
| wipe_off | 11,919 | 107,309 |
| worm | 11,305 | 75,339 |

## Reference quirks found

(Anything Octax does that a CHIP-8 reference manual would not predict, with the ROM and step where it was seen.)

- Timers with `disable_delay=False` (16 of 22 games; `create_environment` default) underflow: `max(t-1, 0)` in uint8, 0 -> 255. Seen: tetris seed 3 sound 0 -> 255 -> 254 (steps 1-2), delay 0 -> 255 (step 4); cavern1 seed 2 sound 0 -> 255 (step 1). manifest.json reference_quirks.
- Every 8XYN writes VF (8XY0-3 and undefined N set 0; X == F: the flag wins). FX29 address is uint8 arithmetic. BXNN jumps to (NN + VX) & 0xFFF. Stack has no bounds check (17th push dropped, pointer 17; pop at 0 -> pointer -1, reads/zeroes stack[15]). fetch clamps reads, pc unmasked uint16. All probed live in U01 (alu.py, misc.py, control_flow.py, stack.py, emulator.py).
- Module `metadata.roms` sha1 does not match the shipped file for flight_runner, spacejam, worm; levelled games carry metadata for unrelated files. cavern4a/4b are not loadable via create_environment.
- Random brix play terminates at step 38 (V14 == 4 after the first lost life); lockstep gates must step past terminated (`--no-stop`) or stop at it consistently on both sides (decide in U04).

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | committed vgdl branch (306 files), branched chip8, committed harness | vgdl pytest 9 passed 3 skipped
2 | U01 | Octax cloned + venv, manifest.json (22 games, 39 ROM sha1s, 10 quirks), roms/, tests/oracle.py + conftest + G0 test; PLAN section 2 corrected (timers, VF, FX29, BXNN, stack, disable_delay default) | G0 2 passed
3 | U02 | src/10_threefry.js, src/20_cpu.js, exporter + 193 vectors, replay gate, conftest.run_js | G1 193/193
4 | U03 | common/threefry2x32.js, craftax 16_threefry.js slimmed + 3 manifests + 3 bundles, chip8 10_threefry.js on the shared core, export_randint.py + replay + test_threefry.py | G2 10000/10000
5 | U04 | src/30_env.js (env + c8Eval), games/brix|pong|tetris.json, tests/gate_oracle.mjs, test_lockstep.py | G3 9/9
6 | U05 | src/90_prelude.js, tools/bundle_chip8.mjs + bundle_all.mjs, dist/ (3 games + sidecars), tests/golden.mjs + golden.json, test_golden/test_bundle_fresh/test_runtime, manifest not_matched | G4 18/18, G5 fresh, pytest 10 passed
7 | U06 | 34 new games/*.json, custom startups in 30_env.js, 37 bundles + sidecars, 222 goldens, lockstep test over corpus, PLAN Q4 | G3 111/111
8 | U07 | tests/test_engine_gate.py, NativeVecEnv test in test_runtime.py, benchmarks/bench_chip8.py, PLAN section 6 corrected + Q5, Numbers table | G6 41 passed, G7 ok, G9 recorded
9 | U08 | tests/browser_smoke.mjs + test_browser.py, __chip8.keyNames/keyCodes, dist rebuilt, pages built + screenshots inspected | G8 3 PASS
10 | U09 | README.md, design-doc status log (playtrain-internal), memory note | 50 passed
11 | (none) | no todo/in-progress unit left; summary written, STATUS DONE | -

## Summary (2026-09-19, iteration 11)

Octax's 22 CHIP-8 games are PlayTrain catalog games on branch `chip8`: 37 bundles
(`chip8_<game>`, levels included) in `dist/`, each with a sidecar carrying its own
action space, 4500-step budget and the reference pin. Parity is full-state lockstep
against a live Octax (`riiswa/octax` @ 3aa53b5, jax 0.6.2): 111/111 trajectories over
37 bundles x 3 seeds x 500 steps, every register, the stack, both timers, the keypad,
the display hash, the rng key, score, reward, terminated and truncated, every step,
past termination. Upstream of that: 193/193 opcode vectors recorded from Octax's own
test-suite and 10,000 keys of threefry `split`/`randint`. Downstream: 222 goldens
(6 seeds, checked without Python), dist freshness, 37/37 V8-vs-QuickJS byte-identical
with observation hashes, runtime discovery + NativeVecEnv stepping, and headless-
Chromium play of three games. `uv run --no-sync python -m pytest
examples/games/multifile/parity/chip8/tests -q` = 50 passed with the oracle and
browser configured (they skip, and only skip, without).

What the reference turned out to be (all reproduced, none fixed; manifest
`reference_quirks`): 16 of 22 games run with timers that underflow 0 -> 255 every
step because `create_environment` defaults `disable_delay=False` and the decrement
is uint8; every 8XYN writes VF; FX29 is uint8 arithmetic; BNNN jumps to
`(NN + VX) & 0xFFF`; the stack has no bounds check; three ROM sha1s in Octax's
metadata are wrong; cavern4a/4b cannot be loaded through Octax's API. PLAN sections
2 and 6 were corrected from the live reference (U01, U07).

Speed: 8.4k-13.2k steps/s per QuickJS env, 58k-116k on 20 envs / 10 threads, V8
110k env-only. The cost is QuickJS interpreting 44 instructions per step, not
rendering. No compiler was built (PLAN section 6 rule); the AOT question is the
human's (section 9 Q5).

Side effects outside the family: `examples/games/multifile/common/threefry2x32.js`
(shared threefry core; craftax's `16_threefry.js` slimmed, three craftax-family
manifests + bundles rebuilt, their tests green), `benchmarks/bench_chip8.py`, the
vgdl branch committed as `0f341a0`, and `playtrain-internal/docs/DSL_PORTS_DESIGN.md`
committed on master with a status-log entry.

Left for the human (U10, PLAN section 9): observation stack default, cavern4a/4b,
ROM redistribution, AOT tier. Nothing in the port blocks on them.
12 | (human) | decisions on Q1-Q5 recorded; U11-U14 added; STATUS RUNNING again | -
