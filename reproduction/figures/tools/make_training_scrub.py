"""Render the cavequest training-return curves as TWO scrubber sprite-sheets,
one per architecture: cavequest_training_scrub_lstm.png (N=1-10) and
cavequest_training_scrub_ff.png (N=1..300). Each frame shows one run's curve
highlighted in the arch color + a clear title, with the other same-arch runs as
faint gray ghosts. Packed vertically -> the deck's frame scrubber steps through."""
import re
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import imageio.v2 as imageio
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
KEY = "charts/ep_return_mean"
GROUPS = [("cavequest_finesweep", "IMPALA-LSTM", "#4C72B0", "lstm"),
          ("cavequest_ff_nsweep", "IMPALA-FF",   "#DD8452", "ff")]
FW, FH, DPI = 640, 470, 100          # frame pixels (figsize = FW/DPI x FH/DPI)
YMAX = 105000

api = wandb.Api(timeout=40)

def getN(r):
    m = re.search(r"_N(\d+)", r.name)
    return int(m.group(1)) if m else int(r.config.get("train_pool", {}).get("n_train_bindings", 0))

for grp, title, color, tag in GROUPS:
    runs = sorted(api.runs(ENT, filters={"group": grp}), key=getN)
    runs_data = []
    for r in runs:
        total = float(r.config.get("total_steps", 10_000_000))
        h = r.history(keys=[KEY], samples=800).dropna(subset=[KEY])
        if h.empty:
            print("no history:", r.name); continue
        x = h["_step"].to_numpy() / h["_step"].max() * (total / 1e6)
        runs_data.append((getN(r), x, h[KEY].to_numpy()))

    frames = []
    for (N, x, y) in runs_data:
        fig = plt.figure(figsize=(FW / DPI, FH / DPI), dpi=DPI)
        ax = fig.add_axes([0.14, 0.15, 0.82, 0.72])
        for (_, gx, gy) in runs_data:                 # faint same-arch ghosts
            ax.plot(gx, gy, lw=1.0, color="0.6", alpha=0.25)
        ax.plot(x, y, lw=2.6, color=color)            # highlighted run
        ax.set_xlim(0, 10); ax.set_ylim(-3000, YMAX)
        ax.set_xlabel("env steps (millions)", fontsize=12)
        ax.set_ylabel("training return (ep mean)", fontsize=12)
        ax.set_title(f"{title}      N = {N}", fontsize=16, color=color, fontweight="bold")
        fig.canvas.draw()
        w, h = fig.canvas.get_width_height()
        buf = np.frombuffer(fig.canvas.buffer_rgba(), np.uint8).reshape(h, w, 4)[..., :3]
        frames.append(buf.copy())
        plt.close(fig)

    h, w = frames[0].shape[:2]
    sheet = np.zeros((len(frames) * h, w, 3), np.uint8)
    for i, f in enumerate(frames):
        sheet[i * h:(i + 1) * h] = f
    out = f"outputs/figs/cavequest_training_scrub_{tag}.png"
    imageio.imwrite(out, sheet)
    print(f"saved {out}: {len(frames)} frames, fw={w} fh={h}")
