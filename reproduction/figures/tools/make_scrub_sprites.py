"""Turn rollout GIFs into frame sprite-sheets for the deck's frame-by-frame
scrubber. Each GIF -> one PNG grid of 64x64 frames (row-major, COLS wide) in
outputs/figs/cavequest_wins/scrub/, and prints the <div data-*> the deck needs."""
import sys
from pathlib import Path
import numpy as np
import imageio.v2 as imageio

COLS = 16          # frames per row in the sprite sheet
FS = 64            # native frame size (gifs are upscaled multiples of 64)
OUT = Path("outputs/figs/cavequest_wins/scrub")

GIFS = [
    "outputs/figs/cavequest_wins/lstm/lstm_seed1703_key1-1_mid_len016.gif",
    "outputs/figs/cavequest_wins/lstm/lstm_seed767_key0-0_FARtop_len022.gif",
    "outputs/figs/cavequest_wins/ff_fails/ff_seed1703_key1-1_mid_FAIL_len287.gif",
    "outputs/figs/cavequest_wins/ff_fails/ff_seed767_key0-0_FARtop_FAIL_len287.gif",
]

OUT.mkdir(parents=True, exist_ok=True)
for g in GIFS:
    frames = imageio.mimread(g, memtest=False)
    fr = [np.asarray(f)[..., :3] for f in frames]
    scale = max(1, fr[0].shape[0] // FS)          # downscale back to native 64x64
    fr = [f[::scale, ::scale][:FS, :FS] for f in fr]
    n = len(fr)
    rows = (n + COLS - 1) // COLS
    sheet = np.zeros((rows * FS, COLS * FS, 3), np.uint8)
    for i, f in enumerate(fr):
        r, c = divmod(i, COLS)
        sheet[r * FS:(r + 1) * FS, c * FS:(c + 1) * FS] = f
    name = Path(g).stem.split("_key")[0] + ".png"   # e.g. lstm_seed1703.png
    imageio.imwrite(OUT / name, sheet)
    print(f'{name}: frames={n} cols={COLS}  -> {OUT/name}')
