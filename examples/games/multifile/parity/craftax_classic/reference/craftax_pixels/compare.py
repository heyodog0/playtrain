"""Compare our rendered frames against Craftax's, over a real trajectory.

Exports N states from the C reference, renders each through Craftax's own
pixel renderer, and diffs against what PlayTrainEnv produces for the same
trajectory.

    uv run python .../compare.py --seed 3 --steps 60 --out /tmp/cmp
    # then, in a venv with craftax installed:
    uv run python .../render_craftax.py /tmp/cmp/state_XX.json

Handles the one-NOOP offset: GameEnv.reset() ticks draw() once before the
first env.step(), so a PlayTrain episode is the C's episode with a NOOP
prepended (see the manifest's not_matched).
"""
from __future__ import annotations
import argparse, json, struct, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "tests"))

from ccref import layout, parse_run, run as crun          # noqa: E402

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
    ap.add_argument('--out', type=pathlib.Path, required=True)
    a = ap.parse_args()
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

    env = PlayTrainEnv(game='craftax_classic', obs_size=64, max_steps=10000)
    try:
        obs, _ = env.reset(seed=a.seed)
        frames = [obs[:63, :63].copy()]
        for act in actions:
            o, _, term, trunc, _ = env.step(int(act))
            frames.append(o[:63, :63].copy())
            if term or trunc:
                break
    finally:
        env.close()

    n = min(len(frames), len(steps))
    meta = []
    for i in range(n):
        st = to_json(steps[i].state, idx)
        (a.out / f'state_{i:03d}.json').write_text(json.dumps(st))
        meta.append({'i': i, 'light': st['light_level'], 'timestep': st['timestep']})
    np.save(a.out / 'ours.npy', np.stack(frames[:n]))
    (a.out / 'meta.json').write_text(json.dumps(meta, indent=1))
    print(f'{n} frames + states -> {a.out}')
    day = sum(1 for m in meta if m['light'] >= 0.5)
    print(f'  {day} at light >= 0.5 (reproducible), {n - day} below (RNG static)')


if __name__ == '__main__':
    main()
