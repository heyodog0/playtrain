"""G6: QuickJS. (a) The reference's 770 tests pass through the bundle's engine under qjs_host: the flat script
run_reference_tests.mjs emits gets PlayTrain stubs whose getGameState() reports passed as `score` and failed +
errored as `lives` (qjs_host has no console; the trace line is the only output channel). (b) native/gate_qjs.sh:
V8 + wasm reference vs qjs_host, byte-identical trajectories and observation hashes, every bundle. Runs only when
native/build/qjs_host exists (skips otherwise, multifile README rule)."""
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import pytest
from conftest import FAMILY, REPO, node

HOST = REPO / "native" / "build" / "qjs_host"
GATE = REPO / "native" / "gate_qjs.sh"
DIST = FAMILY / "dist"
GAMES = sorted(p.stem for p in DIST.glob("ps_*.js"))
STUBS = ('\nfunction setup(){createCanvas(8,8);}\nfunction resetGame(s){}\nfunction draw(){background(0);}\n'
         'function getGameState(){return {score:passed,lives:failed+errored,gameState:"PLAYING"};}\n')

pytestmark = pytest.mark.skipif(not HOST.exists(), reason="qjs_host not built (native/build_qjs.sh)")


def test_corpus_size():
    assert len(GAMES) == 17


def test_770_reference_tests_pass_under_qjs_host():
    flat = Path(tempfile.mkdtemp(prefix="ps_qjs_")) / "ps_tests_flat.js"
    proc = node("tests/run_reference_tests.mjs", "--emit", str(flat))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    flat.write_text(flat.read_text() + STUBS)
    side = json.loads((DIST / "ps_microban.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"])}
    proc = subprocess.run([str(HOST), str(flat), "trace", "1", "1"], capture_output=True, text=True, env=env, timeout=1800)
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    m = re.search(r"reset seed=1 score=(\d+) lives=(\d+)", proc.stdout)
    assert m, proc.stdout[-1000:] + proc.stderr[-1000:]
    assert (int(m.group(1)), int(m.group(2))) == (770, 0), f"passed={m.group(1)} failed+errored={m.group(2)}"


@pytest.mark.parametrize("game", GAMES)
def test_reference_vs_qjs_host(game):
    side = json.loads((DIST / f"{game}.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"]), "PLAYTRAIN_GAMES_DIR": str(DIST)}
    env.pop("PLAYTRAIN_ACTION_SPACE", None)          # the reference takes the sidecar's table
    proc = subprocess.run(["bash", str(GATE), game, "300", "1", "42"], cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout
