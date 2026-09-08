"""Behavioral aggregates for the v1.9 held-out evals, from frames only
(the Python env's info doesn't expose pos/pickups, so we recover them visually):

  - state-occupancy heatmap  (player cell via skin-color centroid)
  - steps-to-win histogram    (episode length on wins = search effort, exact)
  - #pickups histogram        (frame-based: item icon vanishes under the player)

Outputs PNGs to outputs/figs/behavior/. Compares IMPALA-LSTM vs IMPALA-FF.
"""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
sys.path.insert(0, "tools")
from make_run_card import find_checkpoint, load_policy, rollout_one
from rollout import pick_device
from playtrain.runtime import PlayTrainEnv
from analogen.generalization import eval_pool, WIN_RETURN_THRESHOLD

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

GAME = "analogen_cavequest_easy"
RUNS = {
    "IMPALA-LSTM": "outputs/impala_cavequest_finesweep_N08",
    "IMPALA-FF":   "outputs/impala_cavequest_ff_nsweep_N016",
}
COLORS = {"IMPALA-LSTM": "#4C72B0", "IMPALA-FF": "#DD8452"}
ROWS = COLS = 6
device = pick_device("auto")
heldout = eval_pool(scan=50000, eval_per_binding=1, game=GAME)
outdir = Path("outputs/figs/behavior"); outdir.mkdir(parents=True, exist_ok=True)

# obs is 64x64; each grid cell ~ 64/6 px. Skin color of the avatar face = (255,224,189),
# unique on the board -> its centroid localizes the player.
CELL = 64.0 / 6.0
def player_cell(frame):
    skin = (np.abs(frame[..., 0].astype(int) - 255) < 25) & \
           (np.abs(frame[..., 1].astype(int) - 224) < 25) & \
           (np.abs(frame[..., 2].astype(int) - 189) < 25)
    ys, xs = np.where(skin)
    if len(xs) == 0:
        return None
    c = int(np.clip(xs.mean() // CELL, 0, COLS - 1))
    r = int(np.clip(ys.mean() // CELL, 0, ROWS - 1))
    return (c, r)

def item_present(frame, cell):
    # is there a non-floor icon in this cell's interior? (floor is near-black)
    c, r = cell
    y0, y1 = int(r * CELL) + 2, int((r + 1) * CELL) - 2
    x0, x1 = int(c * CELL) + 2, int((c + 1) * CELL) - 2
    patch = frame[y0:y1, x0:x1]
    return bool((patch.max(axis=-1) > 60).mean() > 0.12)  # >12% lit pixels

def analyze(run):
    cfg = json.loads((Path(run) / "config.json").read_text())
    env = PlayTrainEnv(game=GAME, max_steps=cfg.get("max_steps", 2000),
                     frame_skip=int(cfg.get("frame_skip", 7)))
    pol = load_policy(find_checkpoint(Path(run)), env, device, cfg)
    occ = np.zeros((ROWS, COLS))
    win_len, pickups = [], []
    wins = 0
    for s in heldout:
        ep = rollout_one(pol, env, seed=s, device=device, deterministic=True)
        fr = ep["frames"]
        won = ep["total_return"] >= WIN_RETURN_THRESHOLD
        wins += int(won)
        # occupancy + frame-based pickup count (icon under player vanishes)
        n_pick = 0
        prev_cell = None
        prev_had = False
        for f in fr:
            pc = player_cell(f)
            if pc is None:
                continue
            occ[pc[1], pc[0]] += 1
            had = item_present(f, pc)
            if prev_cell == pc and prev_had and not had:
                n_pick += 1   # an icon under the player disappeared -> a grab
            prev_cell, prev_had = pc, had
        if won:
            win_len.append(ep["length"])
            pickups.append(n_pick)
    env.close()
    return dict(occ=occ, win_len=win_len, pickups=pickups, wins=wins, n=len(heldout))

print("device:", device, "| held-out:", len(heldout))
res = {name: analyze(run) for name, run in RUNS.items()}
for name, r in res.items():
    print(f"{name}: wins {r['wins']}/{r['n']}  win-len mean {np.mean(r['win_len']) if r['win_len'] else float('nan'):.1f}"
          f"  pickups/win mean {np.mean(r['pickups']) if r['pickups'] else float('nan'):.2f}")

LBL, TICK, TITLE = 18, 14, 16

# --- occupancy heatmap (one panel per arch) ---
fig, axes = plt.subplots(1, 2, figsize=(11, 5))
for ax, (name, r) in zip(axes, res.items()):
    occ = r["occ"] / max(r["occ"].sum(), 1)
    im = ax.imshow(occ, cmap="magma", interpolation="nearest")
    ax.set_title(f"{name}\n(held-out occupancy, {r['wins']}/{r['n']} won)", fontsize=TITLE)
    ax.set_xticks(range(COLS)); ax.set_yticks(range(ROWS))
    ax.tick_params(labelsize=TICK)
    ax.grid(False)
fig.colorbar(im, ax=axes, fraction=0.046, label="visit fraction")
fig.savefig(outdir / "occupancy_heatmap.png", dpi=160, bbox_inches="tight")
print("saved occupancy_heatmap.png")

# --- steps-to-win histogram (search effort) ---
fig, ax = plt.subplots(figsize=(8.5, 5.5))
hi = max([max(r["win_len"]) for r in res.values() if r["win_len"]] + [60])
bins = np.arange(0, hi + 12, 8)
for name, r in res.items():
    if r["win_len"]:
        ax.hist(r["win_len"], bins=bins, alpha=0.6, color=COLORS[name],
                label=f"{name} ({len(r['win_len'])}/{r['n']} won, mean {np.mean(r['win_len']):.0f} steps)")
ax.set_xlabel("Steps to win  (= search effort)", fontsize=LBL)
ax.set_ylabel("# held-out configs", fontsize=LBL)
ax.tick_params(labelsize=TICK)
ax.set_xlim(0, hi + 10)
ax.set_title("FF only wins the short, no-search configs", fontsize=TITLE)
ax.legend(fontsize=12)
fig.tight_layout(); fig.savefig(outdir / "steps_to_win_hist.png", dpi=160)
print("saved steps_to_win_hist.png")
