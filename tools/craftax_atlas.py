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
"""

from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
ASSETS = REPO / "games" / "craftax_assets"
OUT = (REPO / "examples" / "games" / "multifile" / "parity" / "craftax_classic"
       / "src" / "15_atlas.js")

TILE = 7          # BLOCK_PIXEL_SIZE_AGENT
SRC_TILE = 16     # every Craftax asset is 16x16

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

# The two inventory rows: item icons, the four intrinsic icons, and digits.
INVENTORY = [
    ("inv_wood", "wood.png"), ("inv_stone", "stone.png"), ("inv_coal", "coal.png"),
    ("inv_iron", "iron.png"), ("inv_diamond", "diamond.png"),
    ("inv_sapling", "sapling.png"),
    ("inv_wpick", "wood_pickaxe.png"), ("inv_spick", "stone_pickaxe.png"),
    ("inv_ipick", "iron_pickaxe.png"), ("inv_wsword", "wood_sword.png"),
    ("inv_ssword", "stone_sword.png"), ("inv_isword", "iron_sword.png"),
    ("health", "health.png"), ("food", "food.png"),
    ("drink", "drink.png"), ("energy", "energy.png"),
] + [(f"digit_{d}", f"{d}.png") for d in range(1, 10)]


def load(name: str, opaque: bool) -> Image.Image:
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
    if TILE != SRC_TILE:
        img = img.resize((TILE, TILE), resample=Image.NEAREST)
    if opaque:
        r, g, b, _ = img.split()
        img = Image.merge("RGBA", (r, g, b, Image.new("L", img.size, 255)))
    return img


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
    for key, fname in INVENTORY:
        sprites.append((key, load(fname, opaque=False).tobytes()))

    stride = TILE * TILE * 4
    for key, data in sprites:
        assert len(data) == stride, f"{key}: {len(data)} bytes, expected {stride}"

    blob = b"".join(d for _, d in sprites)
    index = {key: i for i, (key, _) in enumerate(sprites)}
    b64 = base64.b64encode(blob).decode()
    # Wrap so the generated file stays readable in a diff.
    lines = [b64[i : i + 100] for i in range(0, len(b64), 100)]
    joined = "\n  '" + "' +\n  '".join(lines) + "'"

    entries = "\n".join(f"  {k}: {v}," for k, v in index.items())
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
""")
    print(f"wrote {OUT.relative_to(REPO)}")
    print(f"  {len(sprites)} sprites at {TILE}x{TILE}, {len(blob)} bytes raw, "
          f"{len(b64)} base64")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
