# Progress ledger

Statuses: `todo`, `in-progress`, `done`, `blocked`, `handoff`. One row per task
from PLAN.md section 11, split into sub-tasks where a task has more than one gate.
The agent edits only the status, gate, commit, and notes columns. Add rows for
sub-tasks under the parent; never delete rows.

| # | Task | Where | Status | Gate result | Commit | Notes |
|---|---|---|---|---|---|---|
| 1a | Vendor `games/craftax_src/` at commit 6ffa5b1 with LICENSE and README | mac | done | `shasum -a 256 -c`: 6/6 OK; git-blob ids match the pinned tree | f8d38ed | 5 headers + LICENSE + README in `games/craftax_src/`. `craftax_parity.h` deliberately not vendored (PLAN 2 layout). PLAN.md corrected: upstream has no `pufferlib/` prefix. `craftax_classic.h` includes `raylib.h` and `pufferenv.h` only — so 2a needs a `raylib.h` stub; `ini.h` is not included by the Classic header. |
| 1b | `THIRD_PARTY_LICENSES.md` row; `multifile/README.md`; directory skeleton | mac | done | no pytest gate; skeleton matches PLAN 2 layout, TPL row + PufferLib section added | e605ff8 | Also wrote `parity/craftax_classic/README.md` with the empty **Reference quirks** table — quirks found later go there. Empty dirs hold `.gitkeep` files whose text says which task fills them; delete each when its task lands. |
| 2a | `cc_ref_driver.c`, stubs, `build.sh`; `layout`, `rng`, `world`, `run` modes | mac | done | `15 passed in 0.55s` (`tests/test_driver.py`) | f4360be | Canonical state = **6880 bytes**, packed LE, 47 fields; `cc_ref layout` prints the table and `common/parity.js` must reproduce it byte for byte. Driver exits non-zero if its `cc_step_no_reset` transcription ever disagrees with the real `puf_step`. `reference/build/` is gitignored — every C gate builds it first. Random-action episodes die in ~140 steps, so the corpus (3a) needs the scripted policies to reach late-game branches. |
| 2b | Same build on FASRC; 100-episode self-diff mac vs cluster | cluster | done | `19 passed in 5.74s` (`tests/test_selfdiff.py`) | a647941 | **arm64 Mac and x86_64 FASRC agree bit-for-bit** on all 100 episodes / 17705 steps, despite different `-march` and different per-arch V8 FMA settings — Craftax's `cosf` inputs never hit the 1 ULP arm/x86 divergence `native/build_qjs.sh` warns about. The `cosf`/`sinf` redirect had to move from `-D` on the command line into `cc_ref_driver.c`: glibc's `math.h` token-pastes `__DECL_SIMD_` onto the function name, so the command-line form dies inside `/usr/include/math.h` (Apple libc does not, so it only broke on FASRC). Cluster scratch tree: `/n/home06/truong/craftax_selfdiff` (the live tree was left untouched). Cluster `python3` is 3.6 — use `/usr/bin/python3.12`. |
| 3a | Corpus policies in Python against the driver; action files committed | mac | done | `25 passed in 6.64s` (`tests/test_corpus.py`) | 03c01de | 210 episodes / 48561 steps in `traces/corpus/`, manifest `traces/corpus.json`. Needed a new driver mode, `cc_ref serve` (one action in, one canonical dump out), so policies can decide from the C's own state. **Two gaps 3b must close:** (a) only **15/22** achievements reached — missing `collect_coal`, `collect_iron`, `collect_diamond`, `make_iron_pick`, `make_iron_sword`, `defeat_skeleton`, `eat_plant`; (b) **every** episode terminates by health, so neither the timeout nor the lava terminal branch is in the corpus. Lava is unreachable by construction (quirk 1); a timeout episode needs a survive-and-idle policy, which PLAN 4.3's table does not list — adding one is a PLAN change, so 3b should decide it. |
| 3b-i | Golden hash chains (`traces/golden/*.fnv`, `golden.json`) | mac | done | `31 passed in 7.49s` (`tests/test_golden.py`) | d170ae4 | 210 chains, 49061 steps, 13 bytes/step (state hash + reward bits + done). CI-checkable without a compiler; the C-present half replays every episode and reports the first diverging step. |
| 3b-ii | G3: every `ACH_*` fires, every action index appears, C game-function coverage 100% | mac | blocked | C game-function line coverage **96.43% (567/588)**; 18/22 achievements | | **Exact blocker below.** Do not write `tests/test_coverage.py` until the corpus closes it — a green gate over a corpus that misses these lines would be the gate lying. |
| 4a | `common/f32.js`, `rng_pcg32.js`, `u64bits.js`, `parity.js` | mac | done | `35 passed in 38.11s` (`tests/test_rng.py` = G0) | 025b350 | G0 green: 10^6 draws on one seed and 16 draws on each of 1000 seeds, all five columns (pcg, rf bits, ri4/8/64) identical to the C. 64-bit LCG is two uint32 words in 16-bit limbs, no BigInt. `cc_ref rng` now prints 5 columns, not 3. **Use `tests/jsrun.py`, never `node -e`** — under eval a top-level `const`/`class` is invisible to later snippets while `function` leaks, which is not how the concatenated bundle behaves. `parity.js` ships `ParityWriter` + `fnv1a64`; 4b wires it to the real state buffer and checks it against `cc_ref layout`. |
| 4b | `10_constants.js`, `20_state.js`; layout test vs `cc_ref layout` | mac | done | `40 passed in 38.15s` (`tests/test_layout.py`) | 627ae56 | JS dump = **6880 bytes**, field for field identical to `cc_ref layout` (name, offset, size, type, count). **Storage order is not dump order**: typed-array views need natural alignment and the packed dump puts a float32 at offset 6674, so the buffer groups fields 4-byte / 2-byte / 1-byte (6876 bytes) and `PARITY_ORDER` reorders on the way out. `PARITY_ORDER` is the table that must match the C — edit it, not the storage tables, when a field moves. The gate also writes a sentinel into each field in turn and checks the bytes land only in that field's span, which is what catches two same-width fields swapped. |
| 5 | `30_worldgen.js` | mac | done | `43 passed in 41.81s` (`tests/test_worldgen.py` = G1) | f622a58 | **G1 green on 1000 seeds, first run** — full canonical dump byte-identical, including the PCG state after worldgen (checked separately: the map can match while the two sides have consumed a different number of draws, and that would only surface deep in G2). Confirms the float32 discipline and the V8-ieee754 binding for `cosf`/`sinf` are right. Gate mutation-checked (perturbing the iron ore threshold to 0.0351 fails it). The RNG now runs **directly on `st.pcg`**, the parity buffer's own field — `pcgState()` returns a `Uint32Array(2)`, word 0 low, word 1 high, so the RNG state and the dump cannot drift apart. |
| 6a | `40_player.js` | mac | done | `45 passed in 44.21s` (`tests/test_player.py`) | e16ed91 | Byte-identical to the C on all 30 forager episodes, per step, including the PCG word pair. Needed a new driver mode **`cc_ref player`**, which runs only the first four calls of `puf_step` and dumps after each — it calls the reference's own functions, so it is a probe, not a second implementation. **Known hole, closes in 6b/6c:** no mob ever exists under this probe, so `getDamage` has no observable effect — a mutation of the stone-sword damage (3 -> 4) passes this gate. Mutations of the sapling probability and of the `is_near_block` neighbour table are both caught. |
| 6b | `50_mobs.js` | mac | done | `49 passed in 55.2s` (`tests/test_mobs.py`) | 6157ecb | Byte-identical to the C on **all 210 episodes** (PLAN asks for random + sticky; the other three cost little and are the only ones producing a skeleton). New driver mode `cc_ref mobs` = player probe + `update_mobs` + `spawn_mobs`. **Closes 6a's `getDamage` hole** — that mutation is now caught. **Two gaps this probe cannot reach, both for 6c:** (a) `light_level` stays 1.0 because the probe stops before the step recomputes it, so the `0.1*(1-light)^2` term in the zombie spawn chance is multiplied by zero and mutating the 0.1 passes; (b) **arrows never appear in the whole corpus** — an arrow needs a live skeleton at L1 distance 4-5 with cooldown expired, and the corpus has 7 skeleton mob-steps total. The arrow block is ported but unexercised; same root cause as the 3b-ii blocker. |
| 6c | `60_world_tick.js`, `70_step.js` | mac | done | `52 passed in 68.89s` (`tests/test_lockstep.py` = **G2**) | e4057c5 | **G2 GREEN: the parity claim holds.** Full canonical state, per-step reward compared as float32 bits, and the done flag, all identical to the C across **all 210 episodes / 49061 steps**. Closes 6b's light gap — `light_level` now varies and the `0.1*(1-light)^2` mutation is caught. Mutation-checked 6 ways; 5 caught, the 6th (`hunger > 25.0` -> `25.1`) is genuinely equivalent because hunger only ever holds half-integers. `test_lockstep.py` carries the suite's one documented skip (driver absent). The JS does **not** auto-reset — that is the single deliberate difference from `puf_step`, matching PLAN 3.4 and `cc_ref run`. `score`/`episodeLength` live outside the parity buffer so they cannot be serialized by accident. |
| 7a | `tools/bundle_multifile.py`, `just bundle`; bundle-fresh test | mac | done | `58 passed in 69.70s` (`tests/test_bundle_fresh.py`) | 57d39bf | Bundler + `just bundle <name>` / `bundle-all` / `bundle-check`. `dist/craftax_classic.js` (1582 lines) and the sidecar are committed. **`manifest.json` currently lists 12 sources — 8a must add `80_render.js`, `85_obs_symbolic.js`, `90_playtrain.js` to it**, or they will not ship. Staleness detection verified by touching a source. The gate also evaluates the bundle in node and checks it steps identically to the same sources loaded loose, because concatenation order is scope order and a mis-ordered manifest yields a byte-correct broken bundle. |
| 7b | Second games root + sidecar loading (PLAN 3.1, 3.2) in Python and node envs | mac | done | `69 passed in 70.38s` (`tests/test_runtime_sidecar.py`); repo suite `95 passed, 3 skipped` | 92eefe8 | `GameEnv('craftax_classic')` now reports `Discrete(17)` and `max_steps 10000`, both from the sidecar — PLAN task 7's done-when. Four edits: `_paths.multifile_dist_dirs()`, `game_search_roots`/`resolve_game_file`/`load_sidecar` in `runtime/env.py`, the same resolution + sidecar in `native_vec_env.py`, and sidecar defaults in `runtime/p5/game-env.mjs`. Catalog stays first in the search order so no existing name can be shadowed, and an explicit `games_dir=` still resolves to exactly that directory. `max_steps` in `PlayTrainEnv` and the node `GameEnv` is now `None`-defaulted (effective default still 2000, exported as `DEFAULT_MAX_STEPS`) so "caller said nothing" is distinguishable from "caller asked for 2000". **Scope note:** making the game discoverable turned `tests/test_smoke.py::test_every_bundled_game_boots` red, because a bundled game must boot. `src/90_playtrain.js` was therefore written in this task, not 8a — it is the PlayTrain contract only (setup/draw/resetGame/getGameState/input), and its `draw()` delegates to `renderGame()` if defined and otherwise paints a flat background. **8a still owns `80_render.js` and must define `renderGame(state)`**; it also still owns `85_obs_symbolic.js` and adding it to the manifest. |
| 8a | `80_render.js`, `90_playtrain.js` | mac | done | `76 passed in 69.43s` (`tests/test_render.py`); repo suite `95 passed, 3 skipped` | 0783c04 | `90_playtrain.js` landed in 7b; this task added `80_render.js` (`renderGame`) and put both in the manifest. PLAN 6 layout: 512 canvas, 56px tiles = exactly 7 obs px, 9x7 view + 2 HUD rows. **Bug found and fixed:** `90_playtrain.js` was calling `createCanvas(64, 64)`, so everything drew off-canvas except the first tile and the observation came back as 3 flat colours; it is 512 now and frames have ~24. Flat fills + one primitive glyph per block, a 3x5 segment font for inventory digits, no `text()` and no images, so the rasterizer path is the one the catalog already gates on. Night multiplies tile colour by `light_level`. A source-level test asserts the renderer never touches the RNG or writes state — a render that drew from the RNG would desync from the reference without failing any dynamics gate, since those never call `draw()`. **`85_obs_symbolic.js` is NOT written**; it belongs with the obs mode in task 13. |
| 8b | `tools/validate.py --game craftax_classic` with 17 actions | mac | blocked | 4/5 checks PASS; **REW FAILS**. `API ok, DET ok, OBS ok, REW FAIL, 12815 FPS` | | **The step wire packs `score` as int32, and this is the first game with a fractional score.** Needs a 5th runtime change, which PLAN 3 does not authorise — see the write-up below. |
| 9a | `gate_qjs.sh` + vectorised host with the sidecar action table | mac | done | `80 passed in 73.5s` (`tests/test_engines.py`) | 13a6e99 | **V8 and QuickJS are bit-exact: 3000 steps x 3 seeds, GATE PASS.** Reward, terminal, score, lives, state and the observation hash all match every step. The vectorised host steps with 17 actions and is deterministic. **Do NOT set `PLAYTRAIN_ACTION_SPACE` to the sidecar path** — the sidecar is a manifest, not a bare action array, and `resolveActionSpace` chokes on it (`this.actions.some is not a function`). It is unnecessary anyway: 7b makes the node `GameEnv` load the sidecar itself, and `qjs_host` takes the bare array via `PLAYTRAIN_QJS_ACTIONS`. Both sides pick the action as `(i*3+1) % table_size`, so a silent default8 fallback on either side shows up as divergence. Invocation: `PLAYTRAIN_GAMES_DIR=<dist> PLAYTRAIN_QJS_ACTIONS="$(jq -c .actions <dist>/craftax_classic.json)" ./gate_qjs.sh craftax_classic 3000`. |
| 9b | AOT tier + `gate_async.py` | cluster | blocked | not run: no engine-tier toolchain exists on either machine | | **Blocked on infrastructure, not on this port.** See the write-up below. |
| 10a | Study harness reads sidecar actions and pacing | mac | todo | | | |
| 10b | Human quickplay session, replay-verified | human | handoff | | | G6 |
| 11 | Website: third source dir, overlay, label | human | handoff | | | agent builds; human checks the page |
| 12 | Throughput bench on paper node; first PPO run | cluster | todo | | | after 9 |
| 13 | Symbolic obs mode (PLAN 3.6) | mac | todo | | | after 6c and 7b |

