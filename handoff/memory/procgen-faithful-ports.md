---
name: procgen-faithful-ports
description: "Literal C++ ports of procgen climber/jumper live in games/procgen_faithful/, deliberately outside both game catalogs; the shipped catalog versions are untouched"
metadata: 
  node_type: memory
  type: project
  originSessionId: aa8daadf-7359-49ab-af63-4df759e480df
  modified: 2026-08-07T23:47:30.324Z
---

`games/procgen_faithful/{climber,jumper}.js` (added 2026-08-07) are literal
ports of `games/procgen_src/{climber,jumper}.cpp` plus the engine pieces those
games inherit — `basic-abstract-game.cpp`, `mazegen.cpp`, `roomgen.cpp`. They
simulate in ProcGen's frame (tile units, y up) and flip only at render time.
The directory has a README with run instructions and a fidelity table.

**Why:** the catalog `climber.js` is broken (fails observation sanity —
degenerate frames, camera stuck at the bottom of a 64-tall world, reward 0) and
the catalog `jumper.js` is not jumper (floors-with-gaps + breadcrumb coins, no
cave, no compass, no camera scroll). The ports were kept OUT of `games/js/` and
`examples/games/js/` at Ryan's request so no existing benchmark number silently
changes meaning — the climber throughput figure in
[[playtrain-benchmark-results]] still measures the catalog version.

**How to apply:** the tooling can't see them — `list_available_games` globs
`games/js/*.js` non-recursively and `tools/play.mjs` hardcodes
`examples/games/js`, so `just play` and `playtrain-validate` skip the directory.
`QuickJSEnv` accepts a full `.js` path as `game`, which is the way in. Note
those two catalogs already drift from each other for ~10 games (including study
games breakout, seaquest, flappy_bird) — they are not auto-synced.

When porting the remaining procgen games, reuse the recipe: translate the .cpp
literally in procgen coordinates, then validate by driving the real env
([[procgen-local-playtest]]) through PlayTrain's 8 actions mapped onto procgen's
move encoding and comparing random-agent episode length / return / win-death
split. Both ports landed within a few percent of procgen easy mode.
