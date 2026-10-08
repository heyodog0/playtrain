# Multi-file games

Most PlayTrain games are one file in `games/js/`. The games here are ports of
existing environments, and each one is too big for a single readable file. Each
game is a folder of sources plus one committed bundle in `dist/`. PlayTrain
loads the bundle like any other game, by name.

## Games

| game | what it is | matches |
|---|---|---|
| [`parity/craftax_classic`](parity/craftax_classic) | Craftax-Classic, top-down | PufferLib's C, step for step |
| [`variants/craftax_fp`](variants/craftax_fp) | the same game in first person | `craftax_classic`'s dynamics |
| [`variants/craftax_fp_free`](variants/craftax_fp_free) | first person with turn and strafe | not a parity port |
| [`parity/chip8`](parity/chip8) | 22 CHIP-8 arcade games, 37 bundles | Octax, step for step |
| [`parity/vgdl`](parity/vgdl) | VGDL games, 26 bundles | py-vgdl, step for step |
| [`parity/puzzlescript`](parity/puzzlescript) | 17 PuzzleScript games | the PuzzleScript engine itself |
| [`parity/dmlab`](parity/dmlab) | 23 DMLab-30 levels | DeepMind Lab, frame by frame |

## Layout

```
common/          code shared by two or more games (float32, RNGs, threefry)
parity/<name>/   ports that match a named reference exactly
variants/<name>/ games built on a parity port that change it
custom/<name>/   large games with no reference
```

A game in `parity/` has to earn the name. Its `manifest.json` pins the
reference and lists what is not matched. A lockstep test steps the port next to
the reference over a committed corpus. Committed golden hashes let CI check the
claim without building the reference. If that test goes away, the game moves
to `custom/`.

## Bundling

Edit `src/`, never `dist/`. Then rebuild:

```console
$ just bundle craftax_classic    # one game
$ just bundle-all                # every game
```

The CHIP-8, VGDL and PuzzleScript families build many games from one engine, so
each has its own `node tools/bundle_all.mjs` inside its folder.

`dist/<name>.js` is the game. `dist/<name>.json` is its sidecar, which holds
the action list, the step limit and the human controls. Tools read these from
the sidecar and never from the folder name. A test fails if a committed bundle
is stale.
