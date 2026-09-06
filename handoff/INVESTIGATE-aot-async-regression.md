# Investigation brief: the AOT fork host's async/group path is ~6x slower

**Status:** RESOLVED 2026-09-05 (same day). Mechanism demonstrated, fix landed in
both hosts, async gate added and wired into the adoption jobs. See §0.
**Written:** 2026-09-05. §1-§10 are the original brief, kept verbatim as the record
of what was known before the investigation; several of its guesses were wrong
(see §0.5). Assumes you have no context from the session that found it.
**Repo:** `/Users/heyodogo2/code/lab/playtrain/playtrain`, branch `main`.

---

## 0. Resolution

### 0.1 The mechanism: glibc malloc arena contention from cross-thread frees

The async host let **any worker step any env** (one shared MPMC work queue), while
the sync host pins each env to the thread that created it (`run_shard`). Every
frame frees what the previous frame allocated — the rasterizer's per-path
`Vec<Point>`s (`rs_begin_path` -> `_int_free`, `rs_ellipse_path` ->
`RawVec::grow_one` -> `realloc`) and the engine's property arrays
(`resize_properties` -> `realloc`). In async mode the previous frame ran on a
*different* thread, so the chunk lives in *that* thread's glibc arena, and freeing
or reallocating it takes that arena's mutex. With 5+ workers all doing this
thousands of times per frame the mutexes collide and the losers futex-sleep.

Evidence (all env-only, CPU, fruitbot, group 256, 5 threads, `~/pp_diag.py`):

| | adv2 | tier3 (shipped) |
|---|---|---|
| pingpong steps/s | 61,629 | 8,788 |
| voluntary ctx switches during the run | 243 | **2,807,531** |
| sys time | 0.1 s | **21.2 s** |
| window spread | 1.13x | 8.46x |
| output digest | 19bc7ce1b2aa0550 | 19bc7ce1b2aa0550 (identical work) |
| RSS | 210 MB | 163 MB (less, not more) |

`strace -f -k -e futex` on tier3: >95% of futex calls are
`__lll_lock_wait_private` / `__lll_unlock_wake_private` under `_int_free` or
`realloc`, reached from `rs_begin_path` / `rs_ellipse_path` (Rust rasterizer)
inside `aot16_draw` -> `env_step` -> `worker_async`. gdb thread samples: 16 of 30
worker samples inside `__lll_lock_wait_private`. Thread sweep: at **1 thread
tier3 is 1.39x faster than adv2** in pingpong (16,992 vs 12,239); the collapse
begins at 2 threads and deepens with more (sys time 0.6 -> 6.3 -> 23.5 -> 60.2 s
for 2/5/12/23 threads). Job logs: `analogen-jaxbench/logs/aot_async_diag_44740058.out`,
`aot_async_strace_44740974.out`.

Why adv2 (quickjs-ng) escaped: same host code, same rasterizer source, same
allocation pattern. It sits below the contention threshold — the Bellard-lineage
fork engine is faster per step and issues more `realloc`s per frame
(`resize_properties`), which is enough to tip the arena mutexes from mostly
uncontended into a convoy. That is a threshold effect, not immunity: under
`strace` adv2 also showed 28k voluntary switches. The stock host had the same
latent bug and got the same fix.

### 0.2 The fix (both hosts: `native/qjs/qjs_vec_host.cpp`, `native/aotfork/qjs_vec_host_fork.cpp`)

Env `i` is owned by worker `i % T` for its whole life:
- one input queue per worker (`inq[t]`); `vec_send` routes id -> `inq[id % T]`;
- `env_init` runs on the owner (workers init their envs at spawn; `make_async`
  waits on `async_init_left`);
- `vec_async_reset` runs on the owner too (reset token `~i` on `inq[i % T]`;
  caller waits on `async_resets_left`) — the reset allocates the episode's whole
  game state.

There is deliberately **no work stealing**. A variant with owner-first stealing
was built and measured (job `aot_async_fix4_44744698`, `futIT2fix3_*`): on the
fork host it brought the contention straight back — fruitbot pingpong t5 26,644
with 647k context switches vs 74,822 pinned-only — because every stolen step
plants that frame's persistent objects in the thief's arena, so the env's heap
smears across arenas over time and the frees never stop crossing. Heap locality
has to be an invariant, not a preference. Interleaved ownership (`i % T`, not
contiguous shards) keeps a contiguous ping-pong group spread evenly across
workers. Public C ABI unchanged.

Measured, same protocol (fruitbot / bigfish, env steps/s, `~/pp_diag.py`, which
is Python-driver-bound near ~78k so ties at 78k are the driver, not the host):

