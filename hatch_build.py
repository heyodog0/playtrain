"""Build the native backend into the wheel.

The runtime is a compiled QuickJS + rasterizer host (``native/build/``), not an
optional add-on, so a wheel without it installs a package that raises on first
use. This hook runs the two build scripts and stages their outputs under
``playtrain/_assets/native/build``, where ``playtrain._paths.asset`` finds them
in wheel installs (a checkout keeps resolving against the repo root as before).

The wheel is therefore platform-specific: ``infer_tag`` stamps the real
platform tag and ``pure_python = false`` keeps hatchling from emitting
``py3-none-any``.

Portability: the from-source scripts default to ``-march=x86-64-v3`` (AVX2),
which SIGILLs on pre-Haswell hardware. Wheels are built with a conservative
baseline instead — ``PLAYTRAIN_WHEEL_ARCH`` (default ``x86-64-v2``) is passed
through to the scripts. Building from a checkout is unaffected.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_LIB = "libqjs_vec.dylib" if sys.platform == "darwin" else "libqjs_vec.so"


class NativeBuildHook(BuildHookInterface):
    PLUGIN_NAME = "playtrain-native"

    def initialize(self, version, build_data):
        if self.target_name != "wheel":
            return
        root = Path(self.root)
        build_dir = root / "native" / "build"

        if os.environ.get("PLAYTRAIN_SKIP_NATIVE_BUILD") != "1":
            env = dict(os.environ)
            arch = env.get("PLAYTRAIN_WHEEL_ARCH", "x86-64-v2")
            env["PLAYTRAIN_ARCH"] = arch
            for script in ("build_qjs.sh", "build_qjs_vec.sh"):
                subprocess.run(["bash", f"native/{script}"], cwd=root, env=env, check=True)

        artifacts = [build_dir / "qjs_host", build_dir / _LIB]
        missing = [str(p) for p in artifacts if not p.exists()]
        if missing:
            raise RuntimeError(f"native build produced no {missing[0]} - cannot build a usable wheel")

        # Stage into the package tree; force-include maps them into the wheel.
        staged = root / "src" / "playtrain" / "_assets" / "native" / "build"
        staged.mkdir(parents=True, exist_ok=True)
        for p in artifacts:
            shutil.copy2(p, staged / p.name)

        # The backend is loaded through ctypes, not as a CPython extension, so the
        # wheel is platform-specific but ABI-independent: py3-none-<platform>, not
        # cp3XX-cp3XX (which would refuse to install on any other Python).
        from packaging.tags import sys_tags

        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{next(iter(sys_tags())).platform}"
