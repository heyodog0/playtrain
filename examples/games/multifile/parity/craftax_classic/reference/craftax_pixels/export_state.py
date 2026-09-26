"""Export one of our canonical states as JSON for the Craftax bridge."""
import sys, json, struct
sys.path.insert(0, 'examples/games/multifile/parity/craftax_classic/tests')
from ccref import layout, parse_run, run as crun, GAME

seed = int(sys.argv[1]); nsteps = int(sys.argv[2]); out = sys.argv[3]
rows, total = layout()
idx = {r[4]: (r[0], r[1], r[2], r[3]) for r in rows}

import tempfile, pathlib
acts = bytes((i * 5 + 2) % 17 for i in range(nsteps))
p = pathlib.Path(tempfile.mkdtemp()) / 'a.bin'; p.write_bytes(acts)
steps = parse_run(crun("run", str(seed), str(p), "--dump-every", "1")).steps
blob = steps[-1].state if nsteps else crun("world", str(seed))

FMT = {'u8':'B','i8':'b','i16':'h','i32':'i','u32':'I','f32':'f'}
def g(name):
    off, size, typ, count = idx[name]
    v = struct.unpack_from('<' + FMT[typ]*count, blob, off)
    return list(v) if count > 1 else v[0]

mp = g('map_packed')
# mob_map: the combined occupancy bitmap, as a 64x64 bool grid
mob_words = g('mob_bits')
mob_map = [[(((mob_words[2*r+1] << 32) | mob_words[2*r]) >> c) & 1 for c in range(64)] for r in range(64)]

def pairs(rk, ck, n):
    r, c = g(rk), g(ck)
    r = r if isinstance(r, list) else [r]; c = c if isinstance(c, list) else [c]
    return [[r[i], c[i]] for i in range(n)]

inv = g('inv')
names = ['wood','stone','coal','iron','diamond','sapling','wood_pickaxe','stone_pickaxe',
         'iron_pickaxe','wood_sword','stone_sword','iron_sword']
d = {
  'map': mp, 'mob_map': mob_map,
  'player_position': [g('player_r'), g('player_c')],
  'player_direction': g('player_dir'),
  'health': g('health'), 'food': g('food'), 'drink': g('drink'), 'energy': g('energy'),
  'is_sleeping': bool(g('is_sleeping')),
  'recover': g('recover'), 'hunger': g('hunger'), 'thirst': g('thirst'), 'fatigue': g('fatigue'),
  'inventory': {names[i]: inv[i] for i in range(12)},
  'zombies': {'pos': pairs('zombie_r','zombie_c',3), 'hp': g('zombie_hp'), 'mask': [bool(x) for x in g('zombie_mask')], 'cd': g('zombie_cd')},
  'cows':    {'pos': pairs('cow_r','cow_c',3), 'hp': g('cow_hp'), 'mask': [bool(x) for x in g('cow_mask')], 'cd': [0,0,0]},
  'skeletons':{'pos': pairs('skel_r','skel_c',2), 'hp': g('skel_hp'), 'mask': [bool(x) for x in g('skel_mask')], 'cd': g('skel_cd')},
  'arrows':  {'pos': pairs('arrow_r','arrow_c',3), 'hp': [0,0,0], 'mask': [bool(x) for x in g('arrow_mask')], 'cd': [0,0,0]},
  'arrow_directions': pairs('arrow_dr','arrow_dc',3),
  'plant_pos': pairs('plant_r','plant_c',10),
  'plant_age': g('plant_age'), 'plant_mask': [bool(x) for x in g('plant_mask')],
  'light_level': g('light_level'),
  'achievements': [bool(x) for x in g('achievements')],
  'timestep': g('timestep'),
}
json.dump(d, open(out,'w'))
print('exported seed', seed, 'after', nsteps, 'steps ->', out)