| arm | fruitbot pp t5 | pp t12 | bigfish pp t5 | ctx switches (fruitbot t5) |
|---|---|---|---|---|
| adv2 (shipped stock) | 61,629 | 78,007 | 77,386 | 243 |
| tier3 (shipped AOT) | 8,788 | 8,317 | 56,697 | 2,807,531 |
| tier3 pinned, init+reset still on caller | 48,457 | 42,299 | 60,328 | 127,371 |
| **tier3 pinned, init+reset on owner** | **73,795** | **78,282** | **77,877** | **1** |
| adv2 pinned (ng host rebuilt) | 63,861 | 77,474 | 77,504 | 0 |

`gate_async.py` (less driver overhead than pp_diag): fruitbot pingpong adv2 60,068
-> tier3fix 84,508 (**1.41x**); bigfish 248,524 -> 268,066 (**1.08x**). Sync path
unchanged (tier3 50k vs adv2 44k fruitbot, as before). Output digests identical
across adv2 / tier3 / fixed, and across sync vs pingpong. Jobs:
`aot_async_fix_44741849`, `aot_async_fix2_44742646`, `aot_async_fix3_44743754`,
`aot_async_fix4_44744698` (final code, 24 games, in `analogen-jaxbench/logs/`).

macOS caveat (Apple M-series, 4 threads, group 64): pinning costs 0.58-0.84x of
the original in pingpong there — macOS malloc has no per-thread arenas so there is
no upside, and static shards suffer when the OS schedules a worker onto an E-core.
Digests are identical. Training runs on Linux; on Linux the pinned ng host is at or
above the original at every measured point (63,861-65,635 vs 61,255-61,629 fruitbot
t5; ties at the driver ceiling elsewhere). If macOS ping-pong throughput ever
matters, the fix is a per-runtime allocator (JSMallocFunctions) so ownership can
move without the heap following, not stealing.

All 24 paper games, `gate_async.py` 300 steps x 512 envs, group 256, 5 threads
(job `aot_async_fix3_44743754`, CPU node holy8a24307). pp = pingpong env steps/s;
ratio = pp / adv2's pp. Digests: every arm equal to adv2's sync digest on every game.

| game | adv2 pp | tier3 shipped (ratio) | tier3 fixed (ratio) |
|---|---|---|---|
| fruitbot | 61,075 | 8,188 (**0.13**) | 88,022 (1.44) |
| bigfish | 258,221 | 63,531 (**0.25**) | 534,965 (2.07) |
| asteroids | 218,106 | 61,123 (**0.28**) | 348,598 (1.60) |
| frostbite | 233,829 | 84,709 (**0.36**) | 315,518 (1.35) |
| miner | 48,815 | 27,132 (**0.56**) | 102,541 (2.10) |
| dodgeball | 94,858 | 56,596 (**0.60**) | 151,197 (1.59) |
| space_invaders | 193,764 | 155,912 (0.80) | 355,773 (1.84) |
| qbert | 57,661 | 52,834 (0.92) | 92,796 (1.61) |
| ninja | 350,215 | 331,791 (0.95) | 553,790 (1.58) |
| other 15 games | | 1.08 - 2.04 | 1.34 - 2.33 |

Shipped tier3 fails the 0.8 floor on 6 of 24 and is below the fixed build on all 24.
Fixed tier3 is faster than adv2 in pingpong on every game (min 1.34x, climber).
Correction to §2 fact 4 below: the regression was not "~6x on all 24 games" —
its size depends on how allocation-heavy the game's frame is; several games were
slightly *ahead* of adv2 even when broken. The masking argument still holds for
the six that regressed.

### 0.3 The gate: `native/aotfork/gate_async.py`

Drives `PingPongVecEnv` (vec_create_async + vec_set_group_mode + worker_async)
and `NativeVecEnv` with the same seeds and per-env action stream; every
obs/rew/term/trunc byte is hashed. For each lib: pingpong digest and sync digest
must equal the reference lib's sync digest; pingpong steps/s must be >= 0.8x the
reference lib's pingpong rate and >= 0.6x the lib's own sync rate. The shipped
tier3 reads 0.12 / 0.15 on those ratios and fails; healthy libs read ~1.2-1.4.
Wired in as step 2c of `e6_tier2_build.sbatch` (hard fail), 3b of
`e3_tune24.sbatch` and 2b of `adv_recut.sbatch`. Usage:

```
QJS_DIRTY=1 WE=$WE GDIR=$GDIR python gate_async.py 300 <games csv> ref=/path.so cand=/path_{game}.so
```

