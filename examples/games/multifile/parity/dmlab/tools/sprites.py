"""Billboard sprites for DMLab pickups, rendered from DMLab's own models.

    uv run --no-sync python tools/sprites.py <labassets> [--no-mask-colours]

Reads the MD3 model and its texture from a copy of //assets (CC BY 4.0;
tools/extract_lab_assets.sh) and writes a 64x64 RGBA side view to
<repo>/games/dmlab_assets/sprites/<model>.png, appending provenance to
games/dmlab_assets/manifest.json.

The view is orthographic, from the side (looking along +y, z up, model frame
0), flat textured, no lighting, nearest texel; transparent where no
triangle covers. A billboard always faces the eye, so one view is all a
sprite pass can use. The model's bounding box in game units goes in the
manifest, so the game can size the billboard (the voxel sprite primitive
draws a 1x1 cell quad; a cell is 100 units).
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
OUT = HERE.parents[4] / 'games' / 'dmlab_assets'
SIZE = 64
SS = 4           # supersampling per axis before the box filter

# model -> texture, from common/pickups.lua (read as specification) and the
# model's own surface shader names.
MODELS = {
    'goal_object_02': 'textures/model/goal_colours_d.tga',
    'apple': 'textures/model/apple_d.tga',
    'goal_object_03': 'textures/model/goal_colours_d.tga',   # skymaze's large goal
}

# rooms_watermaze's eight landmarks (em_watermaze.map misc_model, modelscale
# 0.5): picture frames on the arena wall, facing their -x (the arena). Drawn
# from the front, looking along +x (screen right = -y).
LANDMARKS = {f'fut_ldm_img_frame_{k}': f'textures/model/fut_ldm_img_{k}_d.tga'
             for k in ('arc', 'clc', 'crc', 'dic', 'hxc', 'sqc', 'stc', 'trc')}

# Human-recognisable pickups (object_rewards, rooms): DMLab paints a two-colour
# pattern over the model's mask texture at run time. The pattern images live
# under game_scripts/ (GPL-2) and are NOT used: these eight patterns are this
# file's own drawings of what the names say, evaluated in texture UV space.
# Outside the mask (is_mask) the texture's luminance shades the colours; the
# mask itself takes them unshaded. An approximation of the look, measured by G6.
def pattern(name, u, v):
    """1.0 where color2 shows, 0.0 where color1 shows."""
    fu, fv = (u * 8.0) % 1.0, (v * 8.0) % 1.0
    if name == 'chequered':
        return ((np.floor(u * 8) + np.floor(v * 8)) % 2).astype(np.float32)
    if name == 'crosses':
        return (((np.abs(fu - 0.5) < 0.12) & (np.abs(fv - 0.5) < 0.35)) |
                ((np.abs(fv - 0.5) < 0.12) & (np.abs(fu - 0.5) < 0.35))).astype(np.float32)
    if name == 'diagonal_stripe':
        return (np.floor((u + v) * 8) % 2).astype(np.float32)
    if name == 'discs':
        return (((fu - 0.5) ** 2 + (fv - 0.5) ** 2) < 0.12).astype(np.float32)
    if name == 'hex':
        q = np.floor(u * 6 + (np.floor(v * 7) % 2) * 0.5)
        return ((q + np.floor(v * 7)) % 2).astype(np.float32)
    if name == 'pinstripe':
        return (((u * 16.0) % 1.0) < 0.2).astype(np.float32)
    if name == 'spots':
        return (((fu - 0.5) ** 2 + (fv - 0.5) ** 2) < 0.03).astype(np.float32)
    if name == 'swirls':
        a = np.arctan2(fv - 0.5, fu - 0.5)
        r = np.sqrt((fu - 0.5) ** 2 + (fv - 0.5) ** 2)
        return ((np.sin(a + r * 20.0) > 0).astype(np.float32))
    return np.zeros_like(u, dtype=np.float32)   # solid


def is_mask(tex):
    """The texels DMLab paints over: transparent, or black underneath (most
    hr_* textures are black where they take colour). Measured on the oracle's
    frames (V6b): these show the pickup's colours, not black."""
    return (tex[..., 3] < 0.5) | (tex[..., :3].max(-1) < 40.0 / 255.0)


