"""CLI: bake Craftax's textures into a JS source file for the parity port.

    uv run python tools/craftax_atlas.py

Writes ``examples/games/multifile/parity/craftax_classic/src/15_atlas.js``:
one base64 RGBA blob plus the index each sprite sits at.

Why bake rather than load at runtime
------------------------------------
The rasterizer takes raw RGBA and has no PNG decoder, so the decode has to
happen somewhere. Doing it here means the shipped bundle is one flat script
with no assets to find at runtime, which is what the catalog contract wants.

Why pre-downscale to 7x7
------------------------
This is the parity-critical part. Craftax renders the agent view at
``BLOCK_PIXEL_SIZE_AGENT = 7`` by resizing each 16x16 texture with
**PIL NEAREST**, which maps destination pixel x to source
``floor((x + 0.5) * 16 / 7)``. The rasterizer's own blit
(``rs_draw_image``) maps ``floor(x * 16 / 7)`` — a different pixel for most
x. Blitting a 16x16 texture down to 7x7 at runtime would therefore NOT
reproduce Craftax's image.

So the downscale is done here, with PIL, exactly as Craftax does it, and the
runtime blit is 1:1 — no resampling at all, which is trivially bit-exact
across every backend.

Craftax's other two conventions, reproduced:
  * alpha is clamped to 0/1 for blocks (``a // 255``) but NOT for the player
    and mobs, which alpha-blend;
  * BlockType.OUT_OF_BOUNDS is not a texture at all — it is solid grey 128.

Why the night-noise texture is baked too
----------------------------------------
``night_noise_intensity_texture`` (craftax_classic/constants.py) is a radial
falloff, ``1 - exp(-0.5 * (x^2 + y^2) / 0.25)`` over a ``linspace(-1, 1)``
meshgrid, transposed to (49, 63). It is a constant, so it could be computed
at runtime — but not bit-exactly across engines: QuickJS's ``Math.exp`` is
its libm's, V8's is ieee754's, and only ``Math.cos``/``Math.sin`` are pinned
to one implementation in PlayTrain's engines. ``np.linspace`` has its own
rounding as well. Baking the float32 values numpy produces (which is what
JAX uses after canonicalising the float64 array) sidesteps all of that.
"""

from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
ASSETS = REPO / "games" / "craftax_assets"
OUT = (REPO / "examples" / "games" / "multifile" / "parity" / "craftax_classic"
       / "src" / "15_atlas.js")

TILE = 7                    # BLOCK_PIXEL_SIZE_AGENT
SRC_TILE = 16               # every Craftax asset is 16x16
ICON = int(TILE * 0.8)      # 5 — inventory icons ("small_block_pixel_size")
DIGIT = int(TILE * 0.6)     # 4 — the count digits ("number_size")
OBS_DIM = (7, 9)            # map view, rows x cols, in tiles

# BlockType order, from craftax_classic/constants.py. Index 1 is a placeholder:
# the renderer overwrites OUT_OF_BOUNDS with solid grey.
BLOCKS = [
    "debug_tile.png",          # 0  INVALID
    "debug_tile.png",          # 1  OUT_OF_BOUNDS -> solid grey 128, see below
    "grass.png", "water.png", "stone.png", "tree.png", "wood.png", "path.png",
    "coal.png", "iron.png", "diamond.png", "table.png", "furnace.png",
    "sand.png", "lava.png", "plant_on_grass.png", "ripe_plant_on_grass.png",
]

# Alpha-blended sprites drawn over a tile. Craftax loads the player with
# clamp_alpha=False so the edges blend rather than hard-cut.
OVERLAYS = [
    ("player_left", "player-left.png"), ("player_right", "player-right.png"),
    ("player_up", "player-up.png"), ("player_down", "player-down.png"),
    ("player_sleep", "player-sleep.png"),
    ("zombie", "zombie.png"), ("cow", "cow.png"), ("skeleton", "skeleton.png"),
    ("arrow_up", "arrow-up.png"), ("arrow_down", "arrow-down.png"),
    ("arrow_left", "arrow-left.png"), ("arrow_right", "arrow-right.png"),
]

