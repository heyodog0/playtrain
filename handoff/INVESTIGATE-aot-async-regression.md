# Investigation brief: the AOT fork host's async/group path is ~6x slower

**Status:** open, unassigned, not started. No fix has been attempted.
**Written:** 2026-09-05. Assumes you have no context from the session that found it.
**Repo:** `/Users/heyodogo2/code/lab/playtrain/playtrain`, branch `main`.

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
