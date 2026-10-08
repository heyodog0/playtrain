"""Build src/atlas/<level>.js from games/dmlab_assets (tools/dmlab_assets.py, sprites.py).

    uv run --no-sync python tools/dmlab_atlas.py <level> [--check]
    uv run --no-sync python tools/dmlab_atlas.py --all [--check]

One atlas PER LEVEL, holding the 41 MISHMASH surfaces and only the decals and
sprites that level's dumps use: the object_rewards levels alone need hundreds
of pickup sprites, and every bundle carries its atlas.

One flat atlas of TILE x TILE RGBA tiles, tile-major then row-major, which
is the layout the rasterizer's voxel and maze primitives index. Tiles are
box-filtered down from the 64x64 derivatives in games/dmlab_assets.

TILE IS 32 (decided in U02 against the oracle's own 64x64 frames): DMLab
mipmaps, so at 64x64 its walls are already soft; a wall face fills at most
the full 64-pixel height at arm's length, where a 32-texel tile is 2 screen
pixels per texel. 64 would double the bundle (4x bytes) for detail the oracle
frame does not show. G6 is where this is checked.

Order: the MISHMASH theme (floors, walls, ceiling, as in tools/dmlab_assets.py),
then every lab_games wall decal, then sprites. Indices are stable as long as
those lists are.
"""
import base64
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
ASSETS = HERE.parents[4] / 'games' / 'dmlab_assets'
OUT_DIR = HERE / 'src' / 'atlas'
TILE = 32
MIPS = 3   # levels past the first: 16, 8, 4 px (maze.rs mip levels, PLAN.md section 10 V2)
DUMPS = HERE / 'reference' / 'dumps'
GAINS = HERE / 'reference' / 'lighting' / 'tile_gains.json'   # tools/fit_light.py (V4)


def tile(path, alpha):
    im = Image.open(path).convert('RGBA').resize((TILE, TILE), Image.BOX)
    a = np.asarray(im, np.uint8).copy()
    if not alpha:
        a[..., 3] = 255
    return a


def mips(level0):
    """MIPS levels after level 0, all tiles of a level together, each a 2x2
    box filter ((a + b + c + d + 2) // 4 per channel, alpha too) of the one
    before: what rs_maze_view/_boxes/_quads sample far and grazing surfaces from."""
    out, cur = [], level0.astype(np.uint32)
    for _ in range(MIPS):
        cur = (cur[:, 0::2, 0::2] + cur[:, 1::2, 0::2] + cur[:, 0::2, 1::2] + cur[:, 1::2, 1::2] + 2) // 4
        out.append(cur.astype(np.uint8).tobytes())
    return b''.join(out)


def used(level):
    """Decal shaders and sprite keys the level's dumps reference, and its skybox."""
    sys.path.insert(0, str(HERE / 'tools'))
    import sprites
    decals, keep, maps = set(), {'sprite/goal_object_02', 'sprite/apple', 'sprite/goal_object_03'}, set()
    import compile_level
    spec = compile_level.LEVELS.get(level, {})
    if spec.get('kind') == 'language':
        # colour-at-draw-time tiles for every object the level may draw (hrp2)
        keep.update(f'sprite/hr_{sh}__{pat}' for sh in spec['shapes'] for pat in spec['patterns'])
    for f in (DUMPS / level).glob('*.json'):
        d = json.loads(f.read_text())
        nm = [ln.split(' ', 2)[2] for ln in d['start'].get('map', '').split('\n') if ln.startswith('NEXTMAP 1 ')]
        if nm:
            maps.add(nm[0])
        if 'NEXTMAP 1 em_watermaze' in d['start'].get('map', ''):
            keep.update('sprite/' + k for k in sprites.LANDMARKS)
            keep.add('composite/water_d_over_lg_style_01_floor_blue')
        # language levels build maps in later rounds too: their themes come per frame
        themes = [d['start']['theme']] + [r['theme'] for t in d['trajectories'].values() for r in t if 'theme' in r]
        for line in '\n'.join(themes).split('\n'):
            if line.startswith('D '):
                decals.add(line.split(' decal=')[1])
        for line in ([] if spec.get('kind') == 'language' else d['start'].get('pickups', '').split('\n')):
            if line.startswith('CREATE '):
                kv = dict(x.split('=', 1) for x in line.split(' ')[2:] if '=' in x)
                model, tint = kv['model'], None
                if ':' in model:
                    prefix, model = model.split(':', 1)
                    tint = prefix[len('color_key_'):] if prefix.startswith('color_key_') else None
                if model.endswith('hr_ice_lolly_lrg.md3'):
                    tint = 'goalorange'
                if model.endswith('hr_cake.md3') and 'exploit_deferred' in level:
                    tint = 'exploitcake'
                keep.add('sprite/' + sprites.model_key(model, tint))
                continue
            if line.strip():
                kv = dict(x.split('=', 1) for x in line.split(' ')[1:])
                keep.add('sprite/' + sprites.hrp_key(kv))
    # textures a .map names directly (em_non_match's lg_sky_02 room)
    for m in maps:
        src = ASSETS / 'maps' / f'{m}.map'
        if src.exists():
            keep.update(t for t in SKY_ROOM if t in src.read_text())
    return decals, keep, sky_of(maps)