# Inventory icons, at ICON px. The third element is whether Craftax applies
# its alpha mask (RGB * alpha, so transparent pixels go black) before drawing.
# Upstream is NOT consistent about this — health/food/drink/energy, wood,
# stone, coal, iron, diamond, sapling and wood_pickaxe are taken as
# [:, :, :3] with no mask, while the other five tools go through
# apply_alpha(). Reproduced item by item rather than tidied up.
INVENTORY = [
    ("health", "health.png", False), ("food", "food.png", False),
    ("drink", "drink.png", False), ("energy", "energy.png", False),
    ("inv_sapling", "sapling.png", False), ("inv_wood", "wood.png", False),
    ("inv_stone", "stone.png", False), ("inv_coal", "coal.png", False),
    ("inv_iron", "iron.png", False), ("inv_diamond", "diamond.png", False),
    ("inv_wpick", "wood_pickaxe.png", False),
    ("inv_spick", "stone_pickaxe.png", True),
    ("inv_ipick", "iron_pickaxe.png", True),
    ("inv_wsword", "wood_sword.png", True),
    ("inv_ssword", "stone_sword.png", True),
    ("inv_isword", "iron_sword.png", True),
]

# Count digits, at DIGIT px. Craftax clamps their alpha to 0/1 and draws them
# as a hard stencil (multiply the destination by 1-alpha, then add the
# premultiplied texture), so these are never blended.
DIGITS = [(f"digit_{d}", f"{d}.png") for d in range(1, 10)]


def load(name: str, opaque: bool, size: int = TILE) -> Image.Image:
    """One texture, Craftax's way: 16x16 RGBA, NEAREST-resized to TILE.

    ``opaque`` is the block case. Craftax builds block textures as
    ``load_texture(...)[:, :, :3]`` — it discards alpha entirely, so a block
    is always fully opaque however its PNG was authored. Forcing alpha to 255
    here reproduces that. (Its ``clamp_alpha`` only touches the alpha channel,
    which NEAREST never mixes, so RGB is unaffected either way.)

    Overlays keep their real alpha: Craftax loads the player and mobs with
    ``clamp_alpha=False`` and blends them over the tile by ``alpha / 255``.
    """
    img = Image.open(ASSETS / name).convert("RGBA")
    if img.size != (SRC_TILE, SRC_TILE):
        raise SystemExit(f"{name}: expected 16x16, got {img.size}")
    if size != SRC_TILE:
        img = img.resize((size, size), resample=Image.NEAREST)
    if opaque:
        r, g, b, _ = img.split()
        img = Image.merge("RGBA", (r, g, b, Image.new("L", img.size, 255)))
    return img


def night_noise_f32() -> bytes:
    """Craftax's night_noise_intensity_texture, float32 little-endian, row-major
    (49 rows, 63 cols). Exactly the numpy expression in constants.py, then cast
    to float32 the way JAX canonicalises it; see the module docstring."""
    xs, ys = np.meshgrid(
        np.linspace(-1, 1, OBS_DIM[0] * TILE),
        np.linspace(-1, 1, OBS_DIM[1] * TILE),
    )
    tex = 1 - np.exp(-0.5 * (xs**2 + ys**2) / (0.5**2)).T
    assert tex.shape == (OBS_DIM[0] * TILE, OBS_DIM[1] * TILE), tex.shape
    return tex.astype(np.float32).astype("<f4").tobytes()