## Log

Newest first. One line per iteration: date, task, what happened.

- 2026-09-14 — 1a — vendored PufferLib @6ffa5b1 into `games/craftax_src/`, byte-identical (git blob ids checked against the commit tree); README records sha256 + upstream path per file; PLAN.md path corrected.
- 2026-09-14 — 1b — `multifile/README.md` (the tree's contract: bundle-step-only rule, what earns `parity/`, dist/bundler rules, "tools read manifests not directory names"); game README with provenance / exact / not-matched / gates / quirks; PufferLib row + section in `THIRD_PARTY_LICENSES.md`; skeleton dirs created.
- 2026-09-14 — 2a — driver + `stubs/{raylib,ini}.h` + `build.sh` + `v8_shim.cc`; four modes work; 5619 steps cross-checked against the real `puf_step` across 40 seeds. PLAN 4.2 corrected on three points (ini.h stub, v8libm not frozenmath, the transcription requirement) and 1.4's frozenmath path fixed.
- 2026-09-14 — 2b — built on FASRC (clang 21.1.8, x86_64); fixed the glibc math.h clash; `traces/selfdiff_{arm64,x86_64}.txt` committed and identical; gate also re-derives this machine's digest so a drifted local build cannot pass.
- 2026-09-14 — 3a — `ccstate.py` (layout-driven dump decoder + `Serve`), `policies.py` (5 policies), `build_corpus.py`; `cc_ref serve` added to the driver. Two reference quirks documented in README: lava never generates (0 cells in 500 seeds), and the sand band's upper bound is dead code.
- 2026-09-14 — 3b — forager rewritten as a monotonic phase machine (the old recompute-from-inventory version oscillated between wood and stone and died mid-swing); survival core corrected. Corpus regenerated: 15 -> 18 achievements. Golden chains built and gated. G3 coverage measured and blocked; see below.

## 3b-ii blocker: the 21 uncovered lines

*(Still open. 4a was taken next because the loop skips blocked tasks.)*

Measured with a `--coverage` build of the driver over all 210 corpus episodes
(`clang -O0 --coverage`, then `gcov -b`). Restricted to the game functions
(`craftax_classic.h` lines 236-1011, so excluding `puf_render` and `puf_log`):
**567/588 lines = 96.43%**. The whole header reads 79.45% of 730 lines, but the
difference is the render path, which G3 excludes.

Every uncovered line traces to one of four unreached achievements:

| Lines | Code | Needs |
|---|---|---|
| 508-509, 513-514 | `make_iron_pick`, `make_iron_sword` bodies in `do_crafting` | a table **and** furnace adjacent while holding wood, stone, iron and coal |
| 547-554 | attacking a skeleton in `do_action` | a skeleton adjacent; they only spawn on `BLK_PATH`, which only exists where stone has been mined |
| 582-586 | collecting diamond in `do_action` | an iron pickaxe, so it is downstream of the two above |
| 718-720 | skeleton despawn at `MOB_DESPAWN_DIST` | a skeleton spawned, then the player walking 14 away from it |

`puf_close` (line 1011) was also uncovered and is now called by the driver.

**Why the corpus does not get there.** Distance is not the constraint: from
spawn, tunnelling included, stone is ~20 cells away, coal ~30, iron ~30 and
diamond ~30 on every seed measured. The constraint is survival. The forager
reliably reaches stone tools (18/22 achievements, `make_stone_pick`,
`make_stone_sword`, `place_furnace`, `place_stone` all covered) but usually
dies between 200 and 900 steps, and only 1 seed in 20 reaches iron ore at all.
Deaths are combat, not starvation — zombies, three at a time at night, against
a 5-health-per-zombie / 2-damage-per-swing arithmetic.

**Tried and measured, so the next iteration does not repeat it:**

- Best-of-6 random restarts per world seed over all 30 forager seeds: union
  stays at **18/22**, best single episode 17. Variance is not the answer.
- Fleeing from zombies instead of fighting: worse. A zombie closes with
  p=0.75 per step, so it matches the player's speed and running only defers
  the fight with less health.
- Survival thresholds at 7 instead of 4: worse — the agent shuttles between
  water and cows and never prospects. At 4 it starves. 6 is the current value.
- Stockpiling 6 wood + 6 stone before the ore trip: worse (14/22); the
  stockpile consumes the lifespan.
- Walking back to an existing table+furnace instead of rebuilding: no change.

**What is most likely to work next.** The agent needs to survive the night
rather than out-fight it. Zombies spawn only on `BLK_GRASS` and `BLK_PATH`
(`try_spawn`, and note the `!need_grass && !need_path` branch still requires
one of the two), and `can_move_mob` refuses solid blocks — so a player sealed
inside mined stone is unreachable. A "burrow at dusk" behaviour (mine into a
stone mass, place stone behind, idle until `light_level` recovers) should turn
the 200-900 step lifespan into a full 10000-step episode, which would also
produce the first `timeout` terminal the corpus lacks. Skeleton coverage
follows for free, since burrowing creates the `BLK_PATH` they spawn on.

Second, smaller thing: **no episode reaches the step cap**, so the
`timestep >= MAX_TIMESTEPS` terminal is untested too. All 210 end by health.
PLAN 4.3's policy table has no survive-and-idle policy; adding one is a PLAN
change and should be decided explicitly, not slipped in.
- 2026-09-14 — 4a — four `common/` modules written and gated. FNV-1a 64 and the writer checked against Python; RNG checked against the C on 1_000_000 + 16000 draws.
- 2026-09-14 — 4b — constants mirrored from the header; state as one ArrayBuffer with typed views (Int8Array gives C's int8_t wrap for free, which the un-clamped health field needs); `getParityState` + layout gate green.
- 2026-09-14 — 5 — scalar no-FMA Perlin ported with F() after every op in the C's evaluation order; both reference quirks (dead sand bound, unreachable lava) reproduced as written with comments pointing at README.
- 2026-09-14 — 6a — `do_crafting`, `do_action`, `place_block`, `move_player` and helpers ported; the single `cr_rf` in `do_action`'s grass case (drawn whenever the facing block is grass, sapling or not) is in the right place, which the PCG-state check confirms.
- 2026-09-14 — 6b — mobs ported. The variable RNG cost is the delicate part: a zombie's tie-break draw only fires when row and column distance are equal, skeleton movement branches on range bands, and `try_spawn` takes up to 20 attempts at 2 draws each and stops at the first hit. The per-step PCG comparison is what makes that checkable.
- 2026-09-14 — 6c — world tick + step ported; G2 passes on the whole corpus first run. Still uncovered by any gate: the arrow block of `update_mobs` (no arrow occurs anywhere in the corpus) — that is the 3b-ii corpus gap, not a port gap.
- 2026-09-14 — 7a — bundler is plain concatenation with a banner carrying a sha256 of the sources; sidecar is the manifest minus `sources`, plus that hash.
- 2026-09-14 — 7b — runtime wiring done and the repo suite is green again. The smoke test catching an unbootable bundled game is the ordering lesson: dist/ becoming discoverable and the game booting have to land together.
- 2026-09-14 — 8a — renderer written and gated. Pixels are explicitly outside the parity claim (PufferLib's textures are a raylib viewer; Craftax's pixel env is a third, different image), so the gate checks determinism, state-tracking, obs-grid alignment and purity rather than exact bytes.

## 8b blocker: the step header packs score as an int32

`uv run python tools/validate.py --game craftax_classic`:

```
  1/5 API compliance ... PASS -- check_env passed
  2/5 Determinism ... PASS -- 200 steps deterministic (strict, seed=42)
  3/5 Observation sanity ... PASS -- shape=(64, 64, 3) range=[10,231] unique=48
  4/5 Reward / terminal ... FAIL -- step 219: reward -0.7000000476837158 != score delta -1
  5/5 Throughput ... PASS -- 12815 FPS (0.08 ms/step)
```

**Cause.** `runtime/p5/game-worker.mjs:30` writes the score into the 16-byte
step header as `h.writeInt32BE(info.score | 0, 8)`, and `runtime/env.py:137`
unpacks it with `struct.Struct(">fBBBBii")`. So `info["score"]` reaching Python
is **truncated to an integer**. `reward` is fine — it is a float32 in the same
header, computed in JS at full precision.

Craftax-Classic is the first game with a **fractional** score: the reward is
`(new achievements) + 0.1 * (health change)`, so a step can pay -0.2 or -0.7.
Watching it accumulate, `info["score"]` reads `0, 0, -1` across three steps
that each paid -0.2 and then -0.7. `check_reward_terminal` asserts
`reward == info["score"] - prev_score` exactly, so it fails at every step where
the running total crosses an integer.

**The game is not at fault.** Driving the bundle directly, bypassing the host
wire, `max |score - sum(reward)|` over 246 steps is **exactly 0**, and the final
score is 1.499999761581421 — which the int32 wire delivers as 1. G2 already
compares the game's own per-step reward against the C as float32 bits across
all 210 episodes, and that is green.

**Why this is not fixed here.** The fix is two lines —
`writeInt32BE` -> `writeFloatBE` in the worker, and `">fBBBBii"` ->
`">fBBBBfi"` in `env.py` — but that is a **fifth** runtime change, and PLAN 3
authorises exactly four. It also changes the type of `info["score"]` for every
existing game, which is a catalog-wide behavioural change that wants a decision,
not a quiet edit. Options, for whoever picks this up:

1. Widen the wire field to float32 (two lines, plus the same header in
   `native_vec_env` if it duplicates the layout). Cleanest, and arguably a bug
   fix: `| 0` silently discards precision the game meant to report.
2. Leave the wire alone and relax `check_reward_terminal` to compare against
   the score delta only when the score is integral. Weakens an existing check
   for every game, so worse.
3. Make the game report an integer score. Breaks PLAN 3.5, which requires
   `score` to equal PufferLib's `episode_return_accum` bit for bit.

Option 1 is the recommendation. Until it is decided, G5 cannot pass and 8b
stays blocked; the other four checks pass, and 12815 FPS single-env is a useful
number for task 12.
- 2026-09-14 — 9a — engine gate green on the Mac half of G4. The sidecar reaches both native hosts; the AOT half is 9b and needs the cluster toolchain.

## 9b blocker: there is no engine-tier toolchain to gate against

G4's AOT half needs a tier `.so` for this game, and `gate_async.py` needs at
least two arms (stock plus tier). Neither machine can produce one right now.

**Mac.** `aot_cache.toolchain()` returns `None`, so `resolve_lib` falls back to
the stock `native/build/libqjs_vec.dylib`. `toolchain()` requires all of
`native/aotfork/out/{qjsc, prelude.js, src/quickjs.i, picIT2u/libqjs_forkaot.a,
forkI24.profdata, libqjs_vec.forkIT2.so}`; that directory has never been built
here.

**FASRC** (`/n/home06/truong/node-gym-smoke/playtrain`, the only checkout
there):

- it is on `main` at `29e1e7f`, which **predates the engine-tier work entirely**
  — `native/aotfork/` does not exist in that tree at all;
- its working tree is dirty with unpushed local edits (a large set of deleted
  `examples/games/js/*.js`), and the standing note is not to disturb it;
- `native/build/` has only the stock `libqjs_vec.so` and `qjs_host`;
- `~/.cache/playtrain` is empty, so no tier was ever built for any game;
- clang 21.1.8 is available, so the compiler is not the obstacle.

Also worth stating plainly: **this branch has 34 unpushed commits**, so even a
clean cluster checkout has nothing to fetch yet.

**What would unblock it**, in order:

1. Push `release`, and get a clean checkout on FASRC that has
   `native/aotfork/` (do not reuse the dirty `node-gym-smoke` tree).
2. Build the native backend there (`native/build_qjs.sh && build_qjs_vec.sh`).
3. Build the engine-tier toolchain (`native/aotfork/build_fork.sh`). This is
   the PGO/AOT pipeline from the engine-tier project, not a step this port
   owns, and it is the expensive one.
4. Build the tier for this game: `PLAYTRAIN_AOT_SYNC=1` with
   `PLAYTRAIN_GAMES_DIR` pointed at the dist, then confirm `resolve_lib`
   returns a `tier*.so`.
5. `WE=<repo> GDIR=<dist> gate_async.py <steps> craftax_classic \
   stock=<...>/libqjs_vec.so tier=<...>/tier3.so`.

Nothing here is specific to Craftax-Classic — any game would hit the same wall.
The Mac half of G4 (9a) is green and is the part that actually exercises this
game's 17-action sidecar through the engine stack.
