# DMLab assets (CC BY 4.0)

The images in this directory are derived from the `//assets` directory of
DeepMind Lab, https://github.com/google-deepmind/lab (commit `b1db91af5b4d2f3a24466f4632a3e5e1b0829cca`), copyright DeepMind
Technologies Limited, licensed under the Creative Commons Attribution 4.0
International licence (https://creativecommons.org/licenses/by/4.0/; the full
text is in lab's `LICENSE`, section "License for //assets").

**Changes made.** Each surface texture is a composite of the stages of its
Quake 3 shader evaluated at time 0 with the lightmap set to 1, with
view-dependent environment-mapped stages left out, box-filtered down to
64x64 pixels. Skybox faces are box-filtered down to 64x64. Sprites
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
