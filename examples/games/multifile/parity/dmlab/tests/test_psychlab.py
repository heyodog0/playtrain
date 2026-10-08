"""G3 for psychlab (PLAN.md section 11): under the dumps' gaze-controller
actions, the port's view tracks DMLab's.

Gate: yaw and pitch within 1e-3 degrees on every frame of every seed (the view
accumulators' phases are replay inputs, games/<level>.replay.json, from
tools/compile_psychlab.py); the gaze on the screen within GAZE_BOUND of the
oracle's (DMLab's lookat, a muzzle-point trace, PROGRESS.md T8); and, for the
levels whose task is ported (TASKS), the rewards and the frames the screen's
widget set changes identical. A visual_search replay takes each trial's
objects from the oracle's screens (DMLab's Lua RNG drew them).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from jsrun import have_node, run_core

HERE = Path(__file__).resolve().parent.parent
DUMPS = HERE / 'reference' / 'dumps'
LEVELS = sorted(p.stem for p in (HERE / 'src' / 'levels').glob('psychlab_*.js'))
ANG_TOL = 1e-3
TASKS = {'psychlab_visual_search', 'psychlab_sequential_comparison'}
GAZE_BOUND = 1e-4       # screen widths; DMLab's lookat, muzzle-point trace (T8)

pytestmark = pytest.mark.skipif(not have_node(), reason='node not on PATH')

SNIPPET = r'''
const REPLAY = %(replay)s;
const JOBS = %(jobs)s;
const out = [];
for (const [seed, acts] of JOBS) {
  const st = createState();
  dmLoad(st, seed);
  const rp = REPLAY[String(seed)];
  st.phase = rp.yaw_phase / 512 * DM_U; st.n0 = dmYawCount(st);
  st.pphase = rp.pitch_phase / 512 * DM_U; st.pn0 = dmPitchCount(st);
  st.replayTrials = rp.trials || null;
  const rows = [];
  let names = '';
  for (const a of acts) {
    const r = dmFrame(st, DM_ACTIONS[a]);
    const now = st.psy.widgets.map((w) => w.name).sort().join(' ');
    rows.push([st.pitch, st.yaw, st.gaze[0], st.gaze[1], st.gaze[2], r, now !== names ? now : null]);
    names = now;
  }
  out.push(rows);
}
console.log(JSON.stringify(out));
'''


@pytest.mark.parametrize('level', LEVELS)
def test_view_tracks_the_oracle(level):
    files = sorted((DUMPS / level).glob('*.json'), key=lambda p: int(p.stem))
    if not files:
        pytest.skip('oracle dumps absent')
    dumps = [json.loads(f.read_text()) for f in files]
    trajs = [[r for r in d['trajectories']['gaze'] if 'rot' in r] for d in dumps]
    jobs = [[d['seed'], [r['a'] for r in t]] for d, t in zip(dumps, trajs)]
    replay = (HERE / 'games' / f'{level}.replay.json').read_text()
    got = run_core(level, SNIPPET % {'replay': replay, 'jobs': json.dumps(jobs)})
    failures, worst, total, n = [], 0.0, 0.0, 0
    for d, t, rows in zip(dumps, trajs, got):
        first = None
        # rewards and the frames the screen's widget set changes
        ev_o = [(r['f'], r['r']) for r in t if r.get('r')]
        ev_p = [(r['f'], row[5]) for r, row in zip(t, rows) if row[5]]
        wo, last = [], None
        for r in t:
            if 'widgets' in r:
                names = ' '.join(sorted(ln.split()[0] for ln in r['widgets'].split('\n') if ln.strip()))
                if names != last:
                    wo.append((r['f'], names))
                last = names
        wp = [(r['f'], row[6]) for r, row in zip(t, rows) if row[6] is not None]
        if level in TASKS and ev_o != ev_p:
            failures.append(f'seed {d["seed"]}: rewards {ev_o[:6]} vs port {ev_p[:6]}')
        if level in TASKS and wo != wp:
            k = next((i for i, (x, y) in enumerate(zip(wo, wp)) if x != y), min(len(wo), len(wp)))
            failures.append(f'seed {d["seed"]}: widgets differ at change {k}: oracle {wo[k:k + 2]} port {wp[k:k + 2]}')
        for r, (pitch, yaw, on, gx, gy, _, _) in zip(t, rows):
            ep = abs(pitch - r['rot'][0])
            ey = abs(((yaw - r['rot'][1]) + 180) % 360 - 180)
            if first is None and (ep > ANG_TOL or ey > ANG_TOL):
                first = (f'frame {r["f"]}: pitch {pitch:.6f} vs {r["rot"][0]:.6f}, '
                         f'yaw {yaw:.6f} vs {r["rot"][1]:.6f}')
            if on != r['gaze'][0]:
                failures.append(f'seed {d["seed"]} frame {r["f"]}: on-screen {on} vs {r["gaze"][0]}')
            e = max(abs(gx - r['gaze'][1]), abs(gy - r['gaze'][2]))
            worst = max(worst, e)
            total += e
            n += 1
        if first:
            failures.append(f'seed {d["seed"]}: {first}')
    print(f'{level}: gaze error mean {total / n:.5f} max {worst:.5f} screen widths over {n} frames')
    assert not failures, '\n'.join(failures[:20])
    assert worst < GAZE_BOUND, f'gaze error {worst:.5f} >= {GAZE_BOUND}'