# Plain textures under map/lab_games/sky/: atlas tiles only where a map uses them.
SKY_ROOM = [f'map/lab_games/sky/lg_sky_02_{f}' for f in ('bk', 'dn', 'ft', 'lf', 'rt', 'up')]
SKY_CUBES = ('lg_sky_01', 'lg_sky_03')
# Levels on texture_sets.CUSTOMIZABLE_FLOORS (their room floors take colours per round).
CUSTOM_FLOORS = {'language_select_located_object', 'language_answer_quantitative_question'}
# Measured against the oracle (V3): em_non_match's lg_sky_01 cube gives sky MAE
# 70 against 32 for the flat sky colour, so that level keeps the flat sky.
SKY_FLAT = {'lg_sky_01'}
SKY_ORDER = ('rt', 'lf', 'up', 'dn', 'ft', 'bk')   # rs_maze_sky's face order


def sky_of(maps):
    """The skybox a level shows: a prebuilt .map's own skyparms sky, or none
    if it has none (a closed room); lg_sky_03 for maps generated at run time
    (no .map source)."""
    srcs = [ASSETS / 'maps' / f'{m}.map' for m in maps]
    srcs = [s for s in srcs if s.exists()]
    if not srcs:
        return 'lg_sky_03'   # a generated text map (explore, skymaze, keys_doors)
    for src in srcs:
        text = src.read_text()
        for c in SKY_CUBES:
            if f'map/lab_games/sky/{c} ' in text or f'map/lab_games/sky/{c}\n' in text:
                return None if c in SKY_FLAT else c
    return None


def sky_cube(name):
    """6 faces of RGBA in rs_maze_sky's order, as the face files store them."""
    faces = [np.asarray(Image.open(ASSETS / 'sky' / f'{name}_{f}.png').convert('RGBA'), np.uint8) for f in SKY_ORDER]
    size = faces[0].shape[0]
    assert all(f.shape == (size, size, 4) for f in faces)
    return size, np.stack(faces).tobytes()