def hrp_texture(tex, pat, c1, c2, size=256):
    """The model texture painted with pattern `pat` in colours c1/c2."""
    h, w = tex.shape[:2]
    small = np.asarray(Image.fromarray((tex * 255).astype(np.uint8)).resize((size, size), Image.BOX),
                       np.float32) / 255.0
    v, u = np.meshgrid(np.arange(size) / size, np.arange(size) / size, indexing='ij')
    m = pattern(pat, u, v)[..., None]
    col = (np.array(c1, np.float32) * (1 - m) + np.array(c2, np.float32) * m) / 255.0
    luma = (0.299 * small[..., 0] + 0.587 * small[..., 1] + 0.114 * small[..., 2])[..., None]
    shade = np.where(is_mask(small)[..., None], 1.0, luma)
    out = np.concatenate([col * shade, np.ones((size, size, 1), np.float32)], -1)
    return out


# Tier 2 (language levels, PLAN.md section 11): their pickups take colours
# drawn at run time with noise, so their tiles carry no colour. A hrp2 tile is
# (R = shade, G = pattern weight, B = 0, A = coverage) for one (shape,
# pattern), and rs_maze_sprite2 paints it with the two colours when it draws:
# colour = mix(c1, c2, G) * shade, the same look as hrp_texture for any colours.
HRP2_PATTERNS = ('chequered', 'crosses', 'diagonal_stripe', 'discs', 'hex', 'pinstripe',
                 'solid', 'spots', 'swirls')   # object_generator.PATTERNS (read as spec)


def hrp2_texture(tex, pat, size=256):
    """(shade, pattern weight, 0, 1) in texture space for model texture `tex`."""
    small = np.asarray(Image.fromarray((tex * 255).astype(np.uint8)).resize((size, size), Image.BOX),
                       np.float32) / 255.0
    v, u = np.meshgrid(np.arange(size) / size, np.arange(size) / size, indexing='ij')
    m = pattern(pat, u, v)
    luma = 0.299 * small[..., 0] + 0.587 * small[..., 1] + 0.114 * small[..., 2]
    shade = np.where(is_mask(small), 1.0, luma)
    return np.stack([shade, m, np.zeros_like(m), np.ones_like(m)], -1).astype(np.float32)


def hrp_key(spec):
    return 'hrp_%s_%s_%s_%s_%s' % (spec['shape'], spec['pattern'], spec['color1'].replace(',', '-'),
                                   spec['color2'].replace(',', '-'), spec['scale'])


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def read_md3(path):
    b = Path(path).read_bytes()
    assert b[:4] == b'IDP3', path
    (_, _, _, _, nframes, ntags, nsurf, _, ofs_frames, ofs_tags, ofs_surf, _) = \
        struct.unpack_from('<4si64siiiiiiiii', b, 0)
    surfaces = []
    o = ofs_surf
    for _ in range(nsurf):
        (ident, name, _, nfr, nsh, nvert, ntri, ofs_tri, ofs_sh, ofs_st, ofs_xyz, ofs_end) = \
            struct.unpack_from('<4s64siiiiiiiiii', b, o)
        tris = np.frombuffer(b, '<i4', ntri * 3, o + ofs_tri).reshape(ntri, 3)
        st = np.frombuffer(b, '<f4', nvert * 2, o + ofs_st).reshape(nvert, 2)
        xyz = np.frombuffer(b, '<i2', nvert * 4, o + ofs_xyz).reshape(nvert, 4)[:, :3] / 64.0
        shader = struct.unpack_from('<64s', b, o + ofs_sh)[0].split(b'\0')[0].decode()
        surfaces.append({'name': name.split(b'\0')[0].decode(), 'shader': shader,
                         'tris': tris, 'st': st, 'xyz': xyz})
        o += ofs_end
    return surfaces


