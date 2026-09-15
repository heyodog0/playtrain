"""CLI: bake Craftax's textures at full 16x16 for the first-person variant.

    uv run python tools/craftax_atlas_fp.py

Writes ``examples/games/multifile/variants/craftax_fp/src/15_atlas_fp.js``.

Why a second atlas rather than reusing 15_atlas.js
--------------------------------------------------
``tools/craftax_atlas.py`` pre-downscales every texture to 7x7, and that
downscale is parity-critical: Craftax renders the agent view at
``BLOCK_PIXEL_SIZE_AGENT = 7``, so the classic port's tiles must be 7x7 or
its frame is not Craftax's frame.

The first-person view has no such constraint — there is no Craftax
first-person frame to be exact against — and it has the opposite problem. A
wall face a block away fills most of the screen, so a 7x7 texture stretched
over 40-odd pixels is a smear. Craftax's assets are natively 16x16
(``SRC_TILE``), so this tool skips the resize and bakes them as authored.

The variant ships BOTH: 15_atlas.js (7x7) still supplies the inventory icons
and count digits, so the inventory strip stays byte-identical to classic, and
this file supplies the 16x16 block and mob tiles the raycast samples.

Everything else follows the classic baker: blocks are forced opaque because
Craftax builds them as ``load_texture(...)[:, :, :3]``, OUT_OF_BOUNDS is solid
grey 128 rather than a texture, and the player/mob overlays keep their real
alpha for the sprite pass to blend with.
"""

from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
ASSETS = REPO / "games" / "craftax_assets"
OUT = (REPO / "examples" / "games" / "multifile" / "variants" / "craftax_fp"
       / "src" / "15_atlas_fp.js")

TILE = 16                   # Craftax's assets, as authored — no resize

# The first-person view region, in pixels (FIRST_PERSON_PLAN.md §4.5).
VIEW_ROWS, VIEW_COLS = 49, 64

# BlockType order, from craftax_classic/constants.py; identical to the classic
# baker's list, because the grid the raycast walks is indexed by block id.
BLOCKS = [
    "debug_tile.png",          # 0  INVALID
    "debug_tile.png",          # 1  OUT_OF_BOUNDS -> solid grey 128, see below
    "grass.png", "water.png", "stone.png", "tree.png", "wood.png", "path.png",
    "coal.png", "iron.png", "diamond.png", "table.png", "furnace.png",
    "sand.png", "lava.png", "plant_on_grass.png", "ripe_plant_on_grass.png",
]

# Alpha-blended sprites, for the billboard pass (FIRST_PERSON_PLAN.md §4.3).
OVERLAYS = [
    ("zombie", "zombie.png"), ("cow", "cow.png"), ("skeleton", "skeleton.png"),
    ("arrow_up", "arrow-up.png"), ("arrow_down", "arrow-down.png"),
    ("arrow_left", "arrow-left.png"), ("arrow_right", "arrow-right.png"),
]


def load(name: str, opaque: bool) -> Image.Image:
    img = Image.open(ASSETS / name).convert("RGBA")
    if img.size != (TILE, TILE):
        raise SystemExit(f"{name}: expected {TILE}x{TILE}, got {img.size}")
    if opaque:
        r, g, b, _ = img.split()
        img = Image.merge("RGBA", (r, g, b, Image.new("L", img.size, 255)))
    return img


def night_noise_f32() -> bytes:
    """Craftax's night_noise_intensity_texture, at the FIRST-PERSON view's size.

    Same expression as tools/craftax_atlas.py — a radial falloff,
    ``1 - exp(-0.5 * (x^2 + y^2) / 0.25)`` over a ``linspace(-1, 1)``
    meshgrid, transposed — but evaluated at (49, 64) rather than (49, 63),
    because the first-person view is one column wider than the classic map
    region. Baked rather than computed at runtime for the same reason as the
    classic one: ``Math.exp`` is QuickJS's libm in one engine and ieee754's in
    another, and only sin/cos are pinned across PlayTrain's engines.
    """
    xs, ys = np.meshgrid(
        np.linspace(-1, 1, VIEW_ROWS),
        np.linspace(-1, 1, VIEW_COLS),
    )
    tex = 1 - np.exp(-0.5 * (xs**2 + ys**2) / (0.5**2)).T
    assert tex.shape == (VIEW_ROWS, VIEW_COLS), tex.shape
    return tex.astype(np.float32).astype("<f4").tobytes()


def b64wrap(data: bytes) -> str:
    t = base64.b64encode(data).decode()
    parts = [t[i : i + 100] for i in range(0, len(t), 100)]
    return "\n  '" + "' +\n  '".join(parts) + "'"


def main() -> int:
    if not ASSETS.is_dir():
        raise SystemExit(f"no vendored assets at {ASSETS}")

    sprites: list[tuple[str, bytes]] = []
    for i, fname in enumerate(BLOCKS):
        if i == 1:
            sprites.append(("block_1", bytes([128, 128, 128, 255] * TILE * TILE)))
            continue
        sprites.append((f"block_{i}", load(fname, opaque=True).tobytes()))
    for key, fname in OVERLAYS:
        sprites.append((key, load(fname, opaque=False).tobytes()))

    stride = TILE * TILE * 4
    for key, data in sprites:
        assert len(data) == stride, f"{key}: {len(data)} bytes, expected {stride}"

    blob = b"".join(d for _, d in sprites)
    index = {key: i for i, (key, _) in enumerate(sprites)}
    entries = "\n".join(f"  {k}: {v}," for k, v in index.items())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f"""// 15_atlas_fp.js — GENERATED by tools/craftax_atlas_fp.py. DO NOT EDIT.
//
// Craftax's textures at their authored {TILE}x{TILE}, for the first-person
// raycast. The classic port bakes the same assets down to 7x7 because
// Craftax's agent view is 7px tiles; a first-person wall face covers far more
// screen than that, so this atlas keeps the full resolution.
//
// Layout is what rs_voxel_view wants: {len(sprites)} tiles of {TILE}x{TILE} RGBA,
// tile-major then row-major, so tile i starts at i * ATLAS_FP_STRIDE. Blocks
// occupy indices 0..{len(BLOCKS) - 1} in BlockType order, which is what makes the packed
// grid cell `(block_id << 1) | solid` index straight into it. The overlays
// after them are for the billboard sprite pass.
//
// Blocks are opaque: Craftax builds block textures as
// load_texture(...)[:, :, :3], discarding alpha whatever the PNG said.
// OUT_OF_BOUNDS (index 1) is not a texture at all, it is solid grey 128.

const ATLAS_FP_TILE = {TILE};
const ATLAS_FP_STRIDE = ATLAS_FP_TILE * ATLAS_FP_TILE * 4;
const ATLAS_FP_COUNT = {len(sprites)};

// Sprite index by name; multiply by ATLAS_FP_STRIDE for the byte offset.
const ATLAS_FP = {{
{entries}
}};

const ATLAS_FP_B64 ={b64wrap(blob)};

// Craftax's night_noise_intensity_texture at the first-person view's size:
// {VIEW_ROWS} rows x {VIEW_COLS} cols of float32, little-endian, row-major.
// The classic port bakes the same falloff at {VIEW_ROWS}x63 for its map region.
const NIGHT_NOISE_FP_ROWS = {VIEW_ROWS};
const NIGHT_NOISE_FP_COLS = {VIEW_COLS};
const NIGHT_NOISE_FP_B64 ={b64wrap(night_noise_f32())};
""")
    print(f"wrote {OUT.relative_to(REPO)}: {len(sprites)} tiles, {len(blob)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
