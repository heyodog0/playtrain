"""G2: the port's grid equals the dump's layout and variation for every
(level, seed): walls, floors, the texture each cell gets from its maze
variation, decals, spawn and goal (PLAN.md section 4, exact)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from jsrun import have_node, run_core

HERE = Path(__file__).resolve().parent.parent
DUMPS = HERE / 'reference' / 'dumps'
LEVELS = sorted(p.stem for p in (Path(__file__).resolve().parent.parent / 'src' / 'levels').glob('explore_*.js'))
NONE = 0xFFFF

sys.path.insert(0, str(HERE / 'tools'))
import dmlab_atlas  # noqa: E402

pytestmark = pytest.mark.skipif(not have_node(), reason='node not on PATH')


def _atlas(level):
    _, names = dmlab_atlas.build(level)
    return {n: i for i, n in enumerate(names)}


@pytest.mark.parametrize('level', LEVELS)
def test_compiled_data_is_fresh(level):
    if not (HERE / 'reference' / 'dumps' / level).is_dir():
        pytest.skip('oracle dumps absent')   # the compiled data is built from them
    r = subprocess.run([sys.executable, str(HERE / 'tools' / 'compile_level.py'), level, '--check'],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize('level', LEVELS)
def test_port_grid_equals_dump(level):
    files = sorted((DUMPS / level).glob('*.json'), key=lambda p: int(p.stem))
    if not files:
        pytest.skip('oracle dumps absent')
    idx = _atlas(level)
    # What the GAME loads, read back from the game's own state after dmLoad.
    got = run_core(level, '''
const out = [];
for (let s = 0; s < DM_LEVEL.seeds.length; s++) {
  const st = createState(); dmLoad(st, s);
  const m = st.maze;
  out.push({rows: m.rows, wall: m.wall, floor: m.floor, decals: m.decals,
            x: st.x, y: st.y, yaw: st.yaw, goal: m.goal,
            items: st.items.map((it) => [it[0], it[1], m.cats[it[2]][3]]), doors: st.doors});
}
console.log(JSON.stringify(out));''')
    assert len(got) == len(files)
    for f, g in zip(files, got):
        d = json.loads(f.read_text())
        s = d['start']
        rows = s['layout'].rstrip('\n').split('\n')
        vrows = s['variation'].rstrip('\n').split('\n')
        assert g['rows'] == rows, (level, d['seed'], 'layout')
        var = {}
        decals = 0
        for line in s['theme'].split('\n'):
            m = re.match(r'V (\S+) floor=(\S+) ceiling=(\S+) wall=(\S+)', line)
            if m:
                var[m.group(1)] = (m.group(2), m.group(4))
            elif line.startswith('D '):
                decals += 1
        W = len(rows[0])
        for r, row in enumerate(rows):
            for c, ch in enumerate(row):
                i = r * W + c
                v = vrows[r][c]
                if ch != '*':
                    want = idx[var['default' if v == '.' else v][0]]
                    assert g['floor'][i] == want, (level, d['seed'], r, c, 'floor')
                else:
                    assert g['wall'][i] != NONE, (level, d['seed'], r, c, 'wall tile')
        assert len(g['decals']) == decals, (level, d['seed'], 'decals')
        assert [g['x'], g['y']] == [float(v) for v in s['pos'][:2]], (level, d['seed'], 'spawn')
        assert g['yaw'] == s['rot'][1], (level, d['seed'], 'spawn yaw')
        ents = [e.split('|', 1)[1].split(' ') for e in s['entities'].split(';') if e.startswith('1|')]
        goals = [e for e in ents if e[0] == 'goal']
        if goals:
            assert g['goal'][:2] == [float(goals[0][1]), float(goals[0][2])], (level, d['seed'], 'goal')
        else:
            assert g['goal'] is None, (level, d['seed'], 'goal')
        # Items: positions and rewards (apples 1; pickups their category's).
        q = {'apple_reward': 1.0}
        for line in s.get('pickups', '').split('\n'):
            if line.strip():
                q[line.split(' ')[0]] = float(dict(x.split('=', 1) for x in line.split(' ')[1:])['quantity'])
        want_items = sorted([float(e[1]), float(e[2]), q[e[0]]] for e in ents if e[0] in q)
        assert sorted(g['items']) == want_items, (level, d['seed'], 'items')
        # Doors: cell from targetname door_<col>_<row from bottom>; spawnflags 1 = open.
        # door entities have no origin: their last two fields are targetname, spawnflags
        want_doors = sorted([len(rows) - 1 - int(e[-2].split('_')[2]), int(e[-2].split('_')[1]),
                             1 if e[-1] == '1' else 0] for e in ents if e[0] == 'func_door')
        assert sorted(g['doors']) == want_doors, (level, d['seed'], 'doors')
        for r, c, _ in want_doors:
            assert rows[r][c] in 'HI', (level, d['seed'], r, c, 'door cell')
