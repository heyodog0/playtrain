"""G3: under the dumps' scripted actions the port tracks DMLab.

PLAN.md section 4, fixed tolerances: yaw per frame within 1e-3 degrees;
position per frame within 2.0 game units over the 300 frames; the sequence of
cells entered identical; the sequence of (reward, event) identical.

The oracle's engine timing (msec per frame), its yaw quantisation phase and
its respawn poses are replay INPUTS (games/<level>.replay.json, from
tools/compile_level.py): they are not functions of the agent's actions, and
PROGRESS.md (U04) records how each was measured.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from jsrun import have_node, run_core

HERE = Path(__file__).resolve().parent.parent
DUMPS = HERE / 'reference' / 'dumps'
# psychlab has its own G3 (tests/test_psychlab.py): no walk, gaze trajectories
LEVELS = sorted(p.stem for p in (Path(__file__).resolve().parent.parent / 'src' / 'levels').glob('*.js')
                if not p.stem.startswith('psychlab_'))
YAW_TOL = 1e-3
POS_TOL = 2.0
U = 360.0 / 65536.0

pytestmark = pytest.mark.skipif(not have_node(), reason='node not on PATH')

SNIPPET = r'''
const REPLAY = %(replay)s;
const JOBS = %(jobs)s;
const out = [];
for (const [seed, kind, acts] of JOBS) {
  const st = createState();
  dmLoad(st, seed);
  const rp = REPLAY[String(seed)][kind];
  st.replayMsec = rp.msec;
  st.replayRespawns = rp.respawns;
  st.replayTeleports = rp.teleports || null;
  st.phase = rp.yaw_phase / 512 * DM_U;
  st.n0 = dmYawCount(st);
  const rows = [];
  for (const a of acts) {
    const r = dmFrame(st, DM_ACTIONS[a]);
    // a language map is laid out shifted (tools/compile_level.py lang_pad)
    const sh = st.maze.shift || [0, 0];
    rows.push([st.x - sh[0], st.y - sh[1], st.yaw, r]);
  }
  out.push(rows);
}
console.log(JSON.stringify(out));
'''


def _cell(m_h, x, y):
    return (m_h - 1 - math.floor(y / 100.0), math.floor(x / 100.0))


@pytest.mark.parametrize('level', LEVELS)
def test_trajectories_track_the_oracle(level):
    files = sorted((DUMPS / level).glob('*.json'), key=lambda p: int(p.stem))
    if not files:
        pytest.skip('oracle dumps absent')
    replay = (HERE / 'games' / f'{level}.replay.json').read_text()
    dumps = [json.loads(f.read_text()) for f in files]
    jobs = [[d['seed'], k, [r['a'] for r in d['trajectories'][k]]] for d in dumps for k in ('script', 'impala')]
    got = run_core(level, SNIPPET % {'replay': replay, 'jobs': json.dumps(jobs)})
    failures = []
    worst_pos = 0.0
    for (seed, kind, _), rows in zip(jobs, got):
        d = dumps[seed]
        traj = d['trajectories'][kind]
        H = len(d['start']['layout'].rstrip('\n').split('\n'))
        cells_o, cells_p, ev_o, ev_p = [], [], [], []
        first = None
        for r, (x, y, yaw, rew) in zip(traj, rows):
            if 'pos' not in r:
                break
            ox, oy = r['pos'][0], r['pos'][1]
            e = math.hypot(x - ox, y - oy)
            worst_pos = max(worst_pos, e)
            ye = abs(((yaw - r['rot'][1]) + 180) % 360 - 180)
            co, cp = _cell(H, ox, oy), _cell(H, x, y)
            if not cells_o or cells_o[-1] != co:
                cells_o.append(co)
            if not cells_p or cells_p[-1] != cp:
                cells_p.append(cp)
            if r.get('r'):
                ev_o.append((r['f'], r['r']))
            if rew:
                ev_p.append((r['f'], rew))
            if first is None and (e > POS_TOL or ye > YAW_TOL):
                first = (f'frame {r["f"]}: pos err {e:.3f} (oracle {ox:.3f},{oy:.3f} port {x:.3f},{y:.3f}) '
                         f'yaw err {ye:.2e} (oracle {r["rot"][1]:.6f} port {yaw:.6f})')
        if first:
            failures.append(f'{level} seed {seed} {kind}: {first}')
        if cells_o != cells_p:
            failures.append(f'{level} seed {seed} {kind}: cells entered differ')
        if ev_o != ev_p:
            failures.append(f'{level} seed {seed} {kind}: rewards {ev_o} vs port {ev_p}')
    assert not failures, f'{len(failures)} of {len(jobs)} trajectories fail; worst pos {worst_pos:.3f}\n' + '\n'.join(failures)
