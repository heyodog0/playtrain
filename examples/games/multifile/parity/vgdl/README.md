# `parity/vgdl/` — VGDL games on a py-vgdl-exact engine

One engine, many games. `src/` is a data-oriented VGDL interpreter whose
semantics are py-vgdl's (Colas lineage, as ported to gymnasium by Tomov in
`language_and_experience @ dbp` and vendored by `infer-vgdl`). `games/` holds
the corpus as VGDL text. `tools/bundle_all.mjs` produces one ordinary PlayTrain
game per spec in `dist/`, so every VGDL game is discoverable by name
(`vgdl_aliens`, `vgdl_zelda_vgfmri3`, …) and runs on every PlayTrain backend and
in the browser unchanged.

```
manifest.json        family manifest: reference pins, corpora, action space, not_matched
src/
  10_rng_mt19937.js  CPython random.Random, bit-exact (seed, random(), choice())
  20_parser.js       VGDL text -> spec (py-vgdl parser semantics, tab expansion included)
  30_engine.js       the engine: typed-array tables per type, cell grids, py-vgdl tick
  90_prelude.js      PlayTrain contract + render modes (tiles | fast | exact)
games/infer/         12 games, 4 levels each  (parity: yes, block_size 50)
games/vgfmri/        13 games, 3-12 levels    (parity: not yet — see manifest)
tools/bundle_vgdl.mjs   one game -> dist/vgdl_<game>.js (+ sidecar with --sidecar)
tools/bundle_all.mjs    every game in the manifest; --check for freshness
tests/gate_oracle.mjs   lockstep gate vs py-vgdl (needs VGDL_ORACLE_PY, VGDL_LAE)
tests/oracle.py         the Python side of that gate
tests/golden.mjs        committed trajectory hashes, checked without Python
tests/test_*.py         pytest: freshness, goldens, lockstep (skips w/o oracle), runtime
dist/                   GENERATED. Never edit.
```

## Parity

The claim (manifest `corpora.infer.reference.parity`): same spec, level, seed and
action sequence produce the same `(time, score, ended, won)` and the same set of
live sprites `(type, x, y, resources)` at every step as py-vgdl at
`block_size=50`. 138/138 trajectories (12 games x every level x 3 seeds x 300
random steps) at the time of writing. What is deliberately not matched is
listed under `not_matched`.

The py-vgdl gate needs a Python with pygame and a checkout of the reference:

```bash
uv venv /tmp/oracle-venv && uv pip install --python /tmp/oracle-venv/bin/python "pygame>=2.1" "gym==0.26.2" numpy
git clone https://github.com/heyodog0/infer-vgdl /tmp/infer-vgdl        # or tomov/language_and_experience -b dbp
VGDL_ORACLE_PY=/tmp/oracle-venv/bin/python VGDL_LAE=/tmp/infer-vgdl node tests/gate_oracle.mjs infer
```

`tests/golden.json` pins the resulting trajectories so CI checks them without
Python. The cross-engine gate (V8 + wasm reference vs the QuickJS host, obs
hash included) is `native/gate_qjs.sh`; the hosts must be told the family's
action table:

```bash
AJ=$(python3 -c "import json;print(json.dumps(json.load(open('runtime/action_spaces.json'))['vgdl6']))")
PLAYTRAIN_ACTION_SPACE=vgdl6 PLAYTRAIN_QJS_ACTIONS="$AJ" \
PLAYTRAIN_GAMES_DIR=examples/games/multifile/parity/vgdl/dist bash native/gate_qjs.sh --all 400
```

## Rendering

`tiles` (the dist default) draws every static type in one `drawTiles` host call
and movers as rects at their exact pixel positions; `fast` uses a full-cover
static as the background; `exact` issues one rect per sprite in registration
order and exists for draw-call-level comparisons. Pixels are `not_matched`:
py-vgdl draws at `block_size`, PlayTrain draws 8px cells into a 64x64 frame.
Levels of one game differ in size, so the canvas is the largest level and
smaller ones are letterboxed.

## The two corpora

`infer` is the DBP / language_and_experience set (block 50; fractional speeds
mean sub-cell pixel motion, which the engine reproduces). `vgfmri` are
vgdl-metagen's translations of the Tomov et al. fMRI games; they run, they are
gated against the engine's own goldens, but they are NOT the fMRI originals and
carry no parity claim. The originals and their reference (tomov/RC_RL, branch
`fmri`, Python 2, a different dialect and a different core) are phase 2; see
`manifest.json` and `playtrain-internal/docs/DSL_PORTS_DESIGN.md`.

## Adding a game

Drop `<name>.txt` and `<name>_lvl<N>.txt` into `games/<corpus>/`, add the name
to the manifest, run `node tools/bundle_all.mjs`, then gate it:
`node tests/gate_oracle.mjs <corpus>/<name>` and `node tests/golden.mjs --write`.
A class or effect the engine lacks fails loudly in the gate, not silently.
