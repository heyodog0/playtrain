"""Annotated filmstrips: ~7 key frames of one held-out episode in a row, with
step labels + a narrating title. Static, paper/slide-ready (no playback).
Builds an LSTM (search-win) and an FF (stuck) strip on the SAME held-out seed."""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
sys.path.insert(0, "tools")
from make_run_card import find_checkpoint, load_policy, rollout_one
from rollout import pick_device
from playtrain.runtime import PlayTrainEnv
from analogen.generalization import WIN_RETURN_THRESHOLD

GAME = "analogen_cavequest_easy"
device = pick_device("auto")
outdir = Path("outputs/figs/behavior"); outdir.mkdir(parents=True, exist_ok=True)
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 439   # far-key (top corner)

def roll(run):
    cfg = json.loads((Path(run) / "config.json").read_text())
    env = PlayTrainEnv(game=GAME, max_steps=cfg.get("max_steps", 2000),
                     frame_skip=int(cfg.get("frame_skip", 7)))
    pol = load_policy(find_checkpoint(Path(run)), env, device, cfg)
    ep = rollout_one(pol, env, seed=SEED, device=device, deterministic=True)
    env.close()
    return ep

def door_open_step(frames):
    # door tile centre ~ (col2,row2): cols 21..32, rows 21..32 in 64px. Open = blue gone.
    for i, f in enumerate(frames):
        patch = f[22:31, 22:31]
        blue = (patch[..., 2].astype(int) > 120) & (patch[..., 0].astype(int) < 80)
        if blue.mean() < 0.1:
            return i
    return None

def filmstrip(run, title, fname):
    ep = roll(run)
    fr = ep["frames"]
    n = len(fr)
    won = ep["total_return"] >= WIN_RETURN_THRESHOLD
    do = door_open_step(fr)
    # choose ~7 informative frame indices
    idxs = sorted(set([0] + [int(n * t) for t in (0.15, 0.3, 0.45, 0.6, 0.8)] + [n - 1]))
    if do is not None:
        idxs = sorted(set(idxs + [do]))
    k = len(idxs)
    fig, axes = plt.subplots(1, k, figsize=(2.1 * k, 2.7))
    for ax, i in zip(axes, idxs):
        ax.imshow(fr[i]); ax.set_xticks([]); ax.set_yticks([])
        cap = f"step {i}"
        if i == 0: cap += "\nstart"
        elif do is not None and i == do: cap += "\nDOOR OPENS"
        elif i == n - 1: cap += ("\nGOAL (win)" if won else "\ntimeout (fail)")
        ax.set_xlabel(cap, fontsize=11)
    res = "WIN" if won else "FAIL"
    fig.suptitle(f"{title}  —  held-out seed {SEED}  —  {res} "
                 f"(return {ep['total_return']:.0f}, {n} steps)", fontsize=14, y=1.02)
    fig.tight_layout()
    fig.savefig(outdir / fname, dpi=150, bbox_inches="tight")
    print("saved", fname, "| won", won, "| len", n, "| door_open@", do)

filmstrip("outputs/impala_cavequest_finesweep_N08",
          "IMPALA-LSTM (N=8): searches items → finds key → opens door → goal",
          f"filmstrip_lstm_seed{SEED}.png")
filmstrip("outputs/impala_cavequest_ff_nsweep_N016",
          "IMPALA-FF (Markov): cannot track tried items → stuck",
          f"filmstrip_ff_seed{SEED}.png")
