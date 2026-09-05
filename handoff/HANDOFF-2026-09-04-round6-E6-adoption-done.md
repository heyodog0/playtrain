# HANDOFF 2026-09-04 (late night) — Round 6 E6: tier 2 banked, holdout run, compile-at-load built; merge + adv2 pending

**Read this first.** Continues `HANDOFF-2026-09-04-round6-E3-adoption.md` (the
decision and the four-step sequence, §0/§6 there). Every number has a job id;
every file is on branch `engine-tier` (local repo
`/Users/heyodogo2/code/lab/playtrain/playtrain`, `origin/engine-tier`, cluster
worktree `/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine`, all at
`fedd99c` or later). `origin/main` is still `f4a2db0`; engine-tier is a strict
descendant (0 commits behind), so the merge is a fast-forward. The tuning
worktree, the live tree, `libqjs_vec.adv.so` and `qjs_host.adv` were not written.
Full tables: `handoff/tuning_notes.md` § E6.2 / § E6.1 (before the round-6 summary table).

## 0. Status of the four steps

| step | state |
|---|---|
| 1. E6.2 tier-2 banked arm | **DONE.** futIT2u/adv **1.382** all-24 (1.438 PG16, 1.276 ALE8), panel C 1.501; tier 2 = 0.917 of tier 3; futIT2 reproduces the bank (1.506 vs 1.500). Gate 198/198, checksum 24/24. Jobs 44492183 (build+gate, holy8a24303) / 44492184 (bank, holy8a24307 exclusive). |
| 2. Holdout, 9 never-profiled games | **DONE.** tier2/adv **1.189**, tier3/adv **1.302**, tier3/tier2 **1.095** (matches the 24's 1.091). 9/9 built both tiers in 56–69 s each; checksum 9/9 exact. Job 44493447. The absolute gain is below the 24-game number — game mix, see §2. |
| 3. E6.1 compile-at-load | **DONE and rehearsed.** `src/playtrain/runtime/aot_cache.py`, hooked into the three env constructors; 5/5 tests on the cluster; rehearsal on coinrun: tier 2 in 25 s, tier 3 in 105 s, next process picks tier 3. |
| 4a. adv re-cut (adv2) | **RUNNING** as job 44498267 on holy8a28510 (`native/aotfork/adv_recut.sbatch`): recipe + gate adv vs adv2 vs V8 + checksum ng/adv/adv2 + null A/B 24×3. Log `logs/adv_recut_44498267.out`, results `out/adv2_44498267/`, artifacts `out/{libqjs_vec.adv2.so,qjs_host.adv2,libplaytrain_rasterizer.a.rustpgo_adv2,adv2.profdata}`. |
| 4b. merge engine-tier → main | **NOT DONE — needs Ryan.** The push was blocked by the session's permission policy. It is a fast-forward: `git push origin engine-tier:main` (then `git branch -f main origin/main` locally). Nothing on main changes behaviour without the toolchain dir (§3). |
| 4c. measurement cascade on 17402 | not started (Fig 4A absolutes, panel C, ladder, Tables 1(b)/7/8, paper wording). |

## 1. Numbers (all same-job, same-node, interleaved; ratios only)

Tier-2 bank (44492184, 16 workers × 128 × 5, 24 × 3, 216/216; panel C 144/144):

| | futIT2u/adv (tier 2) | futIT2/adv (tier 3) | tier2/tier3 |
|---|---|---|---|
| ProcGen16 geomean | 1.438 | 1.569 | 0.916 |
| ALE8 geomean | 1.276 | 1.388 | 0.919 |
| all-24 geomean | **1.382** | 1.506 | 0.917 |
| sum-of-medians ratio | 1.292 | 1.392 | |
| panel C single-core PG16 | 1.501 | 1.619 | 0.927 |

Per game tier 2 over adv: maze 2.14, miner 1.88, heist 1.84, caveflyer 1.83,
coinrun 1.79, breakout 1.77 … frostbite 1.06, climber 1.07. PGO increment
(tier3/tier2) 1.03–1.22 (heist 1.22, qbert 1.19, climber 1.18); leaper 0.97.

Holdout (44493447, 1 worker × 128 × 5, 3 reps): aim_trainer 1.137/1.185,
breakout.multi 1.883/2.096, downwell_fresh 1.131/1.270, flappy_bird
1.122/1.218, flappy_bird.dunk2 1.178/1.202, frostbite.jungle 1.045/1.105,
jump_king 1.086/1.283, qbert.v2 1.082/1.274, vvvvvv 1.211/1.292 (tier2/adv,
tier3/adv); geomean 1.189 / 1.302; tier3/tier2 1.095.

Paper projection (ratios; 17402 absolutes still needed): ProcGen16 aggregate
~3.0M for a never-profiled game (tier 2), ~3.35M with its profile (tier 3);
vs tuned EnvPool 1.414M → 2.1× / 2.37×.

## 2. What the holdout says and does not say

- **The PGO increment transfers**: 1.095 on the 9 vs 1.091 on the 24, same
  per-game range. Tier 3 built by the compile-at-load recipe (merge one game's
  30 s profraw into forkI24.profdata, rebuild engine PIC objects + unit) is
  worth what the all-24 profile was worth.
- **The absolute gain is lower** (1.19/1.30 vs 1.38/1.51) and this is outside
  the ~5% band the adoption handoff set. Reading: the 9 are a different mix.
  The three fast games (~1–1.3M steps/s at one worker) sit at 1.12–1.18 like
  the 24's fast host-bound games (bigfish 1.13, ninja 1.11, asteroids 1.10);
  qbert.v2 (2.4k steps/s!) and frostbite.jungle (25k) are rasterizer-bound and
  no engine tier can move them (1.05–1.08); breakout.multi tracks breakout.
  No game is slower on any tier. **Unproven**: the engine-share explanation
  (an E0-style profile of qbert.v2 / frostbite.jungle would settle it; not run).
- Paper sentence that is supported: a new game gets tier 2 immediately and
  tier 3 about a minute later, bit-exact, with the same PGO increment as the
  paper games; the gain scales with the game's engine share, 1.05–2.1×,
  geomean 1.19/1.30 on the nine held-out paper games.

## 3. Compile-at-load, as built (`src/playtrain/runtime/aot_cache.py`)

- `resolve_lib(game_path)` is called by `NativeVecEnv`, `AsyncNativeVecEnv`
  (None for a mixed pool → tier 1) and `PingPongVecEnv` when no `lib_path` is
  given. Explicit `lib_path` bypasses everything (all bench scripts unchanged).
- Ladder: **stock** `native/build/libqjs_vec.so` when the toolchain is absent
  (laptop, live tree — behaviour identical to before) or `PLAYTRAIN_AOT=off`;
  **tier 1** `libqjs_vec.forkIT2.so` at once; **tier 2/3** from
  `$PLAYTRAIN_AOT_CACHE/<key>/tier{2,3}.so` when present. Missing tiers are
  built by a detached child (`python -c "from playtrain.runtime.aot_cache
  import _main; _main()" game dir want`), log in `<key>/build.log`, lock
  `.building` holding the builder pid (stale if pid dead or > 1 h), `FAILED`
  marker with 1 h retry. `PLAYTRAIN_AOT=1|2|3` caps the tier;
  `PLAYTRAIN_AOT_SYNC=1` builds in-process (tests); `PLAYTRAIN_AOT_PROFILE_SECS`.
- Toolchain = a `build_fork.sh` output dir (`PLAYTRAIN_AOT_FORK_OUT`, default
  `native/aotfork/out`) with `qjsc`, `prelude.js`, `src/quickjs.i`,
  `picIT2u/libqjs_forkaot.a`, `forkI24.profdata`, `libqjs_vec.forkIT2.so`,
  plus `picIgen/` + `llvm-profdata` for tier 3, `libfrozenmath_pic.a`, clang.
  The builder makes a per-key overlay dir with symlinks to those and runs
  `build_fork.sh vec1` with `TAG=IT2u UNIT_NOPGO=1` (tier 2) / `TAG=Igen` →
  30 s vec run → `llvm-profdata merge` → `TAG=IT3` (tier 3); overlay removed
  after success. Nothing in `native/aotfork/out` is written.
- Key: sha256 of game bytes, qjsc, prelude, `aot_intr_list.h`,
  `qjs_vec_host_fork.cpp`, `p5.cpp/.hpp`, `build_fork.sh`, the engine archive,
  the profile, the rasterizer archive, clang version string.
- Cluster: `PLAYTRAIN_AOT_CACHE=/n/holylabs/gershman_lab/Users/rtruong/aot-cache`
  (has coinrun's `ddc3b91b5db43b8888c1/` from the rehearsal),
  `PLAYTRAIN_AOT_FORK_OUT=$WE/native/aotfork/out`. **Slurm caveat**: the
  builder lives in the job's cgroup and dies with the job; fine for a training
  job, not for a 6-second script (that is how the pid-stale lock was found).
- Tests `tests/test_aot_cache.py`: off → stock; no toolchain → stock; key
  changes with one byte; tier 1 for max-tier 1 / mixed pool; sync tier-2 build
  + 200-step checksum vs tier 1 + cache hit. Run on the cluster with
  `uv run --no-project --python $VENV/bin/python --with pytest python -m pytest tests/test_aot_cache.py`
  (that venv has no pytest).
- `build_fork.sh` gained `UNIT_NOPGO=1` (needs `TUNE=use`; strips only the
  `-fprofile-use=` flag from the two `game_aot.c` compiles; fails if the flag
  is not found).

## 4. adv provenance (verified tonight) and the re-cut

- `libqjs_vec.adv.so` b3709b39 / `qjs_host.adv` 46ea4999 were built by job
  43780730 on holy8a28510 from tuning commit **5a42f71** (2026-09-01 07:56).
  `ef74835` (11:51 the same day, on main as d46fcae) is **not** its ancestor —
  the comment in `analogen-jaxbench/adopt_build.sbatch` claiming the merged
  lineage is wrong; the handoff was right.
- `native/` in engine-tier vs 5a42f71 differs only by ef74835 (`p5.cpp`, the
  style-cache fix) and d336297 (`qjs_vec_host.cpp`, OFF-by-default draw
  counters: one predictable branch per p5 binding — measured as "advdc" in
  job 44381264) plus `native/aotfork/`.
- `adv_recut.sbatch` (job 44498267): plain-v3 rasterizer → C++ PGO gen build
  → 8-game × 30 s profile with `WT/pgo/_t2prof_driver.py` → tune build
  (`CPP_MODE=use VIS=1 RUST_MODE=use RUST_PROFDATA=WT/pgo/rust2.profdata`) →
  saved as `out/*.adv2*`; the tree's `native/build/{libqjs_vec.so,qjs_host}`
  and the plain rasterizer `.a` are backed up to `out/adv2_<job>/backup/` and
  restored (check the "restored stock artifacts" line: 0eb1b27b). Then gate
  (adv2 as `host_f0`, adv via `EXTRA_HOSTS`) on 33 × 3 — expect adv to fail
  one qbert seed and adv2 to pass —, checksum24 ng/adv/adv2 (adv2 should
  match ng, adv may differ on qbert), null A/B adv vs adv2 24 × 3 at 1 worker.
- Whether adv2 replaces adv as the paper baseline is Ryan's call. Engine-tier
  ratios vs adv2 = ratios vs adv × (adv/adv2 from the null A/B).

## 5. Gotchas added tonight

1. The engine tree's `examples/games/js` (33 games) is not the live tree's: `aim_trainer`
   is absent there and `flappy_bird` / `qbert.v2` differ. The AOT unit embeds the
   source FNV, so build and bench must use one dir (the holdout job died on this once).
2. Slurm reaps a detached builder with the job (§3). `Popen(start_new_session=True)`
   does not escape the cgroup.
3. `analogen-jaxbench/.venv` has no pytest; use the `uv run --with pytest` overlay (§3).
4. `squeue` through `fasrc` sometimes prints only the header while jobs are running;
   trust `sacct -j`.
5. `python -m playtrain.runtime.aot_cache` triggers runpy's double-import warning because
   `playtrain.runtime/__init__` imports it; the builder uses `python -c` instead.
6. The `e6_*` jobs read `libplaytrain_rasterizer.a.rustpgo_adv` from `out/`; the re-cut
   temporarily replaces the plain `.a` in `crates/` — do not run an instrumented build
   while `adv_recut` is in step 1–3.

## 6. Files (branch engine-tier, commits 4e0e8cc … fedd99c)

| file | what |
|---|---|
| `native/aotfork/build_fork.sh` | `UNIT_NOPGO=1` knob |
| `native/aotfork/e6_tier2_build.sbatch`, `e6_tier2_bank.sbatch` | tier-2 build+gate (non-exclusive) and banked arm (exclusive, `--dependency=afterok`) |
| `native/aotfork/e6_holdout.sbatch` | 9-game holdout, tier 2 + tier-3 rehearsal, checksum, A/B |
| `native/aotfork/adv_recut.sbatch` | §4 |
| `src/playtrain/runtime/aot_cache.py`, `native_vec_env.py` (3 call sites), `tests/test_aot_cache.py` | §3 |
| `handoff/tuning_notes.md` § E6.2 / E6.1 + summary rows; `HANDOFF-2026-09-04-engine-tier-L1.md` §4b table | numbers |

Cluster artifacts (`$WE/native/aotfork/out/`): `libqjs_vec.futIT2u_<g>.so` × 33
(24 + 9), `host_f1IT2u_<g>` × 33, `host_f0IT2u`, `libqjs_vec.forkIT2u.so`,
`libqjs_vec.futIgen_<9>.so`, `libqjs_vec.futIT3h_<g>_<g>.so` × 9, `hold_<g>.profdata`
× 9, `picIT2u/`, `picIT3h_<g>/`, result dirs `e6build_44492183/ e6bank_44492184/
e6hold_44493447/ adv2_44498267/`, logs `logs/{e6_tier2_build,e6_tier2_bank,e6_holdout,
aot_cache_test,aot_e2e,adv_recut}_*.out`.

## 7. Next actions, in order

1. Read `logs/adv_recut_44498267.out`: "restored stock artifacts … 0eb1b27b", gate
   lines (`  FAIL` only), `CHECKSUM`, the null A/B geomean. Add the result to
   `tuning_notes.md` (the summary row says "result not yet in these notes").
2. Ryan: merge (`git push origin engine-tier:main`), decide adv vs adv2.
3. 17402 confirm + cascade; paper wording (tier sentence from §2; "stock quickjs-ng").
4. Optional: E0 profile of qbert.v2 / frostbite.jungle to close the holdout gap
   explanation; E2 / field-IC per the round-6 plan.

## 8. Commands

```bash
fasrc 'cd /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine && git fetch -q origin engine-tier && git reset -q --hard origin/engine-tier && git log --oneline -1'
fasrc 'sacct -j 44498267 -n -o JobID,State,Elapsed | grep -v "\."; tail -40 /n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-engine/native/aotfork/logs/adv_recut_44498267.out'
# use the engine tier from Python on the cluster (no code change; explicit --lib-path still wins)
export PYTHONPATH=$WE/src PLAYTRAIN_AOT_FORK_OUT=$WE/native/aotfork/out PLAYTRAIN_AOT_CACHE=/n/holylabs/gershman_lab/Users/rtruong/aot-cache
# tests
uv run --no-project --python /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/.venv/bin/python --with pytest python -m pytest tests/test_aot_cache.py -v
```
