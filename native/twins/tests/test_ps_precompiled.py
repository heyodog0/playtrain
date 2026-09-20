"""U07: PuzzleScript bundles with precompiled CACHE_* tables (parity/puzzlescript/tools/precompile_caches.mjs).
(a) twin/caches is fresh against dist; (b) the assembled bundles are trajectory-identical to dist for every game
(5 seeds x 300 steps, every __ps.snap field) with zero `new Function` calls after load, and reproduce every entry of
the family's golden.json; (c) G6: V8 reference vs qjs_host byte-identical on every precompiled bundle (skips when
qjs_host is not built)."""
import json
import os
import subprocess

import pytest
from conftest import BUILD, PARITY, REPO, node

FAM = PARITY / "puzzlescript"
PRE = BUILD / "ps_precompiled"
QJS_HOST = REPO / "native" / "build" / "qjs_host"
GAMES = sorted(p.stem for p in (FAM / "games").glob("*.json"))


def test_caches_fresh():
    proc = node(str(FAM / "tools" / "precompile_caches.mjs"), "--check", cwd=FAM)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith(f"caches fresh ({len(GAMES)} games)")
    manifest = json.loads((FAM / "twin" / "caches" / "manifest.json").read_text())
    assert set(manifest) == set(GAMES) and all(m["functions"] > 0 for m in manifest.values())


def assemble():
    proc = node(str(FAM / "tools" / "precompile_caches.mjs"), "--assemble", str(PRE), cwd=FAM)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-2000:]


def test_precompiled_equals_dist_and_goldens():
    assemble()
    proc = node("tests/ps_precompiled_gate.mjs", str(PRE))
    assert proc.returncode == 0, proc.stdout[-6000:] + proc.stderr[-2000:]
    lines = proc.stdout.strip().split("\n")
    assert lines[-2].endswith(f"{5 * len(GAMES)}/{5 * len(GAMES)} trajectories identical (precompiled vs dist), 0 new Function calls"), lines[-2]
    assert lines[-1] == f"golden ok ({6 * len(GAMES)} trajectories)", lines[-1]


@pytest.mark.skipif(not QJS_HOST.exists(), reason="qjs_host not built (native/build_qjs.sh)")
@pytest.mark.parametrize("game", GAMES)
def test_reference_vs_qjs_host_precompiled(game):
    assemble()
    side = json.loads((PRE / f"ps_{game}.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"]), "PLAYTRAIN_GAMES_DIR": str(PRE)}
    env.pop("PLAYTRAIN_ACTION_SPACE", None)
    proc = subprocess.run(["bash", str(REPO / "native" / "gate_qjs.sh"), f"ps_{game}", "300", "1", "42"], cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert proc.returncode == 0 and "GATE PASS" in proc.stdout, proc.stdout + proc.stderr
