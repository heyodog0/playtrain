"""G0: the oracle dumps exist for every (level, seed) and carry every field
PLAN.md section 4 names; their hashes match manifest.json."""
import base64
import hashlib
import io
import json
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
DUMPS = HERE / 'reference' / 'dumps'
SEEDS = range(32)
FRAMES = 300
MAN = json.loads((HERE / 'manifest.json').read_text())
LEVELS = sorted(MAN['reference'].get('dumps', {}))


def _load(level, seed):
    p = DUMPS / level / f'{seed}.json'
    if not p.exists():
        pytest.skip('oracle dumps absent')
    return p


def test_some_level_is_dumped():
    if not DUMPS.exists():
        pytest.skip('oracle dumps absent')
    assert LEVELS, 'manifest.json lists no dumped level'


@pytest.mark.parametrize('level', LEVELS)
def test_corpus_complete_and_hashed(level):
    want = MAN['reference']['dumps'][level]
    assert sorted(int(s) for s in want) == list(SEEDS)
    for seed in SEEDS:
        p = _load(level, seed)
        assert hashlib.sha256(p.read_bytes()).hexdigest() == want[str(seed)], (level, seed)


def _psychlab_fields(level, seed, d):
    """Psychlab dumps (reference/oracle/dump_psychlab.py): no maze; a gaze
    trajectory, the screens it showed, 8 frames."""
    from PIL import Image
    s = d['start']
    assert len(s['pos']) == 3 and len(s['rot']) == 3 and len(s['eye']) == 3
    assert s['screen'] in d['screens'] and len(s['screen_size']) == 2
    assert len(d['action_set']) == 11, 'IMPALA 9 + look up/down'
    t = d['trajectories']['gaze']
    assert 0 < len(t) <= 3000 and [r['f'] for r in t] == list(range(len(t))), (seed, 'frame numbers')
    for r in t:
        if r.get('ended'):
            continue
        assert 'a' in r and 'r' in r and 0 <= r['a'] < 11
        if 'gaze' in r:
            assert len(r['gaze']) == 3 and len(r['rot']) == 3
        if 'screen' in r:
            assert r['screen'] in d['screens'], (seed, r['f'])
    assert sum(1 for r in t if 'widgets' in r and 'fixation' in r['widgets']) > 1, (seed, 'no trial completed')
    assert len(d['frames']) == 8
    for f in d['frames']:
        assert f['screen'] in d['screens']
        im = Image.open(io.BytesIO(base64.b64decode(f['png'])))
        assert im.size == (64, 64) and im.mode == 'RGB'


@pytest.mark.parametrize('level', LEVELS)
def test_dump_fields(level):
    from PIL import Image
    for seed in SEEDS:
        d = json.loads(_load(level, seed).read_text())
        assert d['level'] == level and d['seed'] == seed
        assert d['theme'], 'theme missing'
        if level.startswith('psychlab_'):
            _psychlab_fields(level, seed, d)
            continue
        s = d['start']
        rows = s['layout'].rstrip('\n').split('\n')
        vrows = s['variation'].rstrip('\n').split('\n')
        assert len(rows) == len(vrows) and all(len(a) == len(b) for a, b in zip(rows, vrows))
        assert 'info_player_start' in s['entities'], 'spawn missing'
        assert len(s['pos']) == 3 and len(s['rot']) == 3 and len(s['eye']) == 3
        assert s['eye'][2] > s['pos'][2], 'eye z not above feet'
        if level.startswith('explore_goal'):
            assert 'goal' in s['entities'] and 'G' in s['layout']
        if level.startswith('language_'):
            assert s['instr'], (seed, 'instruction missing')
        for kind in ('script', 'impala'):
            t = d['trajectories'][kind]
            # all 300 frames, or up to the frame DMLab ended the episode on
            # (skymaze: the goal reached), marked by a final 'ended' record
            ended = [i for i, r in enumerate(t) if r.get('ended')]
            assert len(t) == FRAMES if not ended else ended == [len(t) - 1] and len(t) <= FRAMES, (seed, kind, len(t))
            assert [r['f'] for r in t] == list(range(len(t))), (seed, kind, 'frame numbers')
            for i, r in enumerate(t):
                if r.get('ended'):
                    continue
                if ended and i == len(t) - 2 and 'pos' not in r:
                    assert 'r' in r, (seed, kind, i)   # the step that ended it: no observations after
                    continue
                assert len(r['pos']) == 3 and len(r['rot']) == 3 and 'r' in r
        assert len(d['frames']) == 8
        for f in d['frames']:
            im = Image.open(io.BytesIO(base64.b64decode(f['png'])))
            assert im.size == (64, 64) and im.mode == 'RGB'
