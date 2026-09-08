"""Compile-at-load (playtrain.runtime.aot_cache): the engine-tier ladder.

The build tests need the engine-tier toolchain (a prepared native/aotfork/out or
$PLAYTRAIN_AOT_FORK_OUT, clang) and are skipped without it; the resolution tests run anywhere.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from playtrain.runtime import aot_cache
from playtrain.runtime.native_vec_env import NativeVecEnv, _GAMES_DIR

TC = aot_cache.toolchain()
needs_toolchain = pytest.mark.skipif(TC is None, reason="engine-tier toolchain not available")


def test_off_returns_stock(monkeypatch):
    monkeypatch.setenv("PLAYTRAIN_AOT", "off")
    assert aot_cache.resolve_lib(_GAMES_DIR / "bigfish.js") == aot_cache._STOCK


def test_no_toolchain_returns_stock(monkeypatch, tmp_path):
    monkeypatch.delenv("PLAYTRAIN_AOT", raising=False)
    monkeypatch.setenv("PLAYTRAIN_AOT_FORK_OUT", str(tmp_path / "nowhere"))
    assert aot_cache.resolve_lib(_GAMES_DIR / "bigfish.js") == aot_cache._STOCK


@needs_toolchain
def test_key_changes_with_one_byte(tmp_path):
    src = (_GAMES_DIR / "bigfish.js").read_bytes()
    a, b = tmp_path / "a" / "bigfish.js", tmp_path / "b" / "bigfish.js"
    a.parent.mkdir(); b.parent.mkdir()
    a.write_bytes(src); b.write_bytes(src + b"\n")
    assert aot_cache.cache_key(a, TC) != aot_cache.cache_key(b, TC)
    assert aot_cache.cache_key(a, TC) == aot_cache.cache_key(_GAMES_DIR / "bigfish.js", TC)


@needs_toolchain
def test_tier1_when_max_tier_1_or_mixed_pool(monkeypatch):
    monkeypatch.setenv("PLAYTRAIN_AOT", "1")
    assert aot_cache.resolve_lib(_GAMES_DIR / "bigfish.js") == TC.tier1
    monkeypatch.delenv("PLAYTRAIN_AOT")
    assert aot_cache.resolve_lib(None) == TC.tier1


def _checksum(lib: Path, game: str, steps: int = 200, n: int = 8) -> bytes:
    import hashlib
    env = NativeVecEnv(game, num_envs=n, autoreset=True, num_threads=2, lib_path=lib)
    h = hashlib.md5()
    h.update(np.ascontiguousarray(env.reset(seeds=np.arange(n, dtype=np.int32))).tobytes())
    rng = np.random.default_rng(7)
    for _ in range(steps):
        out = env.step(rng.integers(0, env.n_actions, n).astype(np.int32))
        for x in (out if isinstance(out, tuple) else (out,)):
            if isinstance(x, np.ndarray):
                h.update(np.ascontiguousarray(x).tobytes())
    env.close()
    return h.digest()


@needs_toolchain
def test_tier2_build_and_exactness(monkeypatch, tmp_path):
    """Sync build of tier 2 for one game into a temp cache; obs/reward/done identical to tier 1."""
    monkeypatch.setenv("PLAYTRAIN_AOT", "2")
    monkeypatch.setenv("PLAYTRAIN_AOT_SYNC", "1")
    monkeypatch.setenv("PLAYTRAIN_AOT_CACHE", str(tmp_path))
    game = _GAMES_DIR / "bigfish.js"
    lib = aot_cache.resolve_lib(game)
    assert lib.name == "tier2.so", f"tier 2 not built; see {tmp_path}/*/build.log"
    assert not (lib.parent / "FAILED").exists()
    assert _checksum(lib, str(game)) == _checksum(TC.tier1, str(game))
    # second resolve is a cache hit (no rebuild), and the default (async) path returns it too
    monkeypatch.delenv("PLAYTRAIN_AOT_SYNC")
    assert aot_cache.resolve_lib(game) == lib
    assert not os.path.exists(lib.parent / ".building")
