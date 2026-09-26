# `examples/games/multifile/` — games that need a bundle step

Most PlayTrain games are one file in `games/js/`. A few are too large for that:
a faithful port of an existing environment runs to thousands of lines and wants
real module boundaries so it can be diffed against its reference. Those live
here, as a directory of sources plus a committed bundle.

A game belongs in this tree **if and only if it needs a bundle step.** Size
alone is not the test — if it fits in one readable file, it goes in `games/js/`
like everything else.

## Layout

```
multifile/
  README.md            this file
  common/              modules shared across multifile games, bundled by reference
  parity/<name>/       ports that claim bit-exact parity with a named reference
  custom/<name>/       large games with no parity claim
tools/bundle_multifile.py
```

`common/` is not a library with a stable API. It is a place to put code two
multifile games would otherwise copy — float32 helpers, RNG cores, bitmap
helpers, a canonical-state serializer. A module moves into `common/` when the
second game needs it, not in anticipation.

## `parity/<name>/` — the claim, and what earns it

`parity/` is a claim about behaviour, and every game here has to pay for it:

1. **`manifest.json` with a `reference` block** naming the upstream repo, the
   pinned commit, the exact file, its license, what `parity` means for this
   game, and a `not_matched` list of everything it deliberately does not match.
   Vague claims are worse than no claim; `not_matched` is the honest half.
2. **A lockstep test against that reference.** The reference is built and
   stepped alongside the port, and full canonical state is compared every step
   over a committed corpus. No tolerances on integers, no fields dropped from
   the dump.
3. **Committed golden hashes** — a per-step hash chain for every corpus episode,
   so the claim is checkable in CI on a machine that cannot build the reference.

CI runs the golden test. The lockstep test skips, and only skips, when the
reference driver is absent. **If a parity game's test is removed, or fails on
`release`, the game moves to `custom/`.** The directory name is a promise; it is
not allowed to outlive the test that backs it.

`custom/<name>/` requires only a manifest and the ordinary catalog validation.

## `dist/` and the bundler

Each game's `dist/` holds exactly two files, both committed:

- `dist/<name>.js` — the bundled game, plain concatenation of `sources` in
  manifest order with a `// ---- <path> ----` separator and a generated banner.
  No ES modules, no minifier: QuickJS, the AOT tier (`qjsc`), node and the
  browser embed all see one global script, exactly as they do for `games/js/`.
- `dist/<name>.json` — the sidecar manifest, the manifest minus `sources`.

Both are produced by `tools/bundle_multifile.py <manifest>`, wrapped as
`just bundle <name>` and `just bundle-all`. A test fails if either is stale, so
the committed bundle is always the one the sources produce.

Edit `src/`. Never edit `dist/` — the banner says so too.

## For tooling authors

Read `manifest.json` and the sidecar. **Never branch on directory names.**
`parity/` vs `custom/` is documentation for humans and a CI policy; it is not an
interface. A game declares its action space, observation modes, step budget and
human controls in its manifest, and tools that need those read them from there.

## Games here

| game | kind | reference | status |
|---|---|---|---|
| `parity/craftax_classic` | parity | PufferLib `ocean/craftax_classic/craftax_classic.h` @ `6ffa5b1`, MIT | lockstep-exact, 210 episodes / 49,061 steps |
