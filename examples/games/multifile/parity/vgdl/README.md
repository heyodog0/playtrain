# VGDL

Games written in the Video Game Description Language, on a JavaScript engine
that steps exactly like py-vgdl. There are 26 games: `vgdl_aliens`,
`vgdl_portals`, `vgdl_vgfmri3_zelda` and so on.

VGDL is Schaul, [CIG 2013](https://doi.org/10.1109/CIG.2013.6633610). There are
two sets of games, each matched against its own reference:

| set | games | reference |
|---|---|---|
| `games/infer/` | 12 | py-vgdl as ported by Tomov, [`language_and_experience`](https://github.com/tomov/language_and_experience) branch `dbp` |
| `games/vgfmri_rcrl/` | 14 | the games from the Tomov et al. fMRI study, [`tomov/RC_RL`](https://github.com/tomov/RC_RL) branch `fmri` |

## Play it

```console
$ node tools/build-pages.mjs --games examples/games/multifile/parity/vgdl/dist \
    --out dist/vgdl-play --title "VGDL"
$ uv run python -m http.server -d dist/vgdl-play 8000
```

Open <http://localhost:8000/game/vgdl_aliens/>. Games run at 8 steps/s. Arrows
move, and SPACE shoots or acts in games that have it.

## Train an agent

```json
{
  "game": "vgdl_aliens",
  "env_backend": "playtrain",
  "inference_mode": "vec",
  "num_actions": 6,
  "obs_shape": [3, 64, 64],
  "net": "impala",
  "total_steps": 10000000,
  "log_dir": "outputs/vgdl_aliens"
}
```

```console
$ python -m playtrain_trainers.train_impala --config vgdl_aliens.json
```

## Observation and actions

A 64x64 frame. The level is drawn with whole-pixel cells and centred. A game's
levels differ in size, so smaller ones get a border.

Every game uses the same six actions: UP, DOWN, LEFT, RIGHT, NOOP and SPACE.
The seed picks the level. Episodes stop at 2,000 steps.

## What is exact

- Every step: time, score, whether the game ended and was won, and every live
  sprite's type, position and resources. `infer` is checked at 138 of 138
  trajectories and `vgfmri_rcrl` at 378 of 378.
- Not matched: pixels, reward shaping in the references' gym wrappers,
  multi-key actions, and the NOOP step every PlayTrain game takes at reset.
  `manifest.json` lists the details per set.

## Tests

```console
$ uv run pytest examples/games/multifile/parity/vgdl/tests -q
```

CI checks the golden hashes. The `infer` lockstep test needs py-vgdl:

```console
$ uv venv /tmp/oracle-venv
$ uv pip install --python /tmp/oracle-venv/bin/python "pygame>=2.1" "gym==0.26.2" numpy
$ git clone https://github.com/heyodog0/infer-vgdl /tmp/infer-vgdl
$ export VGDL_ORACLE_PY=/tmp/oracle-venv/bin/python VGDL_LAE=/tmp/infer-vgdl
```

The `vgfmri_rcrl` reference is Python 2, so its test runs it in the
`rcrl-oracle` Docker image. Set `VGDL_RCRL` to an RC_RL checkout.

## Adding a game

Put `<name>.txt` and `<name>_lvl<N>.txt` in `games/<set>/`, add the name to
`manifest.json`, then run `node tools/bundle_all.mjs` and
`node tests/golden.mjs --write`. If the game uses a class the engine lacks,
the lockstep test fails and names it.
