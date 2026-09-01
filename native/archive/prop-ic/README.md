# prop-ic — per-site property inline caches for quickjs-ng 0.15.1 (DEAD, archived 2026-09-01)

`prop_ic_v0151.patch` applies to a pristine quickjs-ng v0.15.1 clone
(tag `v0.15.1`, fd0a021). It implements the classic interpreter IC:
`OP_get_field` / `OP_get_field2` / `OP_put_field` self-quicken into `*_ic`
variants on their first own plain-data hit; the fast path is one
shape-pointer compare + a sharded-generation check + a direct prop-array
load. Invalidation: 256 pointer-hash-bucketed generation counters bumped on
shape free (ABA), in-place resize, compaction, and delete-tombstone.
Includes `QJS_IC_STATS=1` diagnostics (sites/hits/misses/gen churn).

## Verdict: correct, and measurably SLOWER — do not revive without a new mechanism

- Semantics: 33 games x 3 seeds x 600-step traces byte-identical to the
  pristine engine (arm64).
- Hit rates after bucket sharding: 99.99%+ on all five profile games (the
  unsharded global generation lost to per-frame temp-shape churn: miner
  bumps ~22/step, and maze's hit rate was 3.4% before sharding).
- Performance at the vec operating point (128 envs x 5 threads, arm64;
  ratios vs pristine 0.15.1): breakout 0.88, plunder 0.92, bigfish 0.97,
  miner 0.98, maze 0.98 — geomean 0.945. The MORE property-bound the game,
  the WORSE the IC did.

Why (the finding that matters): quickjs's baseline `find_own_property` is
already a 1-2 probe hash walk over cache lines the surrounding code touches
anyway. A monomorphic IC hit cannot be shallower — it replaces those probes
with an IC-entry load + generation load, i.e. it ADDS two memory regions to
the working set and a dependent load, and its best case is parity. The
SIGPROF number that motivated this (find_own_property = 6-16% of the vec
workload, job 43422679) is irreducible frequency + data-cache cost, not
avoidable lookup overhead. This is consistent with quickjs-ng shipping and
then REMOVING its own inline cache upstream.

A front-cache variant ((shape,atom)->idx table inside find_own_property,
no bytecode changes) was measured first and was worse still (0.87-0.93 at
the vec point).

Consequence for future rounds: interpreter-time reduction on this engine
requires SPECIALIZATION tiers (CPython-3.11-style quickening of operand
types, AOT twins, or an engine swap), not lookup caching. See
handoff/tuning_notes.md ROUND 4.
