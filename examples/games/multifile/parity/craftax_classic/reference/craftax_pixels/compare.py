"""Compare our rendered frames against Craftax's, over a real trajectory.

Exports N states from the C reference together with our frames for the same
trajectory; a second script renders those states through Craftax's own pixel
renderer; then `--diff` reports the result.

    uv run python .../compare.py --seed 11 --steps 220 --driver-seed 7 --out /tmp/night
    # then, in a venv with craftax installed (see README.md):
    uv run python .../render_craftax_batch.py /tmp/night
    # back here:
    uv run python .../compare.py --diff /tmp/night

Night frames. Craftax's static below light_level 0.5 is drawn from
`state.state_rng`, which its step derives from the DRIVER's key and the
step index alone (README.md). So both sides get the same driver seed and
nothing else: our game derives state_rng itself (setDriverSeed, then
nightTick per step), and render_craftax_batch.py derives it with JAX's own
split from the same seed. meta.json records the driver seed and, for the
record, the key our JS derived per frame; the JAX side checks it agrees.
Because no host can carry a driver seed, our frames come from
tests/jsrender.py: the same JS, run in node with a rasterizer stub. The stub
is checked here against PlayTrainEnv on every daylight frame of the
trajectory, so the comparison is still against what the shipped bundle
draws.

Handles the one-NOOP offset: GameEnv.reset() ticks draw() once before the
first env.step(), so a PlayTrain episode is the C's episode with a NOOP
prepended (see the manifest's not_matched).
"""
from __future__ import annotations
import argparse, json, struct, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "tests"))

from ccref import layout, parse_run, run as crun          # noqa: E402
from jsrender import render_frames                         # noqa: E402


def diff(out: pathlib.Path) -> int:
    """ours.npy vs craftax.npy (cast to uint8), split by light level."""
    import numpy as np
    meta = json.loads((out / 'meta.json').read_text())
    ours = np.load(out / 'ours.npy')
    cx = np.load(out / 'craftax.npy')
    if cx.dtype != np.uint8:
        cx = cx.astype(np.uint8)
    n = min(len(ours), len(cx), len(meta))
    day = night = day_ok = night_ok = 0
    worst = None
    for i in range(n):
        same = np.array_equal(ours[i], cx[i])
        if meta[i]['light'] >= 0.5:
            day += 1; day_ok += same
        else:
            night += 1; night_ok += same
        if not same:
            d = np.abs(ours[i].astype(int) - cx[i].astype(int)).sum(axis=2) > 0
            ys, xs = np.nonzero(d)
            print(f"frame {i} light {meta[i]['light']:.3f} key {meta[i]['state_rng']}: "
                  f"{int(d.sum())} px differ, first ({ys[0]}, {xs[0]}) "
                  f"ours {ours[i][ys[0], xs[0]].tolist()} craftax {cx[i][ys[0], xs[0]].tolist()}")
            worst = i
    print(f"{n} frames: daylight {day_ok}/{day} byte-identical, night {night_ok}/{night} byte-identical")
    return 0 if worst is None else 1

FMT = {'u8': 'B', 'i8': 'b', 'i16': 'h', 'i32': 'i', 'u32': 'I', 'f32': 'f'}
INV_NAMES = ['wood', 'stone', 'coal', 'iron', 'diamond', 'sapling',
             'wood_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
             'wood_sword', 'stone_sword', 'iron_sword']


