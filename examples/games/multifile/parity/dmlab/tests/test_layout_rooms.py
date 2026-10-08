"""G2 for the rooms family: what the game loads for every (level, seed)
equals the dump - the map DMLab loaded (and its config), the spawn pose, and
every pickup with its reward - and the map's geometry is the .map source's."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from jsrun import have_node, run_core

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / 'tools'))
import compile_level as cl  # noqa: E402
import compile_rooms as cr  # noqa: E402

LEVELS = sorted(l for l in cr.LEVELS if (HERE / 'src' / 'levels' / f'{l}.js').exists())
pytestmark = pytest.mark.skipif(not have_node(), reason='node not on PATH')


@pytest.mark.parametrize('level', LEVELS)
def test_compiled_data_is_fresh(level):
    if not (HERE / 'reference' / 'dumps' / level).is_dir():
        pytest.skip('oracle dumps absent')   # the compiled data is built from them
    r = subprocess.run([sys.executable, str(HERE / 'tools' / 'compile_rooms.py'), level, '--check'],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize('level', LEVELS)
def test_port_level_equals_dump(level):
    files = sorted((HERE / 'reference' / 'dumps' / level).glob('*.json'), key=lambda p: int(p.stem))
    if not files:
        pytest.skip('oracle dumps absent')
    got = run_core(level, '''
const out = [];
for (let s = 0; s < DM_LEVEL.seeds.length; s++) {
  const st = createState(); dmLoad(st, s);
  const m = st.maze;
  out.push({map: m.map, x: st.x, y: st.y, z: st.z, yaw: st.yaw, nboxes: m.nBoxes,
            items: st.items.map((it) => [it[0], it[1], m.cats[it[2]][3]]), cfg: m.config,
            rows: m.rows, tops: m.tops || null, platform: m.platform || null, npolys: (DM_LEVEL.maps && DM_LEVEL.maps[m.map] && DM_LEVEL.maps[m.map].polys || []).length, vz: st.vz, air: st.air, doors: st.doors.map((d, k) => [d[0], d[1], m.door_colours ? m.door_colours[k] : null])});
}
console.log(JSON.stringify(out));''')
    assert len(got) == len(files)
    for f, g in zip(files, got):
        d = json.loads(f.read_text())
        s = d['start']
        if cr.LEVELS[level]['kind'] == 'sky':
            # the text map DMLab built, its platform heights (20 units per
            # letter below 'a' at 800), the spawn pose, the goal and its +100
            rows = s['layout'].rstrip('\n').split('\n')
            assert g['rows'] == rows, (level, d['seed'], 'rows')
            want_t = [-1.0 if ch == '.' else 800.0 - 20.0 * (ord(ch) - ord('a')) for r in rows for ch in r]
            assert g['tops'] == want_t, (level, d['seed'], 'tops')
            assert [g['x'], g['y'], g['z']] == [float(v) for v in s['pos']], (level, d['seed'], 'spawn')
            assert g['yaw'] == s['rot'][1], (level, d['seed'], 'yaw')
            goals = [e for e in cl.entities(s['entities']) if e['start'] == 1 and e['class'] == 'goal']
            assert len(goals) == 1 and g['items'] == [[goals[0]['x'], goals[0]['y'], 100.0]], (level, d['seed'], 'goal')
            continue
        if cr.LEVELS[level]['kind'] == 'water':
            # the map, the spawn pose (a spawn above the glass still falling),
            # the platform where the factory put it, and the arena's walls
            assert g['map'] == cr.config(d)['map'] == 'em_watermaze', (level, d['seed'], 'map')
            assert [g['x'], g['y'], g['z']] == [float(v) for v in s['pos']], (level, d['seed'], 'spawn')
            assert g['yaw'] == s['rot'][1], (level, d['seed'], 'yaw')
            plat = [e for e in cl.entities(s['entities']) if e['start'] == 1 and e['class'] == 'func_plat']
            assert len(plat) == 1 and g['platform'] == [plat[0]['x'], plat[0]['y']], (level, d['seed'], 'platform')
            assert g['air'] == (s['pos'][2] > 40.375), (level, d['seed'], 'air')
            import mapsrc
            ents_m, brushes = mapsrc.parse_planes((cr.ASSETS / 'maps' / 'em_watermaze.map').read_text())
            walls = [b for b in brushes if ents_m[b['entity']].get('classname') == 'worldspawn'
                     and {f[2] for f in b['faces']} == {'map/lab_games/lg_style_01_wall_blue'}]
            assert len(walls) == 16 and g['npolys'] == 16, (level, d['seed'], 'walls')
            continue
        cfg = cr.config(d)
        made = cr.created(d)
        ents = [e for e in cl.entities(s['entities']) if e['start'] == 1]
        want = sorted([e['x'], e['y'], made[e['class']][2]] for e in ents if e['class'] in made)
        assert sorted(g['items']) == want, (level, d['seed'], 'items')
        assert [g['x'], g['y'], g['z']] == [float(v) for v in s['pos']], (level, d['seed'], 'spawn')
        if cr.LEVELS[level]['kind'] == 'keys':
            # the generated text map, its fence doors and their colours
            lines = s['map'].split('\n')
            rows = []
            for ln in lines[1:]:
                if not ln.strip():
                    break
                rows.append(ln)
            assert g['rows'] == rows, (level, d['seed'], 'rows')
            colours = dict(ln.split(' ')[1:3] for ln in lines if ln.startswith('DOORCOLOR '))
            H = len(rows)
            want_d = sorted([H - 1 - int(n.split('_')[2]), int(n.split('_')[1]), c] for n, c in colours.items())
            assert sorted(g['doors']) == want_d, (level, d['seed'], 'doors')
            for r, c, _ in want_d:
                assert rows[r][c] in 'HI', (level, d['seed'], r, c)
            continue
        assert g['map'].split('+')[0] == cfg['map'], (level, d['seed'], 'map')
        assert g['map'].endswith('+replace') == bool(cfg.get('replaceWallAndFloor')), (level, d['seed'], 'replace')
        assert [g['x'], g['y'], g['z']] == [float(v) for v in s['pos']], (level, d['seed'], 'spawn')
        assert g['yaw'] == s['rot'][1], (level, d['seed'], 'yaw')
        made = cr.created(d)
        ents = [e for e in cl.entities(s['entities']) if e['start'] == 1]
        want = sorted([e['x'], e['y'], made[e['class']][2]] for e in ents if e['class'] in made)
        assert sorted(g['items']) == want, (level, d['seed'], 'items')
        # geometry: every world brush of the .map is a box
        import mapsrc
        ents_m, brushes, bad = mapsrc.parse((cr.ASSETS / 'maps' / f"{cfg['map']}.map").read_text())
        world = [b for b in brushes if ents_m[b['entity']].get('classname') == 'worldspawn']
        doors = [b for b in brushes if ents_m[b['entity']].get('classname') == 'func_door']
        assert bad == 0 and g['nboxes'] == len(world) + len(doors), (level, d['seed'], 'boxes')


@pytest.mark.skipif('rooms_watermaze' not in LEVELS, reason='oracle dumps absent')
def test_watermaze_platform_cycle():
    """The platform's cycle as the oracle probe measured it
    (reference/oracle/probe_watermaze.py, seed 0, walked onto from 200 west):
    held 6 frames after the box first touches the button, +1 ten frames
    later, then every 1000 ms (62 or 63 frames), five in all, and the map
    restarts one period after the fifth, away from the platform."""
    got = run_core('rooms_watermaze', '''
const st = createState(); dmLoad(st, 0);
const P = st.maze.platform;
dmPlace(st, P[0] - 200, P[1], 0);
const rows = [];
for (let f = 0; f < 600; f++) {
  const r = dmFrame(st, f < 60 ? DM_ACTIONS[0] : DM_NOOP);
  rows.push([r, st.x, st.y, st.z, st.wmArm, st.wmHold]);
}
console.log(JSON.stringify({rows, P}));''')
    rows, P = got['rows'], got['P']
    rew = [f for f, r in enumerate(rows) if r[0]]
    arm = next(f for f, r in enumerate(rows) if r[4] >= 0)
    hold = next(f for f, r in enumerate(rows) if r[5] >= 0)
    assert hold == arm + 6
    assert rew[0] == hold + 10 and len(rew) == 5
    assert all(b - a in (62, 63) for a, b in zip(rew, rew[1:]))
    assert rows[hold + 19][3] == 118.125
    assert abs(rows[hold][1] - P[0]) < 1e-3 and abs(rows[hold][2] - P[1]) < 1e-3
    back = next(f for f in range(rew[-1] + 1, 600) if abs(rows[f][1] - P[0]) > 1)
    assert back - rew[-1] in (62, 63) and rows[back][3] == 40.125