def main() -> int:
    if not ASSETS.is_dir():
        raise SystemExit(f"no vendored assets at {ASSETS}")

    sprites: list[tuple[str, bytes]] = []

    for i, fname in enumerate(BLOCKS):
        if i == 1:
            # OUT_OF_BOUNDS: solid grey 128, opaque. Not a texture in Craftax.
            sprites.append(("block_1", bytes([128, 128, 128, 255] * TILE * TILE)))
            continue
        sprites.append((f"block_{i}", load(fname, opaque=True).tobytes()))

    for key, fname in OVERLAYS:
        sprites.append((key, load(fname, opaque=False).tobytes()))

    # Icons and digits live in their own runs because they are not TILE-sized.
    icons: list[tuple[str, bytes]] = []
    for key, fname, masked in INVENTORY:
        img = load(fname, opaque=False, size=ICON)
        px = bytearray(img.tobytes())
        # Craftax draws icons with .set() — a hard overwrite, no blending — so
        # alpha is not used at draw time. Bake the two upstream variants in.
        for i in range(0, len(px), 4):
            a = px[i + 3]
            if masked and a != 255:
                px[i] = px[i + 1] = px[i + 2] = 0
            px[i + 3] = 255
        icons.append((key, bytes(px)))

    digits: list[tuple[str, bytes]] = []
    for key, fname in DIGITS:
        img = load(fname, opaque=False, size=DIGIT)
        px = bytearray(img.tobytes())
        # clamp_alpha: 255 stays, anything else is transparent.
        for i in range(0, len(px), 4):
            px[i + 3] = 255 if px[i + 3] == 255 else 0
        digits.append((key, bytes(px)))

    stride = TILE * TILE * 4
    for key, data in sprites:
        assert len(data) == stride, f"{key}: {len(data)} bytes, expected {stride}"
    for key, data in icons:
        assert len(data) == ICON * ICON * 4, key
    for key, data in digits:
        assert len(data) == DIGIT * DIGIT * 4, key

    blob = b"".join(d for _, d in sprites)
    index = {key: i for i, (key, _) in enumerate(sprites)}
    icon_blob = b"".join(d for _, d in icons)
    icon_index = {key: i for i, (key, _) in enumerate(icons)}
    digit_blob = b"".join(d for _, d in digits)
    def b64wrap(data):
        t = base64.b64encode(data).decode()
        parts = [t[i : i + 100] for i in range(0, len(t), 100)]
        return "\n  '" + "' +\n  '".join(parts) + "'"

    b64 = base64.b64encode(blob).decode()
    # Wrap so the generated file stays readable in a diff.
    lines = [b64[i : i + 100] for i in range(0, len(b64), 100)]
    joined = "\n  '" + "' +\n  '".join(lines) + "'"

    entries = "\n".join(f"  {k}: {v}," for k, v in index.items())
    icon_entries = "\n".join(f"  {k}: {v}," for k, v in icon_index.items())
    icons_b64 = b64wrap(icon_blob)
    digits_b64 = b64wrap(digit_blob)
    night_blob = night_noise_f32()
    night_b64 = b64wrap(night_blob)
    OUT.write_text(f"""// 15_atlas.js — GENERATED by tools/craftax_atlas.py. DO NOT EDIT.
//
// Craftax's own textures, baked to {TILE}x{TILE} RGBA and base64'd so the bundle
// stays one flat script with no assets to load at runtime.
//
// The {TILE}x{TILE} size is not a choice: Craftax renders the agent view at
// BLOCK_PIXEL_SIZE_AGENT = {TILE}, resizing each 16x16 asset with PIL NEAREST.
// That resize is done at bake time, by the same rule, so the runtime blit is
// 1:1 and needs no resampling — see tools/craftax_atlas.py for why blitting
// 16x16 down to {TILE}x{TILE} at runtime would give a different image.
//
// Source: github.com/MichaelTMatthews/Craftax, MIT, vendored at
// games/craftax_assets/ (see its README for the pinned commit).

const ATLAS_TILE = {TILE};
const ATLAS_COUNT = {len(sprites)};
const ATLAS_STRIDE = ATLAS_TILE * ATLAS_TILE * 4;

// Sprite index by name; multiply by ATLAS_STRIDE for the byte offset.
const ATLAS = {{
{entries}
}};

const ATLAS_B64 ={joined};

// Inventory icons, {ICON}x{ICON} (int(0.8 * {TILE})). Drawn with a hard overwrite,
// so alpha is already resolved into the bytes here.
const ICON_TILE = {ICON};
const ICON_STRIDE = ICON_TILE * ICON_TILE * 4;
const ICONS = {{
{icon_entries}
}};
const ICONS_B64 ={icons_b64};

// Count digits, {DIGIT}x{DIGIT} (int(0.6 * {TILE})), index 0 = digit 1. Drawn as a
// stencil: alpha is 0 or 255 and never blended.
const DIGIT_TILE = {DIGIT};
const DIGIT_STRIDE = DIGIT_TILE * DIGIT_TILE * 4;
const DIGITS_B64 ={digits_b64};

// Craftax's night_noise_intensity_texture: {OBS_DIM[0] * TILE} rows x {OBS_DIM[1] * TILE} cols of
// float32, little-endian, row-major. A radial falloff that scales the night
// static toward the edges of the view. Baked rather than computed because
// Math.exp is not the same function in every engine — see the tool.
const NIGHT_NOISE_ROWS = {OBS_DIM[0] * TILE};
const NIGHT_NOISE_COLS = {OBS_DIM[1] * TILE};
const NIGHT_NOISE_B64 ={night_b64};
""")
    print(f"wrote {OUT.relative_to(REPO)}")
    print(f"  {len(sprites)} tiles at {TILE}x{TILE}, {len(icons)} icons at "
          f"{ICON}x{ICON}, {len(digits)} digits at {DIGIT}x{DIGIT}, "
          f"night noise {len(night_blob) // 4} float32")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
