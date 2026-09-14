# Craftax-Classic (parity port)

A multi-file JavaScript port of Craftax-Classic that steps **bit-for-bit** like
PufferLib's C implementation, ships as one PlayTrain catalog file, trains on
pixels, and is playable by a human in the browser from that same file.

`PLAN.md` is the full design and the specification. `PROGRESS.md` is the task
ledger. This file is what you read to know what the port claims and how to
check it.

## Status

Under construction. See `PROGRESS.md` for what is built and what is not. Until
the lockstep gate (G2) is green over the whole corpus, the parity claim below
is a target, not a result.

## Provenance

| field | value |
|---|---|
| reference | PufferLib, `ocean/craftax_classic/craftax_classic.h` |
| commit | `6ffa5b10dbbbe4d1e8288367c7d9d3acd3bad4a2` |
| license | MIT |
| vendored at | `games/craftax_src/` (see its README for per-file sha256) |

PufferLib's Craftax-Classic is itself **not** JAX-exact: it has its own PCG RNG
and derives from `Infatoshi/craftax.c`. We match the C, not the JAX original,
and the paper says so.

## What is exact

Full canonical state, every step, over the committed corpus: RNG word pair,
map, per-row mob bitmaps, player position and facing, intrinsics, inventory,
every mob and plant slot, light level, achievements, timestep. Integers are
compared bit-for-bit with no tolerance; floats are compared as bits.

The parity target is precisely *"PufferLib Craftax-Classic with the
transcendental functions bound to V8's `ieee754`"*. `cosf`/`sinf` are the one
libm-dependent thing in the C, so the reference driver is built with them
redirected to `native/frozenmath`'s V8 `ieee754`, which is the same code every
PlayTrain engine already links for `Math.*`. The driver is also built
`-ffp-contract=off` and without AVX-512, pinning the scalar no-FMA Perlin path.
Integer logic and the RNG are untouched by any of this.

## What is not matched

- **Pixels.** PufferLib's textures are a raylib viewer; training there is
  symbolic. We render in house style. Craftax-Classic-Pixels (JAX) is a
  different observation again, and our comparison row says so.
- **Auto-reset RNG continuation.** PufferLib does not reset the PCG stream
  between episodes; `resetGame(seed)` does.

## Gates

| gate | test | needs |
|---|---|---|
| G0 | `tests/test_rng.py` | — |
| G1 | `tests/test_worldgen.py` | C driver |
| G2 | `tests/test_lockstep.py` | C driver |
| G2 (CI) | `tests/test_golden.py` | committed hashes only |
| G3 | `tests/test_coverage.py` | C driver |
| bundle | `tests/test_bundle_fresh.py` | — |

```sh
uv run pytest examples/games/multifile/parity/craftax_classic/tests -q
```

`test_lockstep.py` skips — and this is the only permitted skip — when the C
driver has not been built. Build it with `reference/build.sh`.

## Reference quirks

Behaviour in the C that looks like a bug. The port **reproduces each one
faithfully and does not fix it**; parity is the whole point. Nothing is listed
here until it has been confirmed against the vendored header.

| # | Quirk | Where | How we mirror it |
|---|---|---|---|
| — | none recorded yet | | |