### 0.4 What is left

**ALL THREE DONE 2026-09-06.** 1 and 3: job 44749004 (`$WE/native/aotfork/
e3_recut_fix.sbatch`) rebuilt the stock `.so` and re-cut all 24 `futIT2_*` from
the fixed sources, reusing `forkI24.profdata`; checksum 24/24 and `gate_async`
24/24 pass. 2: Table 1(a) re-measured under the fixed tier 3 (jobs 44748571 /
44748573 / 44748574 / 44748575 plus node re-runs 44784183 / 44786418 / 44784184 /
44784185) — every row at or above adv2, so the interpreter workaround and its
disclosure sentence are retired. Numbers and caveats in `NUMBERS-2026-09-05.md`.
The original list, for the record:

1. **Rebuild the adopted tier binaries from the fixed host source** (`e3_tune24.sbatch`
   / `e6_tier2_build.sbatch` produce `out/libqjs_vec.futIT2*_<game>.so`; compile-at-load
   in `aot_cache.py` builds from the source tree, so it picks the fix up on its own).
   Round 3 left libs built from exactly the committed code at
   `out/libqjs_vec.futIT2fix2_<game>.so` for all 24 paper games (tier-3 flags). Ignore
   `futIT2fix3_*` (the rejected stealing variant, 16 of 24 built). When building a
   fresh TAG, build one game serially before the `xargs -P` fan-out: parallel `vec1`
   calls race on the `pic$TAG` engine archive (8/24 failed in round 4 that way).
2. **Re-measure Table 1(a)** (`analogen-jaxbench/tier3_table1a.sbatch`, kempner_h100)
   with the fixed tier3 and swap the numbers in `NUMBERS-2026-09-05.md`. Expect the
   19 "healthy" games to move too — they were masked by the learner cap (§2 fact 4).
3. Rebuild `native/build/libqjs_vec.so` (stock) from the fixed source; it had the
   same latent bug.

### 0.5 What the brief got wrong, for calibration

- "Fits scheduling pressure better than memory" — half right: it was lock
  convoys, not spin-barrier oversubscription and not RSS (tier3 uses *less* memory).
- "Diff the two hosts' async regions first" — the async regions are byte-identical;
  every diff hunk is AOT loading and intrinsics. The variable was the engine
  lineage (quickjs-ng vs Bellard fork) shifting a threshold, not host code.
- `MALLOC_ARENA_MAX` (job 44645920, result unread at the time) made it *worse*
  (139k / 166k vs 278k): fewer arenas = more contention. Consistent with §0.1.
- The `default_threads()` 70x incident was a red herring here.
- `prof_preload.so` under Python yields 1 sample (the interpreter/ctypes path
  resets ITIMER_PROF or the handler); `strace -f -k -e futex` and `gdb -p`
  thread sampling both work on FASRC and were what named the mechanism.

---

## 1. The one-paragraph version

PlayTrain has two builds of its vectorized environment host. The interpreter
build (`adv2`) runs game JavaScript through QuickJS. The AOT build (`tier2`,
`tier3`) compiles each game's JS to C, links it into a per-game `.so`, and is
**1.19-1.43x faster** — but that `.so` also ships **its own copy of the host**,
and that copy's *asynchronous / double-buffered* path is **~6x slower** than the
interpreter's on all 24 games. The synchronous path in the same file is fine.
Double-buffering is the recommended training configuration and the AOT binary is
selected **by default**, so anyone training on `main` today silently gets ~6x
slower environments. Find out why, and fix it.

## 2. What is definitely true (measured, don't re-derive)

Env-only, no trainer, no GPU, `PingPongVecEnv` (= double-buffered), env steps/s:

| game | mode | adv2 | tier2 | tier3 | tier3/adv2 |
|---|---|---|---|---|---|
| fruitbot | sync | 102,923 | 132,027 | 146,992 | **1.428** |
| fruitbot | **pingpong** | 61,265 | 9,865 | **8,735** | **0.143** |
| bigfish | sync | 673,618 | 764,802 | 799,294 | **1.187** |
| bigfish | **pingpong** | 362,562 | 63,815 | **61,198** | **0.169** |

Five facts these establish:

1. **AOT compilation is not the problem.** Sync is faster with AOT, on both games.
2. **The trainer is not the problem.** Reproduces with no learner attached.
3. **The fault is upstream of AOT compilation.** `tier2` (engine PGO, *unprofiled*
   game unit) and `tier3` (fully profiled) regress *identically* — 0.308 vs 0.300
   under the trainer, 0.161 vs 0.143 env-only. If the compiled game were at
   fault, these would differ. They don't, because they share the host.
