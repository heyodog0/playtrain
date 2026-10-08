"""G5: NativeVecEnv with N envs gives exactly what N single envs give for the
same seeds and actions - observations, rewards, terminated, truncated - with
autoreset on (max_steps shortened so a 400-step run crosses several resets).
The host's default autoreset seed formula depends on the env's index and the
batch size, so both runs use mode 'fixed': every autoreset reseeds to 99."""
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parents[4]
DIST = HERE / 'dist'
BUNDLES = sorted(p.stem for p in DIST.glob('dmlab_*.js'))
N, STEPS, MAX = 4, 400, 150
SEEDS = [3, 17, 40, 1001]


def _lib_built():
    return any((REPO / 'native' / 'build').glob('libqjs_vec.*'))


def _run(game, seeds, actions):
    from playtrain.runtime import NativeVecEnv
    env = NativeVecEnv(game=game, num_envs=len(seeds), num_threads=len(seeds), obs_size=64,
                       games_dir=str(DIST), autoreset=True, max_steps=MAX)
    try:
        env.set_autoreset_seeds('fixed', fixed_seed=99)
        env.reset(list(seeds))
        out = []
        for t in range(actions.shape[0]):
            o, r, te, tr = env.step(actions[t])[:4]   # (obs, rew, term, trunc, info)
            out.append((np.array(o, copy=True), np.array(r, copy=True), np.array(te, copy=True), np.array(tr, copy=True)))
        return out
    finally:
        env.close()


@pytest.mark.parametrize('game', BUNDLES)
def test_vec_equals_single(game):
    if not _lib_built():
        pytest.skip('library not built (run native/build_qjs_vec.sh)')
    rng = np.random.RandomState(7)
    actions = rng.randint(0, 9, size=(STEPS, N)).astype(np.int64)
    batch = _run(game, SEEDS, actions)
    trunc_seen = 0
    for k, s in enumerate(SEEDS):
        single = _run(game, [s], actions[:, k:k + 1])
        for t in range(STEPS):
            for j, name in enumerate(('obs', 'reward', 'terminated', 'truncated')):
                a, b = batch[t][j][k], single[t][j][0]
                assert np.array_equal(a, b), f'{game} env {k} (seed {s}) step {t}: {name} differs'
            trunc_seen += int(batch[t][3][k])
    assert trunc_seen >= N, 'autoreset never exercised'
