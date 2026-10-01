# PuzzleScript

The 17 example games from the PuzzleScript editor, running on PuzzleScript's
own engine. The engine is vendored byte for byte and never edited, so there is
no engine of ours to be wrong. PlayTrain adds only the shims and the loop
around it. The games are `ps_microban`, `ps_sokoban_basic`, `ps_midas` and so on.

Reference: [`increpare/PuzzleScript`](https://github.com/increpare/PuzzleScript)
at `d236596`. The engine is © 2013 Stephen Lavelle, MIT. Every bundle carries
that notice, and `reference/LICENSE` is the original. Each game is by its own
author, named in the bundle and in `games/<game>.json`. Only games the editor
offers as examples are here, because the PuzzleScript repo says those can be
assumed MIT.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/parity/puzzlescript/dist \
    --out dist/ps-play --title "PuzzleScript"
$ uv run python -m http.server -d dist/ps-play 8000
```

Open <http://localhost:8000/game/ps_microban/>. Arrows move. Games run at
8 steps/s. Each bundle also has `humanKey` for undo (Z) and restart (R), and
`humanLevels` and `humanSetLevel` for a level picker. A play page can call
them. The environment never does.

## Train an agent

```json
{
  "game": "ps_microban",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 6,
  "obs_shape": [3, 64, 64],
  "net": "impala",
  "total_steps": 10000000,
  "log_dir": "outputs/ps_microban"
}
```

```console
$ python -m playtrain_trainers.train_impala --config ps_microban.json
```

## Observation and actions

A 64x64 frame of the level. A symbolic observation, one
grid per object type, is also available with `obs_mode="symbolic"`. Its size
depends on the game.

Six actions: UP, LEFT, DOWN, RIGHT, ACTION and NOOP. None of the 17 games has
a rule for ACTION, so it does nothing in them. The seed picks the level, and
solving it ends the episode with reward 1. Episodes stop at 1,000 steps.

## What is exact

- Every step, against an unmodified checkout of the reference: the level as the
  engine serialises it, the object bits, win and "again" state, undo depth and
  the RNG. Checked on 51 trajectories, 17 games with 3 seeds of 300 steps.
- The reference's own 770 tests pass through the bundle, under node and
  QuickJS.
- The engine's own `redraw()` draws the same tiles as the bundle, on 3,538
  states.
- Not matched: pixel size, sound, the title and message screens, and the NOOP
  step every PlayTrain game takes at reset. Undo and restart are not actions.

## Tests

```console
$ uv run pytest examples/games/multifile/parity/puzzlescript/tests -q
```

CI checks the golden hashes. The lockstep test needs a checkout of the
reference:

```console
$ git clone https://github.com/increpare/PuzzleScript /tmp/puzzlescript
$ git -C /tmp/puzzlescript checkout d236596d993b6ebb7988f1a078f582c0840ccbca
$ export PS_REF=/tmp/puzzlescript
```

## Adding a game

Add only games whose license is clear. Copy the text into `games/`, write
`games/<name>.json`, add it to `manifest.json` with its sha256, then run
`node tools/bundle_all.mjs` and `node tests/golden.mjs --write`.