4. **It affects all 24 games, not two.** Table 1(a) appeared to show only fruitbot
   and climber regressing because the learner caps throughput at ~1.05M
   agent-steps/s: bigfish's degraded env rate still clears the cap (61,198 x 15
   workers ~ 918k) while fruitbot's doesn't (~131k). The 19 "healthy" games at
   0.95-1.04 are **masked, not fine**.
5. **It is intermittent stalling, not a steady slowdown.** Per-window rates within
   one run: adv2 fruitbot 868k/844k/852k/870k (1.03x spread); tier3 fruitbot
   151k/256k/328k/256k (**2.17x spread**). Something periodically blocks and
   recovers. Any explanation must account for the variance, not just the mean.

Also measured:
- Worker count is **not** the variable: 15 -> 12 workers (20% fewer env instances)
  changes nothing (0.351 -> 0.303, marginally worse). Turning double-buffering
  **off** fixes it completely at either worker count.
- Per-worker RSS under tier3 at w15/db1 is ~10.7-11.1 GB (~160 GB/node). No adv2
  comparison was captured — suite logs are overwritten per run. **Getting that
  comparison is cheap and still worth doing.**
- THP is already `[always]` on these nodes, so huge pages are not the missing piece.

## 3. Already excluded — do not spend time here

- **A plain missed wakeup in `vec_send`.** It bumps `send_gen` then calls
  `wake_parked`, which takes `park_mu` (empty critical section) and
  `notify_all`s. The waiter does `parked++` under the same mutex *then* rechecks
  the predicate, so a wake cannot slip between check and sleep. Inspected, looks
  correct. (It could still be wrong in a subtler way — but the obvious version is
  ruled out.)
- **PGO / profile quality.** See fact 3 above.
- **Total memory / instance count.** See the w12 result.
- **The trainer, DDP, MPS, the learner queue.** Reproduces env-only.
- **Huge pages.** Already enabled.

## 4. Where the code is

| what | path |
|---|---|
| **The suspect** | `playtrain-wt-engine/native/aotfork/qjs_vec_host_fork.cpp` (1,192 lines) |
| **The working reference** | `playtrain/native/qjs/qjs_vec_host.cpp` (959 lines) |
| Python side | `playtrain/src/playtrain/runtime/native_vec_env.py` |
| Tier resolver | `playtrain/src/playtrain/runtime/aot_cache.py` |
| AOT build | `playtrain-wt-engine/native/aotfork/build_fork.sh` |

Both files implement the same design: a `VecHost` with a spin-then-park worker
model, a `group_mode` flag, `worker_loop` (sync) and `worker_async` (async), and
identical park constants (`kParkCheckSpins = 4096`, `kParkAfter = 5 ms`).

Symbols that matter, fork host line numbers:
- `worker_loop` ~758 — the SYNC path. Works.
- `worker_async` ~810-838 — the ASYNC path. Suspect.
- `park_due` ~748, `wake_parked` ~787 — spin/park handshake.
- `group_mode` declared ~507, used ~831 (release-store to `busy[env]`) and
  ~1152 (`busy[id]` set on send); `vec_set_group_mode` ~1161.
- `dispatch` ~797 — per-step spin barrier, sync path only.
- `default_threads()` ~290-302 — **read this comment.** It records an earlier
  incident where an oversubscribed spin barrier collapsed throughput **~70x**
  (1.4k vs 104k decisions/s, job 30281357). This host has prior form for
  catastrophic rather than graceful degradation under scheduling pressure, which
  fits the 2.17x window variance better than any memory-pressure story.

**Highest-value first move: diff the two hosts' async regions.** They are a
modified copy of a common ancestor and the fork host is 233 lines longer. The
delta in `worker_async` / `group_mode` / `vec_send` / thread-count computation is
where the bug almost certainly lives. Nobody has done this diff yet.

## 5. Reproduction — 9 seconds, CPU only, no queue

`~/pp_driver.py` on the cluster. One fruitbot pingpong tier3 run takes **8.8 s** on
any CPU node. No GPU, no trainer, no Slurm wait. This is a real debug loop —
bisect against it freely.

Cluster access from a laptop: `/bin/zsh -ic 'fasrc "<cmd>"'`. Never plain ssh. A
silent 20-60 s first call is re-auth; wait it out. On auth failure wait 30 s,
retry once, then stop.

Binaries:
- adv2 (good): `playtrain-wt-tuning/native/build/variants/libqjs_vec.adv.so`,
  md5 `1c5149364c32fb58ce9b81cda49fa763`
