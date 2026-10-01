"""Cross-engine determinism: the V8 + wasm reference and the QuickJS host produce
byte-identical trajectories and observation hashes for the bundles. Runs only
when native/build/qjs_host exists (skips otherwise, multifile README rule)."""
import json
import os
import subprocess

import pytest
from conftest import REPO

HOST = REPO / "native" / "build" / "qjs_host"
GATE = REPO / "native" / "gate_qjs.sh"


@pytest.mark.skipif(not HOST.exists(), reason="qjs_host not built (native/build_qjs.sh)")
@pytest.mark.parametrize("game", ["vgdl_aliens", "vgdl_vgfmri3_zelda", "vgdl_portals"])
def test_reference_vs_qjs_host(game):
    spaces = json.loads((REPO / "runtime" / "action_spaces.json").read_text())
    env = {**os.environ,
           "PLAYTRAIN_ACTION_SPACE": "vgdl6",
           "PLAYTRAIN_QJS_ACTIONS": json.dumps(spaces["vgdl6"]),
           "PLAYTRAIN_GAMES_DIR": str(REPO / "examples" / "games" / "multifile" / "parity" / "vgdl" / "dist")}
    proc = subprocess.run(["bash", str(GATE), game, "300", "1", "42"], cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert proc.returncode == 0, proc.stdout + proc.stderr
