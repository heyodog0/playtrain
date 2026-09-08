"""Make rollout gifs bigger + slower for sharing (Slack, decks).

Upscales each frame with NEAREST (keeps the 64x64 pixel art crisp, no blur) and
rewrites with a longer per-frame duration. Pure post-processing — works on any
existing gif, no checkpoints/cluster needed.

    uv run python tools/resize_gif.py outputs/figs/medium_winner/*_rollout.gif
    uv run python tools/resize_gif.py foo.gif --scale 6 --fps 10 --out-dir /tmp
"""
import argparse
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image


def resize_gif(src: Path, scale: int, fps: float, out_dir: Path | None,
               suffix: str) -> Path:
    frames = imageio.mimread(src, memtest=False)
    imgs = []
    for f in frames:
        im = Image.fromarray(np.asarray(f)).convert("RGB")
        if scale != 1:
            im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        imgs.append(im)
    dur_ms = round(1000.0 / fps)  # PIL gif duration is per-frame milliseconds
    out = (out_dir or src.parent) / f"{src.stem}{suffix}.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    imgs[0].save(out, save_all=True, append_images=imgs[1:],
                 duration=dur_ms, loop=0, disposal=2, optimize=True)
    w, h = imgs[0].size
    print(f"  {src.name} -> {out.name}  {w}x{h}  {len(imgs)} frames @ {fps}fps "
          f"({out.stat().st_size // 1024} KB)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gifs", type=Path, nargs="+", help="Input .gif file(s)")
    ap.add_argument("--scale", type=int, default=8,
                    help="Integer NEAREST upscale factor (64px -> 512px at 8)")
    ap.add_argument("--fps", type=float, default=8.0,
                    help="Output frames/sec (lower = slower; default 8)")
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="Write here instead of alongside each input")
    ap.add_argument("--suffix", default="_slack",
                    help="Suffix appended to the output stem")
    args = ap.parse_args()
    for g in args.gifs:
        if not g.exists():
            print(f"  skip (missing): {g}")
            continue
        resize_gif(g, args.scale, args.fps, args.out_dir, args.suffix)


if __name__ == "__main__":
    main()
