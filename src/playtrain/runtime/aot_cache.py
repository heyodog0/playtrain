"""Compile-at-load for the engine tier (``native/aotfork``).

A game JS file is served by the fastest of three engine-tier ``.so`` variants
that exists for it, and the missing ones are built in the background so the
*next* process gets them (HANDOFF-2026-09-04-round6-E3-adoption.md §6.3):

* **tier 1** — ``libqjs_vec.forkIT2.so``: the QuickJS fork interpreter, PGO+LTO on
  the 24 paper games. Any game runs on it unchanged. Always available once the
  toolchain dir exists; never built here.
* **tier 2** — ``qjsc -A`` AOT of this game + E3 intrinsics, the game unit compiled
  without a profile, linked against the PGO'd engine objects (``UNIT_NOPGO=1``).
  ~40 s to build. This is what a never-seen game gets first.
* **tier 3** — same, after a short instrumented run of *this* game whose profile is
  merged into the 24-game profile and the whole ``.so`` rebuilt with it. ~2 min.

Resolution never blocks env construction (unless ``PLAYTRAIN_AOT_SYNC=1``) and any
build failure leaves the env on tier 1. An explicit ``lib_path`` to the env
constructors bypasses all of this, so every existing bench script is unaffected.

Environment:
  PLAYTRAIN_AOT           ``off`` -> the stock ``native/build/libqjs_vec.so`` (pre-engine-
                          tier behaviour); ``1``/``2``/``3`` -> highest tier to use
                          (default 3). Unset with no toolchain -> stock, silently.
  PLAYTRAIN_AOT_FORK_OUT  a ``build_fork.sh`` output dir holding the toolchain (default
                          ``<repo>/native/aotfork/out``): ``qjsc``, ``prelude.js``,
                          ``src/`` (patched fork, with ``quickjs.i``), ``picIT2u/``,
                          ``forkI24.profdata``, ``libqjs_vec.forkIT2.so``; ``picIgen/``
                          for tier 3.
  PLAYTRAIN_AOT_CACHE     cache dir (default ``~/.cache/playtrain/aot``; on the cluster
                          point it at holylabs).
  PLAYTRAIN_AOT_SYNC      ``1`` -> build in-process and return the built tier (tests,
                          one-off benchmarks).
  PLAYTRAIN_AOT_PROFILE_SECS  tier-3 instrumented run length (default 30).

Cache key = sha256 over the game source and everything that shapes the emitted code:
qjsc, prelude, intrinsics list, host + p5 sources, build script, the engine archive,
the profile, the rasterizer archive and the clang version. One byte of game source
changed -> a new key.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from playtrain._paths import asset as _asset

log = logging.getLogger("playtrain.aot")

_ROOT = Path(__file__).resolve().parents[3]
_NATIVE = _ROOT / "native"
_AOTFORK = _NATIVE / "aotfork"
_STOCK = _asset("native/build/" + ("libqjs_vec.dylib" if sys.platform == "darwin"
                                   else "libqjs_vec.so"))
_STALE_LOCK_S = 3600       # a builder that has held the lock this long is presumed dead
_RETRY_FAILED_S = 3600     # after a failed build, do not retry more often than this
_warned: set[str] = set()


def _warn_once(key: str, msg: str) -> None:
    if key not in _warned:
        _warned.add(key)
        log.warning(msg)


@dataclass(frozen=True)
class Toolchain:
    fork_out: Path
    profdata: Path
    tier1: Path
    rasterizer: Path
    clang_version: str

    @property
    def tier3_capable(self) -> bool:
        return (self.fork_out / "picIgen" / "libqjs_forkaot.a").exists() and shutil.which("llvm-profdata") is not None


def fork_out_dir() -> Path:
    return Path(os.environ.get("PLAYTRAIN_AOT_FORK_OUT") or _AOTFORK / "out")


def cache_dir() -> Path:
    return Path(os.environ.get("PLAYTRAIN_AOT_CACHE") or Path.home() / ".cache" / "playtrain" / "aot")


def toolchain() -> Toolchain | None:
    """The engine-tier toolchain, or None if anything it needs is missing."""
    fo = fork_out_dir()
    needed = [fo / "qjsc", fo / "prelude.js", fo / "src" / "quickjs.i", fo / "picIT2u" / "libqjs_forkaot.a",
              fo / "forkI24.profdata", fo / "libqjs_vec.forkIT2.so", _AOTFORK / "build_fork.sh",
              _NATIVE / "frozenmath" / "libfrozenmath_pic.a"]
    missing = [str(p) for p in needed if not p.exists()]
    if missing or shutil.which("clang") is None:
        if os.environ.get("PLAYTRAIN_AOT"):   # opted in explicitly: say why it is not happening
            _warn_once("toolchain", f"engine-tier toolchain unavailable ({(missing or ['clang'])[0]}); using the stock .so")
        return None
    ra_pgo = fo / "libplaytrain_rasterizer.a.rustpgo_adv"
    ra = ra_pgo if ra_pgo.exists() else _ROOT / "crates" / "rasterizer" / "target" / "release" / "libplaytrain_rasterizer.a"
    if not ra.exists():
        _warn_once("toolchain", f"engine-tier toolchain unavailable ({ra}); using the stock .so")
        return None
    try:
        cv = subprocess.run(["clang", "--version"], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    except Exception:  # noqa: BLE001
        cv = "clang-unknown"
    return Toolchain(fo, fo / "forkI24.profdata", fo / "libqjs_vec.forkIT2.so", ra, cv)


def cache_key(game_path: Path, tc: Toolchain) -> str:
    h = hashlib.sha256()
    h.update(tc.clang_version.encode() + b"\0")
    for p in (game_path, tc.fork_out / "qjsc", tc.fork_out / "prelude.js", _AOTFORK / "aot_intr_list.h",
              _AOTFORK / "qjs_vec_host_fork.cpp", _NATIVE / "runtime" / "p5.cpp", _NATIVE / "runtime" / "p5.hpp",
              _AOTFORK / "build_fork.sh", tc.fork_out / "picIT2u" / "libqjs_forkaot.a", tc.profdata, tc.rasterizer):
        h.update(p.name.encode() + b"\0")
        h.update(hashlib.sha256(p.read_bytes()).digest() if p.exists() else b"missing")
    return h.hexdigest()[:20]


def _max_tier() -> int:
    v = os.environ.get("PLAYTRAIN_AOT", "").strip().lower()
    if v in ("1", "2", "3"):
        return int(v)
    return 3


def resolve_lib(game_path: str | os.PathLike | None) -> Path:
    """Path of the ``.so`` to load for ``game_path`` (None = a multi-game pool)."""
    mode = os.environ.get("PLAYTRAIN_AOT", "").strip().lower()
    if mode == "off":
        return _STOCK
    tc = toolchain()
    if tc is None:
        return _STOCK
    if game_path is None or _max_tier() == 1:
        return tc.tier1          # a mixed pool cannot use a per-game unit
    game = Path(game_path).resolve()
    d = cache_dir() / cache_key(game, tc)
    want = min(_max_tier(), 3 if tc.tier3_capable else 2)
    if os.environ.get("PLAYTRAIN_AOT_SYNC") == "1":
        try:
            build(game, d, tc, want)
        except Exception as e:  # noqa: BLE001
            _warn_once(str(d), f"engine-tier build failed for {game.name}: {e}; using tier 1")
        return _best(d, want) or tc.tier1
    best = _best(d, want)
    if best is None or (want == 3 and best.name == "tier2.so"):
        _spawn(game, d, tc, want)
    return best or tc.tier1


def _best(d: Path, want: int) -> Path | None:
    for t in range(want, 1, -1):
        p = d / f"tier{t}.so"
        if p.exists():
            return p
    return None


def _spawn(game: Path, d: Path, tc: Toolchain, want: int) -> None:
    d.mkdir(parents=True, exist_ok=True)
    lock, failed = d / ".building", d / "FAILED"
    now = time.time()
    if _lock_live(lock):
        return
    if failed.exists() and now - failed.stat().st_mtime < _RETRY_FAILED_S:
        return
    logf = open(d / "build.log", "ab")  # noqa: SIM115 — inherited by the detached child
    # A detached session so a Ctrl-C to the trainer does not kill it; under Slurm the
    # job's cgroup still reaps it when the job ends (a stale lock is then detected by pid).
    subprocess.Popen([sys.executable, "-c", "from playtrain.runtime.aot_cache import _main; _main()",
                      str(game), str(d), str(want)],
                     stdin=subprocess.DEVNULL, stdout=logf, stderr=subprocess.STDOUT,
                     start_new_session=True, close_fds=True, cwd=str(_AOTFORK),
                     env={**os.environ, "PLAYTRAIN_AOT_FORK_OUT": str(tc.fork_out)})
    logf.close()
    log.info("engine-tier: building tier %d for %s in the background (%s)", want, game.name, d)


def _lock_live(lock: Path) -> bool:
    """True if ``lock`` exists, is fresh, and its builder pid is still alive."""
    try:
        st = lock.stat()
    except FileNotFoundError:
        return False
    if time.time() - st.st_mtime > _STALE_LOCK_S:
        return False
    try:
        pid = int(lock.read_text().strip() or 0)
    except (OSError, ValueError):
        return True
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


# ---------------------------------------------------------------- the builder ----

def _sh(cmd: list[str], env: dict, cwd: Path) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, env=env, cwd=str(cwd), check=True)


def build(game: Path, d: Path, tc: Toolchain, want: int) -> None:
    """Build tier 2 (and tier 3 if ``want == 3``) for ``game`` into ``d``. Blocking."""
    d.mkdir(parents=True, exist_ok=True)
    lock = d / ".building"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        if _lock_live(lock):
            raise RuntimeError("another builder holds the lock")
        lock.write_text(str(os.getpid()))
    try:
        _build_locked(game, d, tc, want)
        (d / "FAILED").unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        (d / "FAILED").write_text(f"{time.ctime()}: {e}\n")
        raise
    finally:
        lock.unlink(missing_ok=True)


def _build_locked(game: Path, d: Path, tc: Toolchain, want: int) -> None:
    g = game.stem
    wt = d / "wt"                       # a FORK_OUT overlay: shared toolchain by symlink, outputs local
    if wt.exists():
        shutil.rmtree(wt)
    wt.mkdir()
    for name in ("src", "qjsc", "prelude.js", "include", "picIT2u", "picIgen"):
        src = tc.fork_out / name
        if src.exists():
            os.symlink(src, wt / name)
    shutil.copy2(game, d / "game.js")
    base = {**os.environ, "FORK_OUT": str(wt), "INTR": "1", "RA": str(tc.rasterizer)}
    t0 = time.time()
    if not (d / "tier2.so").exists():
        env = {**base, "TUNE": "use", "PROFDATA": str(tc.profdata), "TAG": "IT2u", "UNIT_NOPGO": "1"}
        _sh(["bash", "build_fork.sh", "vec1", str(game)], env, _AOTFORK)
        os.replace(wt / f"libqjs_vec.futIT2u_{g}.so", d / "tier2.so")
        print(f"tier2.so ready in {time.time() - t0:.0f} s", flush=True)
    if want >= 3 and not (d / "tier3.so").exists():
        t1 = time.time()
        prof = wt / "prof"
        prof.mkdir()
        env = {**base, "TUNE": "gen", "PROFDIR": str(prof), "TAG": "Igen"}
        _sh(["bash", "build_fork.sh", "vec1", str(game)], env, _AOTFORK)
        secs = os.environ.get("PLAYTRAIN_AOT_PROFILE_SECS", "30")
        _sh([sys.executable, "-c", _PROFILE_DRIVER, str(wt / f"libqjs_vec.futIgen_{g}.so"), str(game), secs],
            {**os.environ, "LLVM_PROFILE_FILE": str(prof / "vfut-%m-%p.profraw"), "QJS_DIRTY": "1",
             "PLAYTRAIN_AOT": "off"}, _AOTFORK)
        raws = sorted(prof.glob("*.profraw"))
        if not raws:
            raise RuntimeError("instrumented run produced no profile")
        merged = wt / "merged.profdata"
        _sh(["llvm-profdata", "merge", "-o", str(merged), str(tc.profdata), *map(str, raws)], os.environ.copy(), _AOTFORK)
        env = {**base, "TUNE": "use", "PROFDATA": str(merged), "TAG": "IT3"}
        _sh(["bash", "build_fork.sh", "vec1", str(game)], env, _AOTFORK)
        os.replace(wt / f"libqjs_vec.futIT3_{g}.so", d / "tier3.so")
        print(f"tier3.so ready in {time.time() - t1:.0f} s", flush=True)
    shutil.rmtree(wt, ignore_errors=True)


# Runs the published iteration shape (128 envs x 5 threads) with random actions on
# the instrumented .so so the profile reflects the vec workload. Same as
# native/aotfork/vec_prof_driver.py.
_PROFILE_DRIVER = r"""
import sys, time, numpy as np
from playtrain.runtime.native_vec_env import NativeVecEnv
lib, game, dur = sys.argv[1], sys.argv[2], float(sys.argv[3])
env = NativeVecEnv(game, num_envs=128, obs_size=64, max_steps=2000, num_threads=5,
                   autoreset=True, frame_skip=1, lib_path=lib)
env.reset(seeds=np.arange(128, dtype=np.int32))
acts = np.random.default_rng(0).integers(0, env.n_actions or 8, size=(64, 128), dtype=np.int32)
t0, n = time.time(), 0
while time.time() - t0 < dur:
    env.step(acts[n % 64]); n += 1
print(f"profiled {n * 128:,} steps in {time.time() - t0:.0f} s", flush=True)
env.close()
"""

def _main() -> None:
    game, d, want = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    tc = toolchain()
    if tc is None:
        sys.exit("toolchain unavailable")
    print(f"== {time.ctime()} pid {os.getpid()} build tier {want} for {game} -> {d}", flush=True)
    build(game, d, tc, want)
    print(f"== {time.ctime()} done", flush=True)


if __name__ == "__main__":
    _main()