- tier2: `playtrain-wt-engine/native/aotfork/out/libqjs_vec.futIT2u_<game>.so`
- tier3: `playtrain-wt-engine/native/aotfork/out/libqjs_vec.futIT2_<game>.so`

**Never read `$WT/native/build/libqjs_vec.so` as an identity** — running jobs
mutate it. Copy the binary you mean into a job-private `$TMPDIR` tree and md5-gate
before measuring; the pattern is in
`analogen-jaxbench/icnn_suite24_adv_array.sbatch` (search `ADVTREE`).

Python-side selection: `NativeVecEnv`/`PingPongVecEnv` accept an explicit
`lib_path`, which bypasses the tier resolver entirely. `PLAYTRAIN_AOT=off` forces
stock. Both are useful for A/B.

## 6. Hypotheses worth testing, ranked

1. **A divergence between the two hosts' async implementations.** Start here; it is
   the cheapest and most likely. Diff, then bisect by porting the fork host's
   async region back toward the original.
2. **Thread oversubscription specific to the AOT build.** If the AOT `.so` computes
   a different thread count, or spawns threads the interpreter doesn't, the spin
   barrier collapses — see the `default_threads()` prior art. Check `nthreads` and
   actual live thread count under both binaries at identical config.
3. **Working-set / I-cache pressure from alternating two large AOT code images.**
   Double-buffering alternates between two env groups; a compiled game unit is a
   much larger code image than the shared interpreter. This fits "sync fine, async
   broken" and "instance count irrelevant". Test with perf counters if available
   (note: FASRC has **no** perf/gperftools — the working profiler is an LD_PRELOAD
   SIGPROF sampler at `playtrain-trainers/benchmarks/prof_preload.{c,so}` with
   `prof_symbolize.py`).
4. **Allocator behaviour under 2x instances.** Ranked low after the w12 null.
   mimalloc/jemalloc/tcmalloc are **not installed** and there is no reliable
   egress; glibc is 2.28 so `glibc.malloc.hugetlb` is unavailable.
   `MALLOC_ARENA_MAX` is the only lever and a probe was queued but its result was
   never read — check job 44645920's output before re-running it.

## 7. Definition of done

1. The mechanism is named and demonstrated, not guessed.
2. Either the fork host's async path matches the interpreter's throughput (then
   Table 1(a) can be re-measured with tier3 and the numbers swapped in — see
   `NUMBERS-2026-09-05.md`), **or** the tier resolver is changed so the async /
   group path never receives an AOT binary.
3. `gate_qjs.sh --all` still passes, and a **new** gate exercises the async path —
   see §8.

## 8. The process failure that let this ship, and what to fix

Every gate the tier adoption passed — checksum 24/24, differential gate 198/198,
the 9-game holdout, all of Figure 4A — exercised **only** `vec_create` and the
sync worker loop. `worker_async` was **never executed by any test**. That is why a
6x regression reached the paper's headline table unnoticed.

Whatever the fix turns out to be, the durable repair is a gate that runs the
async/group path. `~/pp_driver.py` is 9 seconds and already exists; wiring it into
`gate_fork.sh` costs almost nothing and closes the hole permanently. Do this even
if the performance bug turns out to be trivial.

## 9. Related reading, in order

1. `handoff/NUMBERS-2026-09-05.md` — canonical results; §"Which binary produced
   what" explains the adv2/tier3 split the paper now depends on.
2. `handoff/HANDOFF-2026-09-05-tier-cascade.md` §0 — the discovery narrative,
   self-contained. §0.4 localisation, §0.6 why it looked like a two-game problem.
   (The rest of that file is a 1,500-line chronological journal containing
   superseded numbers — read §0 and stop.)
3. `handoff/HANDOFF-2026-09-04-round6-E6-adoption-done.md` — how the tiers were
   built and adopted; §3 documents compile-at-load and the resolver.
4. `handoff/tuning_notes.md` §E6.1/§E6.2 — the tier construction detail.

## 10. Caveat on one negative result

A plain `--mode async` (`AsyncNativeVecEnv`, not ping-pong) arm was attempted and
**timed out on every binary including adv2**, which points at the driver rather
than the host. Two bugs were found and fixed in it (`send(ids, actions)` argument
order; `recv()` returning ids first) and it still stalled, so something else is
wrong in how it drives that class. **Do not read those blanks as evidence that
adv2's async path is broken.** `PingPongVecEnv` is driven correctly and is the
path the trainer actually uses. If you need the plain-async comparison, budget
time to fix the driver first.
