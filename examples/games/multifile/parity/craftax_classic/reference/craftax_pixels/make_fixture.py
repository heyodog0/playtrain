"""Append frames from a compare.py run to the committed fixture.

    uv run python .../make_fixture.py /tmp/night --seed 11 --every 6 --below 0.5
    uv run python .../make_fixture.py /tmp/night3 --seed 3 --frames 119

Takes DIR/craftax.npy (Craftax's own render, from render_craftax_batch.py)
and DIR/meta.json, and appends the selected frames — cast to uint8, which is
the target — to traces/craftax_pixels/reference_frames.{npz,json}, each
entry carrying the seed, the frame index, the light level, the driver seed
the run used and the state_rng derived from it. tests/test_render.py replays
the trajectory with that driver seed and checks byte identity; that needs
node, not JAX. --replace drops the seed's existing entries first.

Only frames that ARE byte-identical to ours are appended: the fixture
records verified agreement, and a disagreement belongs in a bug report, not
in the trace. Use --force to record one anyway (to pin a known gap).
"""
from __future__ import annotations
import argparse, json, pathlib
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
TRACES = HERE.parent.parent / 'traces' / 'craftax_pixels'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('dir', type=pathlib.Path)
    ap.add_argument('--seed', type=int, required=True, help='the --seed compare.py was run with')
    ap.add_argument('--every', type=int, default=1, help='take every Nth qualifying frame')
    ap.add_argument('--below', type=float, default=None, help='only frames with light < this')
    ap.add_argument('--at-least', type=float, default=None, help='only frames with light >= this')
    ap.add_argument('--frames', type=int, nargs='*', default=None, help='explicit frame indices')
    ap.add_argument('--sleeping', action='store_true', help='also take every sleeping frame that qualifies')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--replace', action='store_true', help="drop this seed's existing entries first")
    a = ap.parse_args()

    meta = json.loads((a.dir / 'meta.json').read_text())
    ours = np.load(a.dir / 'ours.npy')
    cx = np.load(a.dir / 'craftax.npy').astype(np.uint8)

    def qualifies(m):
        if a.below is not None and not m['light'] < a.below:
            return False
        if a.at_least is not None and not m['light'] >= a.at_least:
            return False
        return True

    if a.frames is not None:
        picked = list(a.frames)
    else:
        cand = [m['i'] for m in meta if qualifies(m)]
        picked = cand[::a.every]
        if a.sleeping:
            for i in cand:
                st = json.loads((a.dir / f'state_{i:03d}.json').read_text())
                if st['is_sleeping'] and i not in picked:
                    picked.append(i)
        picked.sort()

    ref = np.load(TRACES / 'reference_frames.npz')['frames']
    entries = json.loads((TRACES / 'reference_frames.json').read_text())
    if a.replace:
        keep = [k for k, e in enumerate(entries) if e['seed'] != a.seed]
        ref = ref[keep]
        entries = [entries[k] for k in keep]
    have = {(e['seed'], e['frame']) for e in entries}
    added = []
    for i in picked:
        if (a.seed, i) in have:
            continue
        if not np.array_equal(ours[i], cx[i]) and not a.force:
            raise SystemExit(f'frame {i} is not byte-identical to Craftax; not recording it')
        st = json.loads((a.dir / f'state_{i:03d}.json').read_text())
        entries.append({'seed': a.seed, 'frame': i, 'light': meta[i]['light'],
                        'timestep': meta[i]['timestep'], 'driver_seed': meta[i]['driver_seed'],
                        'state_rng': meta[i]['state_rng'],
                        'sleeping': bool(st['is_sleeping']), 'health': int(st['health'])})
        added.append(cx[i])
    if not added and not a.replace:
        print('nothing new to add')
        return 0
    if not added:
        frames = ref
    else:
        frames = np.concatenate([ref, np.stack(added)])
    np.savez_compressed(TRACES / 'reference_frames.npz', frames=frames)
    (TRACES / 'reference_frames.json').write_text(json.dumps(entries, indent=1) + '\n')
    print(f'added {len(added)} frames from seed {a.seed}: {[e["frame"] for e in entries[-len(added):]]}')
    print(f'fixture now holds {len(entries)} frames')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