def render(surfaces, tex, view='side'):
    if view == 'front':
        # look along +x: (u, depth, v) = (-y, x, z) in the side view's terms
        surfaces = [dict(s, xyz=np.stack([-s['xyz'][:, 1], -s['xyz'][:, 0], s['xyz'][:, 2]], 1)) for s in surfaces]
    allv = np.concatenate([s['xyz'] for s in surfaces])
    lo, hi = allv.min(0), allv.max(0)
    # Side view: screen u = x, screen v = -z; square frame around the bbox.
    span = max(hi[0] - lo[0], hi[2] - lo[2])
    cx, cz = (hi[0] + lo[0]) / 2, (hi[2] + lo[2]) / 2
    n = SIZE * SS
    img = np.zeros((n, n, 4), np.float32)
    depth = np.full((n, n), np.inf, np.float32)
    th, tw = tex.shape[:2]
    for s in surfaces:
        v = s['xyz']
        px = (v[:, 0] - cx) / span * (n - 1) + (n - 1) / 2
        py = -(v[:, 2] - cz) / span * (n - 1) + (n - 1) / 2
        pd = -v[:, 1]                       # nearer = larger y toward a viewer at -y
        for t in s['tris']:
            x0, x1, x2 = px[t]; y0, y1, y2 = py[t]
            area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if area == 0:
                continue
            xa, xb = int(max(0, np.floor(min(x0, x1, x2)))), int(min(n - 1, np.ceil(max(x0, x1, x2))))
            ya, yb = int(max(0, np.floor(min(y0, y1, y2)))), int(min(n - 1, np.ceil(max(y0, y1, y2))))
            if xa > xb or ya > yb:
                continue
            gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
            w0 = ((x1 - gx) * (y2 - gy) - (x2 - gx) * (y1 - gy)) / area
            w1 = ((x2 - gx) * (y0 - gy) - (x0 - gx) * (y2 - gy)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            d = w0 * pd[t[0]] + w1 * pd[t[1]] + w2 * pd[t[2]]
            sub = depth[ya:yb + 1, xa:xb + 1]
            m = inside & (d < sub)
            if not m.any():
                continue
            st = s['st'][t]
            u = (w0 * st[0, 0] + w1 * st[1, 0] + w2 * st[2, 0]) % 1.0
            vv = (w0 * st[0, 1] + w1 * st[1, 1] + w2 * st[2, 1]) % 1.0
            tx = np.clip((u * tw).astype(int), 0, tw - 1)
            ty = np.clip((vv * th).astype(int), 0, th - 1)
            col = tex[ty, tx]
            region = img[ya:yb + 1, xa:xb + 1]
            region[m, :3] = col[m, :3]
            region[m, 3] = 1.0
            sub[m] = d[m]
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA').resize((SIZE, SIZE), Image.BOX)
    return im, lo.tolist(), hi.tolist()


# Tints: keys_doors_puzzle colours its keys (POSSIBLE_COLORS) and paints its
# goal orange (GOAL_OBJECT_COLOUR), read off keys_doors_puzzle_factory.lua as
# specification. The tint multiplies the model's texture.
TINTS = {'red': (255, 0, 0), 'green': (0, 255, 0), 'blue': (0, 0, 255), 'white': (255, 255, 255),
         'black': (0, 0, 0)}
GOAL_TINT = (255, 153, 0)


def model_key(model, tint=None):
    stem = Path(model).stem
    return stem if tint is None else f'{stem}__{tint}'


def surface_texture(assets, shader):
    """The image a model surface shows: its shader name as a file (with or
    without .tga); an emissive map (fut_obj_*_NN_e) falls back to the
    shape's diffuse texture (fut_obj_*_d)."""
    import re
    base = shader[:-4] if shader.endswith('.tga') else shader
    cands = [base]
    m = re.match(r'(.*fut_obj_[a-z]+)_\d+_e$', base)
    if m:
        cands.insert(0, m.group(1) + '_d')
    for c in cands:
        if (assets / (c + '.tga')).exists():
            return c + '.tga'
    raise FileNotFoundError(shader)


COLOURS_FILE = HERE / 'reference' / 'objects' / 'create_colours.json'
# --no-mask-colours: leave the masks black (what tools/fit_objects.py measures against)
COLOURS = (json.loads(COLOURS_FILE.read_text()) if COLOURS_FILE.exists() and '--no-mask-colours' not in sys.argv
           else {})


def model_texture(assets, shader):
    """A model surface's look: its Quake shader composed at t = 0 with
    lightmap 1 (tools/dmlab_assets.py: fut_obj_* are a diffuse map plus an
    additive emissive one) where the shader exists, else its texture file.
    Returns (HxWx4 float, source paths relative to assets)."""
    import dmlab_assets as da
    global _SHADERS
    if _SHADERS is None:
        _SHADERS = da.parse_shaders(assets / 'scripts')
    if shader in _SHADERS:
        used = {}
        tex, _ = da.compose(assets, _SHADERS[shader], used)
        return tex, sorted(used)
    texrel = surface_texture(assets, shader)
    return np.asarray(Image.open(assets / texrel).convert('RGBA'), np.float32) / 255.0, [texrel]


_SHADERS = None


def created_models():
    """(model, tint) for every pickup a rooms dump created (CREATE lines)."""
    out = set()
    for f in sorted((HERE / 'reference' / 'dumps').glob('rooms_*/*.json')):
        d = json.loads(f.read_text())
        for line in d['start'].get('pickups', '').split('\n'):
            if not line.startswith('CREATE '):
                continue
            kv = dict(x.split('=', 1) for x in line.split(' ')[2:] if '=' in x)
            model = kv['model']
            tint = None
            if ':' in model:
                prefix, model = model.split(':', 1)
                tint = prefix[len('color_key_'):] if prefix.startswith('color_key_') else None
            if model.endswith('hr_ice_lolly_lrg.md3'):
                tint = 'goalorange'
            if model.endswith('hr_cake.md3') and 'exploit_deferred' in f.parent.name:
                tint = 'exploitcake'
            out.add((model, tint))
    return sorted(out, key=lambda m: (m[0], m[1] or ''))


def hrp_specs():
    """Every human-recognisable pickup any committed dump uses."""
    out = {}
    for f in sorted((HERE / 'reference' / 'dumps').glob('*/*.json')):
        if f.parent.name.startswith(('language_', 'psychlab_')):
            continue   # tier 2: coloured at draw time (hrp2 tiles), never baked
        d = json.loads(f.read_text())
        for line in d['start'].get('pickups', '').split('\n'):
            if not line.strip() or line.startswith('CREATE '):
                continue
            kv = dict(x.split('=', 1) for x in line.split(' ')[1:])
            out[hrp_key(kv)] = kv
    return out


def main():
    assets = Path(sys.argv[1]).resolve()
    man = json.loads((OUT / 'manifest.json').read_text())
    man['files'] = [e for e in man['files'] if not e['file'].startswith('sprites/')]
    for model, tint in created_models():
        if Path(model).stem in MODELS and tint is None:
            continue
        mp = assets / model
        surf = read_md3(mp)
        tex, srcs = model_texture(assets, surf[0]['shader'])
        texrel = srcs[0]
        key = model_key(model, tint)
        if key in COLOURS:
            # the mask in the colour DMLab paints it (tools/fit_objects.py)
            tex = tex.copy()
            tex[is_mask(tex), :3] = np.array(COLOURS[key]['rgb'], np.float32) / 255.0
        if tint == 'exploitcake':
            # exploit_deferred_effects_factory.lua modifyTexture(hr_cake_d):
            # per channel, values < 128 become 200 (R) / 0 (G) / 0 (B).
            tex = tex.copy()
            for ch, val in ((0, 200), (1, 0), (2, 0)):
                c = tex[..., ch]
                tex[..., ch] = np.where(c * 255.0 < 128.0, val / 255.0, c)
        elif tint is not None:
            c = GOAL_TINT if tint == 'goalorange' else TINTS[tint]
            tex = tex.copy()
            tex[..., :3] *= np.array(c, np.float32) / 255.0
        im, lo, hi = render(surf, tex)
        rel = Path('sprites') / f'{model_key(model, tint)}.png'
        im.save(OUT / rel, optimize=True)
        man['files'].append({
            'file': str(rel), 'sha256': sha(OUT / rel), 'model': model, 'tint': tint,
            'surfaces': [x['shader'] for x in surf], 'bbox_units': {'min': lo, 'max': hi},
            'sources': [{'path': model, 'sha256': sha(mp)}] + [{'path': r, 'sha256': sha(assets / r)} for r in srcs],
            'licence': 'CC BY 4.0',
            'modified': ('MD3 frame 0 rasterised from the side, unlit'
                         + (', its shader stages composed at t = 0 (tools/dmlab_assets.py)' if len(srcs) > 1 else '')
                         + (f', its mask painted {COLOURS[key]["rgb"]} (fitted, reference/objects/create_colours.json)'
                            if key in COLOURS else '')
                            + (f', texture multiplied by the {tint} tint' if tint else '')
                         + f'; {SS}x supersampled, box-filtered to {SIZE}x{SIZE} RGBA')})
    for key, spec in sorted(hrp_specs().items()):
        mp = assets / 'models' / f'hr_{spec["shape"]}.md3'
        surf = read_md3(mp)
        texrel = surf[0]['shader'] + '.tga'
        tex = np.asarray(Image.open(assets / texrel).convert('RGBA'), np.float32) / 255.0
        c1 = [int(x) for x in spec['color1'].split(',')]
        c2 = c1 if spec['pattern'] == 'solid' else [int(x) for x in spec['color2'].split(',')]
        im, lo, hi = render(surf, hrp_texture(tex, spec['pattern'], c1, c2))
        rel = Path('sprites') / 'hrp' / f'{key}.png'
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        im.save(OUT / rel, optimize=True)
        man['files'].append({
            'file': str(rel), 'sha256': sha(OUT / rel), 'model': f'models/hr_{spec["shape"]}.md3',
            'hrp': spec, 'surfaces': [x['shader'] for x in surf],
            'bbox_units': {'min': lo, 'max': hi},
            'sources': [{'path': f'models/hr_{spec["shape"]}.md3', 'sha256': sha(mp)},
                        {'path': texrel, 'sha256': sha(assets / texrel)}],
            'licence': 'CC BY 4.0',
            'modified': ('MD3 frame 0 rasterised from the side, unlit; texture painted with this '
                         'tool\'s own drawing of the named pattern in the two colours, shaded by the '
                         f'texture luminance; {SS}x supersampled, box-filtered to {SIZE}x{SIZE} RGBA')})
    for name, texrel in MODELS.items():
        mp = assets / 'models' / f'{name}.md3'
        surf = read_md3(mp)
        tex = np.asarray(Image.open(assets / texrel).convert('RGBA'), np.float32) / 255.0
        im, lo, hi = render(surf, tex)
        rel = Path('sprites') / f'{name}.png'
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        im.save(OUT / rel, optimize=True)
        man['files'].append({
            'file': str(rel), 'sha256': sha(OUT / rel), 'model': f'models/{name}.md3',
            'surfaces': [s['shader'] for s in surf],
            'bbox_units': {'min': lo, 'max': hi},
            'sources': [{'path': f'models/{name}.md3', 'sha256': sha(mp)},
                        {'path': texrel, 'sha256': sha(assets / texrel)}],
            'licence': 'CC BY 4.0',
            'modified': f'MD3 frame 0 rasterised orthographically from the side, flat textured, unlit, {SS}x supersampled and box-filtered to {SIZE}x{SIZE} RGBA'})
        print(name, 'bbox', [round(x, 1) for x in lo], [round(x, 1) for x in hi], [s['shader'] for s in surf])
    for mp in sorted((assets / 'models').glob('hr_*.md3')):
        surf = read_md3(mp)
        texrel = surf[0]['shader'] + '.tga'
        if not (assets / texrel).exists():
            continue
        tex = np.asarray(Image.open(assets / texrel).convert('RGBA'), np.float32) / 255.0
        for pat in HRP2_PATTERNS:
            im, lo, hi = render(surf, hrp2_texture(tex, pat))
            rel = Path('sprites') / 'hrp2' / f'{mp.stem}__{pat}.png'
            (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
            im.save(OUT / rel, optimize=True)
            man['files'].append({
                'file': str(rel), 'sha256': sha(OUT / rel), 'model': f'models/{mp.name}',
                'hrp2': {'shape': mp.stem[len('hr_'):], 'pattern': pat},
                'surfaces': [x['shader'] for x in surf], 'bbox_units': {'min': lo, 'max': hi},
                'sources': [{'path': f'models/{mp.name}', 'sha256': sha(mp)},
                            {'path': texrel, 'sha256': sha(assets / texrel)}],
                'licence': 'CC BY 4.0',
                'modified': ('MD3 frame 0 rasterised from the side, unlit, as (shade, pattern weight, 0, '
                             'coverage): shade the texture luminance outside its colour mask and 1 inside, '
                             f'the weight this tool\'s own drawing of the {pat} pattern; colours are applied '
                             f'at draw time (rs_maze_sprite2); {SS}x supersampled, box-filtered to '
                             f'{SIZE}x{SIZE} RGBA')})
    for name, texrel in LANDMARKS.items():
        mp = assets / 'models' / f'{name}.md3'
        surf = read_md3(mp)
        tex = np.asarray(Image.open(assets / texrel).convert('RGBA'), np.float32) / 255.0
        im, lo, hi = render(surf, tex, 'front')
        rel = Path('sprites') / f'{name}.png'
        im.save(OUT / rel, optimize=True)
        man['files'].append({
            'file': str(rel), 'sha256': sha(OUT / rel), 'model': f'models/{name}.md3', 'view': 'front',
            'surfaces': [s['shader'] for s in surf],
            'bbox_units': {'min': lo, 'max': hi},   # in the view's frame: x across, z up
            'sources': [{'path': f'models/{name}.md3', 'sha256': sha(mp)},
                        {'path': texrel, 'sha256': sha(assets / texrel)}],
            'licence': 'CC BY 4.0',
            'modified': f'MD3 frame 0 rasterised orthographically from the front (looking along +x), flat textured, unlit, {SS}x supersampled and box-filtered to {SIZE}x{SIZE} RGBA'})
        print(name, 'bbox', [round(x, 1) for x in lo], [round(x, 1) for x in hi])
    (OUT / 'manifest.json').write_text(json.dumps(man, indent=2) + '\n')


if __name__ == '__main__':
    main()