def to_json(blob, idx):
    def g(name):
        off, size, typ, count = idx[name]
        v = struct.unpack_from('<' + FMT[typ] * count, blob, off)
        return list(v) if count > 1 else v[0]

    mob = g('mob_bits')
    mob_map = [[(((mob[2 * r + 1] << 32) | mob[2 * r]) >> c) & 1 for c in range(64)]
               for r in range(64)]

    def pairs(rk, ck, n):
        r, c = g(rk), g(ck)
        r = r if isinstance(r, list) else [r]
        c = c if isinstance(c, list) else [c]
        return [[r[i], c[i]] for i in range(n)]

    inv = g('inv')
    return {
        'map': g('map_packed'), 'mob_map': mob_map,
        'player_position': [g('player_r'), g('player_c')],
        'player_direction': g('player_dir'),
        'health': g('health'), 'food': g('food'), 'drink': g('drink'),
        'energy': g('energy'), 'is_sleeping': bool(g('is_sleeping')),
        'recover': g('recover'), 'hunger': g('hunger'),
        'thirst': g('thirst'), 'fatigue': g('fatigue'),
        'inventory': {INV_NAMES[i]: inv[i] for i in range(12)},
        'zombies': {'pos': pairs('zombie_r', 'zombie_c', 3), 'hp': g('zombie_hp'),
                    'mask': [bool(x) for x in g('zombie_mask')], 'cd': g('zombie_cd')},
        'cows': {'pos': pairs('cow_r', 'cow_c', 3), 'hp': g('cow_hp'),
                 'mask': [bool(x) for x in g('cow_mask')], 'cd': [0, 0, 0]},
        'skeletons': {'pos': pairs('skel_r', 'skel_c', 2), 'hp': g('skel_hp'),
                      'mask': [bool(x) for x in g('skel_mask')], 'cd': g('skel_cd')},
        'arrows': {'pos': pairs('arrow_r', 'arrow_c', 3), 'hp': [0, 0, 0],
                   'mask': [bool(x) for x in g('arrow_mask')], 'cd': [0, 0, 0]},
        'arrow_directions': pairs('arrow_dr', 'arrow_dc', 3),
        'plant_pos': pairs('plant_r', 'plant_c', 10),
        'plant_age': g('plant_age'),
        'plant_mask': [bool(x) for x in g('plant_mask')],
        'light_level': g('light_level'),
        'achievements': [bool(x) for x in g('achievements')],
        'timestep': g('timestep'),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--steps', type=int, default=60)
    ap.add_argument('--driver-seed', type=int, default=7,
                    help="Craftax's driver PRNGKey seed; both sides derive state_rng from it")
    ap.add_argument('--out', type=pathlib.Path)
    ap.add_argument('--diff', type=pathlib.Path, metavar='DIR',
                    help='compare DIR/ours.npy with DIR/craftax.npy and exit')
    a = ap.parse_args()
    if a.diff is not None:
        return diff(a.diff)
    if a.out is None:
        ap.error('--out is required')
    a.out.mkdir(parents=True, exist_ok=True)

    import numpy as np
    from playtrain.runtime import PlayTrainEnv

    actions = [(i * 5 + 2) % 17 for i in range(a.steps)]

    # The C runs the same trajectory with the reset tick's NOOP prepended.
    path = a.out / 'actions.bin'
    path.write_bytes(bytes([0] + actions))
    rows, _ = layout()
    idx = {r[4]: (r[0], r[1], r[2], r[3]) for r in rows}
    steps = parse_run(crun('run', str(a.seed), str(path), '--dump-every', '1')).steps

    # What the shipped bundle draws, through a real host. No key can reach
    # it, so these are the no-static frames; they anchor the stub below.
    env = PlayTrainEnv(game='craftax_classic', obs_size=64, max_steps=10000)
    try:
        obs, _ = env.reset(seed=a.seed)
        host = [obs[:63, :63].copy()]
        for act in actions:
            o, _, term, trunc, _ = env.step(int(act))
            host.append(o[:63, :63].copy())
            if term or trunc:
                break
    finally:
        env.close()

    n = min(len(host), len(steps))
    frames, keys = render_frames(a.seed, actions[:n - 1], a.driver_seed)
    assert len(frames) == n, (len(frames), n)

    meta = []
    for i in range(n):
        st = to_json(steps[i].state, idx)
        (a.out / f'state_{i:03d}.json').write_text(json.dumps(st))
        meta.append({'i': i, 'light': st['light_level'], 'timestep': st['timestep'],
                     'driver_seed': a.driver_seed, 'state_rng': keys[i]})
        # The stub must draw exactly what the host draws wherever the key
        # cannot matter. Any difference here is a harness bug, not a finding.
        if st['light_level'] >= 0.5 and not np.array_equal(frames[i], host[i]):
            raise SystemExit(f'frame {i}: node stub differs from PlayTrainEnv at light '
                             f'{st["light_level"]:.3f} — the harness is not faithful')
    np.save(a.out / 'ours.npy', frames)
    np.save(a.out / 'ours_host.npy', np.stack(host[:n]))
    (a.out / 'meta.json').write_text(json.dumps(meta, indent=1))
    print(f'{n} frames + states -> {a.out}')
    day = sum(1 for m in meta if m['light'] >= 0.5)
    print(f'  {day} at light >= 0.5, {n - day} below (state_rng derived from driver seed {a.driver_seed})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