def build(level):
    man = json.loads((ASSETS / 'manifest.json').read_text())
    decals, keep, sky = used(level)
    names, tiles = [], []
    for e in man['files']:
        f = e['file']
        if f.startswith('sky/') or f.startswith('maps/'):
            continue
        if f.startswith('textures/decal') and e['shader'] not in decals:
            continue
        if f.startswith('sprites/') and 'sprite/' + Path(f).stem not in keep:
            continue
        if e.get('shader', '').startswith('composite/water_d_over') and e['shader'] not in keep:
            continue   # a composite only the watermaze draws
        if e.get('shader', '') in SKY_ROOM and e['shader'] not in keep:
            continue   # plain sky-room textures only em_non_match draws
        if 'floor_placeholder' in e.get('shader', '') and level not in CUSTOM_FLOORS:
            continue   # customizable floors (and their colour composites): tier-2 language only
        key = e.get('shader') if not f.startswith('sprites/') else 'sprite/' + Path(f).stem
        names.append(key)
        tiles.append(tile(ASSETS / f, f.startswith('sprites/') or f.startswith('textures/decal')))
    # The level's fitted light (V4): an RGB gain per texture, baked into its tile.
    gains = json.loads(GAINS.read_text()).get(level, {}) if GAINS.exists() else {}
    for i, n in enumerate(names):
        if n in gains:
            t = tiles[i].astype(np.float64)
            t[..., :3] = np.clip(np.rint(t[..., :3] * np.array(gains[n])), 0, 255)
            tiles[i] = t.astype(np.uint8)
    raw = np.stack(tiles).tobytes() + mips(np.stack(tiles))
    b64 = base64.b64encode(raw).decode()
    lines = [
        f'// atlas/{level}.js - GENERATED by tools/dmlab_atlas.py from games/dmlab_assets. DO NOT EDIT.',
        '//',
        '// Derived from DeepMind Lab //assets, CC BY 4.0 (games/dmlab_assets/ATTRIBUTION.md).',
        f'// {len(names)} tiles of {TILE}x{TILE} RGBA, tile-major then row-major:',
        '// tile i starts at byte i * DM_ATLAS_STRIDE. Names are DMLab shader names',
        '// (map/..., decal/...) and sprite/<model>.',
        '',
        f'const DM_ATLAS_TILE = {TILE};',
        'const DM_ATLAS_STRIDE = DM_ATLAS_TILE * DM_ATLAS_TILE * 4;',
        f'const DM_ATLAS_COUNT = {len(names)};',
        f'const DM_ATLAS_MIPS = {MIPS};   // levels after the tiles: each a 2x2 box filter of the one before',
        '',
        'const DM_ATLAS = {',
    ]
    lines += [f"  '{n}': {i}," for i, n in enumerate(names)]
    lines += ['};', '', 'const DM_ATLAS_B64 =']
    width = 120
    chunks = [b64[i:i + width] for i in range(0, len(b64), width)]
    lines += ["  '" + c + "'" + (' +' if j < len(chunks) - 1 else ';') for j, c in enumerate(chunks)]
    lines += ['', '// The skybox (rs_maze_sky): 6 faces of DM_SKY_SIZE^2 RGBA, rt lf up dn ft bk,',
              f'// from games/dmlab_assets/sky/{sky}_*.png; null where the level shows no sky.' if sky else
              '// none: this level shows no sky.']
    if sky:
        size, raw = sky_cube(sky)
        sb = base64.b64encode(raw).decode()
        sc = [sb[i:i + width] for i in range(0, len(sb), width)]
        lines += [f'const DM_SKY_SIZE = {size};', 'const DM_SKY_B64 =']
        lines += ["  '" + c + "'" + (' +' if j < len(sc) - 1 else ';') for j, c in enumerate(sc)]
    else:
        lines += ['const DM_SKY_SIZE = 0;', 'const DM_SKY_B64 = null;']
    return '\n'.join(lines) + '\n', names


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    # --all: every level the port has (src/levels/<level>.js); a level dumped
    # but not yet ported (tier 2 in progress) has no atlas to build.
    ported = sorted(p.stem for p in (HERE / 'src' / 'levels').glob('*.js') if not p.stem.startswith('psychlab_'))
    levels = [lv for lv in ported if (DUMPS / lv).is_dir()] if '--all' in sys.argv else args
    stale = []
    for level in levels:
        text, names = build(level)
        out = OUT_DIR / f'{level}.js'
        if '--check' in sys.argv:
            if not out.exists() or out.read_text() != text:
                stale.append(level)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        print(level, len(names), 'tiles,', out.stat().st_size, 'bytes')
    if '--check' in sys.argv:
        print('atlas STALE: ' + ', '.join(stale) if stale else 'atlases up to date')
        sys.exit(1 if stale else 0)


if __name__ == '__main__':
    main()
