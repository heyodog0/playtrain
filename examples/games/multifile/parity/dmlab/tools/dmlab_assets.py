"""Derive the textures the port uses from DMLab's //assets (CC BY 4.0).

    bash tools/extract_lab_assets.sh <labassets>
    uv run --no-sync python tools/dmlab_assets.py <labassets>

Writes <repo>/games/dmlab_assets/textures/*.png (64x64 derivatives), the
skybox faces under sky/, and manifest.json with, for every file, the shader or
source it came from, the sha256 of each original source file, its own sha256,
the licence and what was changed. ATTRIBUTION.md is written alongside.

WHAT "COMPOSITED" MEANS. A DMLab surface is a Quake 3 shader: several texture
stages blended in order, some animated. The port samples one static tile per
surface, so each shader is evaluated ONCE here, at time 0, with these
documented simplifications (the perceptual gate G6 measures what they cost):

  * $lightmap stages are skipped (lightmap = 1, i.e. full bright);
  * `tcGen environment` stages are skipped (view dependent; all are faint
    additive circuit overlays, rgbGen const <= 0.06);
  * `tcMod scroll` is evaluated at t = 0 (no offset);
  * `rgbGen wave <fn> base amp phase freq` is evaluated at t = 0;
  * every stage is sampled at the same UV, at the base map's resolution.

Then the result is box-filtered to 64x64. The atlas builder downsamples
further to the tile size it uses.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parents[4]
OUT = REPO / 'games' / 'dmlab_assets'
SIZE = 64
LICENCE = 'CC BY 4.0'
LAB_URL = 'https://github.com/google-deepmind/lab'

# MISHMASH, the texture set of every explore and skymaze level, as listed in
# game_scripts/themes/texture_sets.lua (read as specification). Floors, walls,
# then the ceiling.
MISHMASH = [f'map/lab_games/lg_style_{s}' for s in (
    '01_floor_orange', '01_floor_orange_bright', '01_floor_blue', '01_floor_blue_bright',
    '02_floor_blue', '02_floor_blue_bright', '02_floor_green', '02_floor_green_bright',
    '03_floor_green', '03_floor_green_bright', '03_floor_blue', '03_floor_blue_bright',
    '04_floor_blue', '04_floor_blue_bright', '04_floor_orange', '04_floor_orange_bright',
    '05_floor_blue', '05_floor_blue_bright', '05_floor_orange', '05_floor_orange_bright',
    '01_wall_green', '01_wall_green_bright', '01_wall_red', '01_wall_red_bright',
    '02_wall_yellow', '02_wall_yellow_bright', '02_wall_blue', '02_wall_blue_bright',
    '03_wall_orange', '03_wall_orange_bright', '03_wall_gray', '03_wall_gray_bright',
    '04_wall_green', '04_wall_green_bright', '04_wall_red', '04_wall_red_bright',
    '05_wall_red', '05_wall_red_bright', '05_wall_yellow', '05_wall_yellow_bright',
)] + ['map/lab_games/fake_sky']
# Surfaces the rooms maps (//assets/maps/src) and rooms_keys_doors_puzzle use
# beyond MISHMASH. Shaders where they exist, else the plain texture (the
# map/fut_* surfaces have no shader).
ROOMS = ['map/lab_games/lg_style_01_wall_blue', 'map/fut_ceiling_tile_02_d', 'map/fut_flat_wall_yellow_blank_d',
         'map/fut_door_d', 'map/fut_utility_panel_01_d', 'map/black_d'] + [
    # em_non_match.map's second room is a brush box textured with these (plain
    # images, not a skyparms sky)
    f'map/lab_games/sky/lg_sky_02_{f}' for f in ('bk', 'dn', 'ft', 'lf', 'rt', 'up')]
# Tier 2 language levels (texture_sets.CUSTOMIZABLE_FLOORS, read as spec): a
# placeholder floor per room variation (0 = the corridors), which
# decorators/custom_floors.lua multiplies by the room's colour at run time.
# Each placeholder is also composed here times every named colour of
# object_generator (no noise for floors): FLOOR_COLOURS.
PLACEHOLDERS = [f'map/lab_games/lg_style_01_floor_placeholder_{v}' for v in '0ABCDEF']
ROOMS = ROOMS + PLACEHOLDERS
# The .map sources the rooms levels load, copied verbatim (CC BY 4.0).
MAPS = ['rooms_collect_good_objects', 'em_non_match', 'rooms_exploit_deferred_effects_one_room',
        'rooms_exploit_deferred_effects_two_rooms', 'em_watermaze']
# Not DMLab assets: the exploit factory paints its map/script_highlight floor
# at run time with an 8x8 image of all 0 (dark) or all 70 (bright), read off
# exploit_deferred_effects_factory.lua as specification.
SYNTHETIC = {'synthetic/script_highlight_dark': 0, 'synthetic/script_highlight_bright': 70}
# keys_doors_puzzle fence doors, drawn as solid slabs in their colour
# (POSSIBLE_COLORS in keys_doors_puzzle_factory.lua; the fence's bars are G6's).
SYNTHETIC_RGB = {'synthetic/door_red': (255, 0, 0), 'synthetic/door_green': (0, 255, 0),
                 'synthetic/door_blue': (0, 0, 255), 'synthetic/door_white': (255, 255, 255),
                 'synthetic/door_black': (0, 0, 0)}
# A translucent surface seen over the one under it, composited once: the
# watermaze's glass floor (map/water_d: glass blended, caustics added) over
# the arena floor 16 units below. Its stages' tcMods (scale, stretch, turb)
# are left out: a G6 approximation.
OVER = {'composite/water_d_over_lg_style_01_floor_blue': ('map/water_d', 'map/lab_games/lg_style_01_floor_blue')}
# Skybox cubes (Quake 3 `skyparms` shaders): lg_sky_03 for every generated
# text map (common/make_map.lua SKYBOX_TEXTURE_NAME), lg_sky_01 for
# em_non_match.map's sky brushes. Faces kept at SIZE, as their files store them.
SKIES = ('map/lab_games/sky/lg_sky_01', 'map/lab_games/sky/lg_sky_03')
SKY_FACES = ('bk', 'dn', 'ft', 'lf', 'rt', 'up')


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def parse_shaders(scripts):
    out = {}
    for p in sorted(scripts.glob('*.shader')):
        src = re.sub(r'//[^\n]*', '', p.read_text(errors='replace'))
        toks = re.findall(r'\{|\}|[^\s{}]+|\n', src)
        name = None
        stack = []
        cur = None
        line = []
        for t in toks:
            if t == '\n':
                if line and cur is not None:
                    cur['lines'].append(line)
                elif line and len(stack) == 1:
                    out[name]['params'].append(line)
                elif line and not stack:
                    name = line[0]
                line = []
                continue
            if t == '{':
                if line and not stack:
                    name = line[0]
                line = []
                stack.append(t)
                if len(stack) == 1:
                    out[name] = {'file': p.name, 'params': [], 'stages': []}
                elif len(stack) == 2:
                    cur = {'lines': []}
                continue
            if t == '}':
                if line and cur is not None:
                    cur['lines'].append(line)
                line = []
                stack.pop()
                if len(stack) == 1 and cur is not None:
                    out[name]['stages'].append(cur)
                    cur = None
                continue
            line.append(t)
    return out


def load(assets, ref, used):
    p = assets / ref
    if not p.suffix:
        for ext in ('.tga', '.jpg', '.png'):
            if (assets / (ref + ext)).exists():
                p = assets / (ref + ext)
                break
    used[str(p.relative_to(assets))] = sha(p)
    im = Image.open(p).convert('RGBA')
    return np.asarray(im, dtype=np.float32) / 255.0


def wave(fn, base, amp, phase, freq, t=0.0):
    x = phase + t * freq
    f = {'sin': math.sin(2 * math.pi * x), 'square': 1.0 if (x % 1) < 0.5 else -1.0,
         'triangle': 1 - 4 * abs((x % 1) - 0.5), 'sawtooth': x % 1,
         'inversesawtooth': 1 - (x % 1)}[fn.lower()]
    return base + amp * f


def compose(assets, sh, used, base=None):
    """Evaluate a shader at t=0 with lightmap 1. Returns HxWx4 float. With
    `base` (HxWx4), the stages blend onto it instead of onto black."""
    dst = None
    skipped = []
    res = None
    for st in sh['stages']:
        d = {}
        for ln in st['lines']:
            d.setdefault(ln[0].lower(), []).append(ln[1:])
        src_ref = (d.get('map') or d.get('clampmap') or [[None]])[0][0]
        if src_ref is None or src_ref.lower() == '$lightmap':
            skipped.append('lightmap')
            continue
        if any(a and a[0].lower() == 'environment' for a in d.get('tcgen', [])):
            skipped.append('tcgen environment ' + src_ref)
            continue
        if src_ref.lower() == '$whiteimage':
            tex = np.ones((res or 64, res or 64, 4), np.float32)
        else:
            tex = load(assets, src_ref, used)
        if res is None:
            res = tex.shape[0]
        if tex.shape[0] != res:
            tex = np.asarray(Image.fromarray((tex * 255).astype(np.uint8)).resize((res, res), Image.BILINEAR),
                             np.float32) / 255.0
        rgb = tex[..., :3].copy()
        a = tex[..., 3:4].copy()
        for g in d.get('rgbgen', []):
            k = g[0].lower()
            if k == 'const':
                v = [float(x) for x in g[1:] if x not in ('(', ')')]
                rgb = rgb * np.array(v[:3], np.float32)
            elif k == 'wave':
                rgb = rgb * np.float32(min(max(wave(g[1], *map(float, g[2:6])), 0.0), 1.0))
            elif k in ('identity', 'identitylighting', 'vertex', 'exactvertex', 'diffuselighting', 'lightingdiffuse'):
                pass
            else:
                raise ValueError('rgbgen ' + k)
        bf = [x.lower() for x in (d.get('blendfunc') or [[]])[0]]
        if dst is None and base is not None:
            dst = np.asarray(Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8)).resize(
                (rgb.shape[1], rgb.shape[0]), Image.BILINEAR), np.float32) / 255.0
            dst[..., 3] = 1.0
        if dst is None:
            # A skipped first stage (environment map) leaves an opaque black
            # framebuffer behind, which is what the next stage blends onto.
            dst = np.zeros_like(np.concatenate([rgb, a], -1))
            dst[..., 3] = 1.0
            if not bf:
                dst = np.concatenate([rgb, a], -1)
                continue
        if not bf:
            dst = np.concatenate([rgb, a], -1)
        elif bf == ['add'] or bf == ['gl_one', 'gl_one']:
            dst[..., :3] = dst[..., :3] + rgb
        elif bf == ['blend'] or bf == ['gl_src_alpha', 'gl_one_minus_src_alpha']:
            dst[..., :3] = rgb * a + dst[..., :3] * (1 - a)
            dst[..., 3:4] = np.maximum(dst[..., 3:4], a)
        elif bf == ['gl_one', 'gl_one_minus_src_alpha']:
            dst[..., :3] = rgb + dst[..., :3] * (1 - a)
        elif bf == ['gl_src_color', 'gl_one_minus_src_alpha']:
            dst[..., :3] = rgb * rgb + dst[..., :3] * (1 - a)
        elif bf in (['filter'], ['gl_dst_color', 'gl_zero'], ['gl_zero', 'gl_src_color']):
            dst[..., :3] = dst[..., :3] * rgb
        else:
            raise ValueError('blendfunc ' + ' '.join(bf))
        np.clip(dst, 0.0, 1.0, out=dst)
    return dst, skipped


def save(arr, path, alpha):
    arr = arr.copy()
    if not alpha:
        arr[..., 3] = 1.0   # PIL premultiplies RGBA when resizing
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    im = im.resize((SIZE, SIZE), Image.BOX)
    if not alpha:
        im = im.convert('RGB')
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)


def main():
    assets = Path(sys.argv[1]).resolve()
    shaders = parse_shaders(assets / 'scripts')
    decals = sorted(n[len('textures/'):] for n in shaders
                    if n.startswith('textures/decal/lab_games/') and n.endswith('_nonsolid'))
    entries = []
    for name in MISHMASH + decals + ROOMS:
        if 'textures/' + name not in shaders:
            used = {}
            src = assets / ('textures/' + name + '.tga')
            arr = load(assets, 'textures/' + name, used)
            rel = Path('textures') / (name.replace('/', '__') + '.png')
            save(arr, OUT / rel, False)
            w, h = Image.open(src).size
            entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': name, 'size': [w, h],
                            'sources': [{'path': k, 'sha256': v} for k, v in sorted(used.items())],
                            'licence': LICENCE, 'modified': f'no shader; box-filtered to {SIZE}x{SIZE}'})
            continue
        sh = shaders['textures/' + name]
        # The shader script is a source too: it holds the stage colours and
        # blend modes (and, for fake_sky, the whole surface: $whiteimage
        # times a constant).
        used = {'scripts/' + sh['file']: sha(assets / 'scripts' / sh['file'])}
        arr, skipped = compose(assets, sh, used)
        alpha = bool((arr[..., 3] < 0.999).any()) and name.startswith('decal/')
        rel = Path('textures') / (name.replace('/', '__') + '.png')
        save(arr, OUT / rel, alpha)
        entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': name,
                        'size': [arr.shape[1], arr.shape[0]],
                        'shader_file': 'scripts/' + sh['file'],
                        'sources': [{'path': k, 'sha256': v} for k, v in sorted(used.items())],
                        'licence': LICENCE,
                        'modified': 'shader stages composited at t=0, lightmap=1'
                                    + (', skipped: ' + '; '.join(sorted(set(skipped))) if skipped else '')
                                    + f'; box-filtered to {SIZE}x{SIZE}'})
    for name, (top, under) in OVER.items():
        used = {}
        bsh = shaders.get('textures/' + under)
        if bsh is not None:
            used['scripts/' + bsh['file']] = sha(assets / 'scripts' / bsh['file'])
            base, _ = compose(assets, bsh, used)
        else:
            base = load(assets, 'textures/' + under, used)
        sh = shaders['textures/' + top]
        used['scripts/' + sh['file']] = sha(assets / 'scripts' / sh['file'])
        arr, skipped = compose(assets, sh, used, base)
        rel = Path('textures') / (name.replace('/', '__') + '.png')
        save(arr, OUT / rel, False)
        entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': name,
                        'size': [arr.shape[1], arr.shape[0]],
                        'sources': [{'path': k, 'sha256': v} for k, v in sorted(used.items())],
                        'licence': LICENCE,
                        'modified': f'{top} shader stages (t=0, tcMods left out) composited over {under}'
                                    + (', skipped: ' + '; '.join(sorted(set(skipped))) if skipped else '')
                                    + f'; box-filtered to {SIZE}x{SIZE}'})
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from compile_level import LANG_COLORS_HSL, hsl_rgb
    for name in PLACEHOLDERS:
        sh = shaders['textures/' + name]
        for colour, hsl in sorted(LANG_COLORS_HSL.items()):
            used = {'scripts/' + sh['file']: sha(assets / 'scripts' / sh['file'])}
            arr, skipped = compose(assets, sh, used)
            rgb = hsl_rgb(*hsl)
            arr = arr.copy()
            arr[..., :3] *= np.array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], np.float32) / 255.0
            cname = f'composite/{name.rsplit("/", 1)[1]}#{colour}'
            rel = Path('textures') / (cname.replace('/', '__').replace('#', '__') + '.png')
            save(arr, OUT / rel, False)
            entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': cname,
                            'size': [arr.shape[1], arr.shape[0]],
                            'sources': [{'path': k, 'sha256': v} for k, v in sorted(used.items())],
                            'licence': LICENCE,
                            'modified': f'{name} shader stages composited at t=0, lightmap=1, times the '
                                        f'colour {colour} {(rgb >> 16) & 255},{(rgb >> 8) & 255},{rgb & 255} '
                                        f'(custom_floors, read as spec); box-filtered to {SIZE}x{SIZE}'})
    for sky in SKIES:
        for face in SKY_FACES:
            used = {}
            arr = load(assets, f'textures/{sky}_{face}', used)
            rel = Path('sky') / f'{sky.rsplit("/", 1)[1]}_{face}.png'
            save(arr, OUT / rel, False)
            entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': sky + ' (skybox face)',
                            'sources': [{'path': k, 'sha256': v} for k, v in used.items()],
                            'licence': LICENCE, 'modified': f'box-filtered to {SIZE}x{SIZE}'})
    for name, val in list(SYNTHETIC.items()) + list(SYNTHETIC_RGB.items()):
        rel = Path('textures') / (name.replace('/', '__') + '.png')
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        rgb = val if isinstance(val, tuple) else (val, val, val)
        Image.new('RGB', (SIZE, SIZE), rgb).save(OUT / rel)
        entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'shader': name, 'size': [8, 8],
                        'sources': [], 'licence': 'none (not a DMLab asset)',
                        'modified': f'solid {rgb}: a colour the rooms factories paint or name'})
    for m in MAPS:
        src = assets / 'maps' / 'src' / f'{m}.map'
        rel = Path('maps') / f'{m}.map'
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        (OUT / rel).write_bytes(src.read_bytes())
        entries.append({'file': str(rel), 'sha256': sha(OUT / rel), 'map': m,
                        'sources': [{'path': f'maps/src/{m}.map', 'sha256': sha(src)}],
                        'licence': LICENCE, 'modified': 'none (verbatim copy)'})
    commit = (assets / 'LAB_COMMIT').read_text().strip() if (assets / 'LAB_COMMIT').exists() else None
    man = {'source': LAB_URL, 'commit': commit, 'path': '//assets', 'licence': LICENCE,
           'licence_text': 'lab LICENSE, section "License for //assets"',
           'files': entries}
    (OUT / 'manifest.json').write_text(json.dumps(man, indent=2) + '\n')
    (OUT / 'ATTRIBUTION.md').write_text(f'''# DMLab assets (CC BY 4.0)

The images in this directory are derived from the `//assets` directory of
DeepMind Lab, {LAB_URL} (commit `{commit}`), copyright DeepMind
Technologies Limited, licensed under the Creative Commons Attribution 4.0
International licence (https://creativecommons.org/licenses/by/4.0/; the full
text is in lab's `LICENSE`, section "License for //assets").

**Changes made.** Each surface texture is a composite of the stages of its
Quake 3 shader evaluated at time 0 with the lightmap set to 1, with
view-dependent environment-mapped stages left out, box-filtered down to
{SIZE}x{SIZE} pixels. Skybox faces are box-filtered down to {SIZE}x{SIZE}. Sprites
(`sprites/`) are DMLab's pickup models rasterised from one side, unlit, with
their shader stages composed the same way. Where a model texture is a mask
DMLab colours at run time, the mask is painted with colours fitted to DMLab's
rendered frames or with this project's own drawings of the named patterns
(`examples/games/multifile/parity/dmlab/tools/sprites.py`).
`manifest.json` lists, for every file, the shader and every original source
file it was made from with the original's sha256, and the derivative's own
sha256. The tool that made them is
`examples/games/multifile/parity/dmlab/tools/dmlab_assets.py`.

Nothing here comes from DMLab's GPL-2 code (`engine/`, `deepmind/`,
`game_scripts/`, `q3map2/`) or from `assets_oa/`.
''')
    print(len(entries), 'files ->', OUT)


if __name__ == '__main__':
    main()
