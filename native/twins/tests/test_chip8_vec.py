"""T5 (CHIP-8): NativeVecEnv on libtwin_vec and on libqjs_vec, same game, seeds and actions, autoreset on: identical
obs, rewards, terminations and truncations at every one of 200 batched steps over 8 envs."""
import platform

import numpy as np
import pytest
from conftest import LIB, REPO, ensure_built

QJS = REPO / "native" / "build" / ("libqjs_vec.dylib" if platform.system() == "Darwin" else "libqjs_vec.so")


@pytest.mark.skipif(not QJS.exists(), reason="libqjs_vec not built (native/build_qjs_vec.sh)")
@pytest.mark.parametrize("game", ["chip8_brix", "chip8_tetris", "chip8_cavern1", "chip8_space_flight3"])
def test_vec_twin_equals_vec_qjs(game):
    ensure_built()
    from playtrain.runtime import NativeVecEnv
    outs = []
    for lib in (str(LIB), str(QJS)):
        v = NativeVecEnv(game=game, num_envs=8, num_threads=4, obs_size=64, autoreset=True, lib_path=lib)
        v.reset(list(range(8)))
        rng = np.random.default_rng(7)
        seq = []
        for _ in range(200):
            out = v.step(rng.integers(0, v.n_actions if hasattr(v, "n_actions") else 3, size=8))
            seq.append(tuple(np.array(o).copy() for o in out[:4]))
        v.close()
        outs.append(seq)
    for t, (a, b) in enumerate(zip(*outs)):
        for name, x, y in zip(("obs", "rew", "term", "trunc"), a, b):
            assert np.array_equal(x, y), f"{game} step {t} {name} differs (first env {int(np.argmax((x != y).reshape(x.shape[0], -1).any(axis=1)))})"
