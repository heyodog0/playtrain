# Craftax-Classic, first person, free movement

[`craftax_fp`](../craftax_fp) with six extra actions, so you can turn in place,
walk backwards and strafe. In Craftax every move also turns you, which makes
first person awkward to play by hand. This variant fixes that.

It is not Craftax's task. With 23 actions instead of 17, an agent trained here
is not comparable to one trained on `craftax_classic` or `craftax_fp`.

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp_free/dist \
    --out dist/craftax-fp-free-play --title "Craftax first-person (free movement)"
$ uv run python -m http.server -d dist/craftax-fp-free-play 8001
```

Open <http://localhost:8001/game/craftax_fp_free/>. UP and DOWN walk forward and
back, LEFT and RIGHT turn in place, and A and D strafe. The other keys are
`craftax_classic`'s. I, J, K and L are Craftax's original absolute moves.

## Train an agent

Use the `craftax_classic` config with `"game": "craftax_fp_free"` and
`"num_actions": 23`:

```console
$ python -m playtrain_trainers.train_impala --config craftax_fp_free.json
```

## Actions

Actions 0 to 16 are Craftax's, unchanged. The new ones use Craftax's own
collision checks, so walls, water and mobs still block you.

| # | action | facing | position |
|---|---|---|---|
| 17 | MOVE_FORWARD | same | one cell ahead |
| 18 | MOVE_BACK | same | one cell behind |
| 19 | STRAFE_LEFT | same | one cell left |
| 20 | STRAFE_RIGHT | same | one cell right |
| 21 | TURN_LEFT | quarter turn left | same |
| 22 | TURN_RIGHT | quarter turn right | same |

## What is exact

Actions 0 to 16 still match `craftax_classic` byte for byte over the 210-episode
corpus, so the new actions did not disturb the old ones. QuickJS and V8 draw
identical frames.

The only new code is `src/72_move_free.js`. It redefines `stepGame`, so
`manifest.json` must list it after `70_step.js`.

## Tests

```console
$ uv run pytest examples/games/multifile/variants/craftax_fp_free/tests -q
```
