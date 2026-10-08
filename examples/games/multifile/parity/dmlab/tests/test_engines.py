"""G4: V8 == QuickJS, 3 seeds x 3000 steps, observation hash included, every
bundle (native/gate_qjs.sh). The sidecar's action table is passed through
PLAYTRAIN_QJS_ACTIONS: without it qjs_host plays its default 8 actions."""
import json
import os
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parents[4]
DIST = HERE / 'dist'
BUNDLES = sorted(p.stem for p in DIST.glob('dmlab_*.js'))


@pytest.mark.parametrize('game', BUNDLES)
def test_v8_equals_quickjs(game):
    if not (REPO / 'native' / 'build' / 'qjs_host').exists():
        pytest.skip('library not built (run native/build_qjs.sh)')
    env = dict(os.environ)
    env['PLAYTRAIN_GAMES_DIR'] = str(DIST)
    env['PLAYTRAIN_QJS_ACTIONS'] = json.dumps(json.loads((DIST / f'{game}.json').read_text())['actions'])
    env.pop('PLAYTRAIN_RASTERIZER', None)
    p = subprocess.run(['./gate_qjs.sh', game, '3000'], cwd=REPO / 'native',
                       capture_output=True, text=True, env=env)
    assert p.returncode == 0 and 'GATE PASS' in p.stdout, p.stdout[-2000:] + p.stderr[-2000:]
