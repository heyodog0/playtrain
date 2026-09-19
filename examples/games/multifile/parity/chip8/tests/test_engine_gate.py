"""G6: cross-engine determinism. The V8 + wasm reference (native/reference_trace.mjs) and the QuickJS
host produce byte-identical trajectories and observation hashes for every bundle. Each game has its
own action table: the reference reads it from the sidecar, qjs_host is told via PLAYTRAIN_QJS_ACTIONS.
Runs only when native/build/qjs_host exists (skips otherwise, multifile README rule)."""
import json
import os
import subprocess

import pytest
from conftest import FAMILY, REPO

HOST = REPO / "native" / "build" / "qjs_host"
GATE = REPO / "native" / "gate_qjs.sh"
DIST = FAMILY / "dist"
GAMES = sorted(p.stem for p in DIST.glob("chip8_*.js"))

pytestmark = pytest.mark.skipif(not HOST.exists(), reason="qjs_host not built (native/build_qjs.sh)")


def test_corpus_size():
    assert len(GAMES) == 37


@pytest.mark.parametrize("game", GAMES)
def test_reference_vs_qjs_host(game):
    side = json.loads((DIST / f"{game}.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"]), "PLAYTRAIN_GAMES_DIR": str(DIST)}
    env.pop("PLAYTRAIN_ACTION_SPACE", None)          # the reference takes the sidecar's table
    proc = subprocess.run(["bash", str(GATE), game, "300", "1", "42"], cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout
