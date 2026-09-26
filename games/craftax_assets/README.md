# `games/craftax_assets/` — vendored Craftax textures

The 16x16 PNG sprites Craftax renders its pixel observation from. They are
**source assets, not build inputs at runtime**: `tools/craftax_atlas.py`
bakes them into `src/15_atlas.js` (base64 RGBA at 7x7) and the shipped game
carries no files.

**Do not edit anything here.** These are the reference textures.

## Provenance

| field | value |
|---|---|
| upstream | https://github.com/MichaelTMatthews/Craftax |
| path | `craftax/craftax_classic/assets/` |
| commit | `c3c2e0d038c4e641f9481320c158f457f30c28f3` |
| vendored | 2026-09-14 |
| licence | MIT — see `LICENSE`, and the row in `/THIRD_PARTY_LICENSES.md` |
| files | 59 PNGs, all 16x16 RGBA |

## How they are used

`tools/craftax_atlas.py` reproduces Craftax's own pipeline:

- resize 16x16 -> 7x7 with **PIL NEAREST**, which is what
  `BLOCK_PIXEL_SIZE_AGENT = 7` means in `craftax_classic/constants.py`;
- block textures are taken as RGB (`[:, :, :3]` upstream), so they are always
  fully opaque whatever the PNG's alpha says;
- `BlockType.OUT_OF_BOUNDS` is not a texture at all — upstream replaces it
  with solid grey 128, and so do we;
- the player and mobs keep their real alpha and are composited.

The downscale happens at **bake time on purpose**. Craftax's NEAREST resize
maps destination pixel `x` to source `floor((x + 0.5) * 16 / 7)`; the
rasterizer's blit maps `floor(x * 16 / 7)`. Those pick different source
pixels, so resizing at runtime would produce a different image. Baking to
7x7 makes the runtime blit 1:1 and removes the question.

## Re-baking

```sh
uv run python tools/craftax_atlas.py
just bundle craftax_classic
```
