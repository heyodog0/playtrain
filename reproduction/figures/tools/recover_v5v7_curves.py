"""Reconstruct the v5/v7 review-deck training-curve figures from W&B history.

The original PNGs were gitignored on-disk renders, lost when the run dirs were
pruned; the model checkpoints are gone everywhere (W&B kept metrics only), so the
rollout GIFs / generalization tables can't come back -- but every training curve
can, because charts/ep_return_mean survives in the W&B history for each run.

Style mirrors tools/make_run_card.py: teal (#0a8c7e) raw+smoothed return vs env
steps (M), dotted win-threshold line at 30k. Panels are titled by their actual
W&B run/group names so nothing about which run is shown is fabricated.

    python tools/recover_v5v7_curves.py
"""
import re
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
import wandb

ENT = "truongtruong-harvard-university/analogen"
KEY = "charts/ep_return_mean"
WIN_THRESHOLD = 30_000
TEAL = "#0a8c7e"

api = wandb.Api(timeout=60)


def total_steps(r):
    t = r.config.get("total_steps")
    if t:
        return float(t)
    m = re.search(r"_(\d+)m", r.name.lower())
    return float(m.group(1)) * 1e6 if m else 10e6


def curve(r):
    """(x in env-step millions, raw return). wandb _step is a log counter, so map
    it linearly onto the run's true env-step budget (matches plot_cavequest_training)."""
    h = r.history(keys=[KEY], samples=4000)
    if h.empty or KEY not in h:
        return None
    h = h.dropna(subset=[KEY])
    if h.empty:
        return None
    x = h["_step"] / h["_step"].max() * (total_steps(r) / 1e6)
    return x.to_numpy(), h[KEY].to_numpy()


def _auto_window(n):
    return int(np.clip(n * 0.04, 5, 2000))


def _smooth(x, w):
    if w <= 1 or x.size <= w:
        return None
    half = w // 2
    out = np.full(x.size, np.nan)
    for i in range(x.size):
        seg = x[max(0, i - half):min(x.size, i + half + 1)]
        seg = seg[np.isfinite(seg)]
        if seg.size:
            out[i] = seg.mean()
    return out


def draw(ax, xy, title):
    if xy is None:
        ax.text(0.5, 0.5, "no history", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(title, fontsize=11)
        return
    x, rets = xy
    sm = _smooth(rets, _auto_window(rets.size))
    if sm is not None:
        ax.plot(x, rets, color=TEAL, lw=0.6, alpha=0.25)
        ax.plot(x, sm, color=TEAL, lw=1.8)
    else:
        ax.plot(x, rets, color=TEAL, lw=1.6)
    ax.axhline(WIN_THRESHOLD, color="gray", lw=0.6, ls=":")
    ax.set_title(title, fontsize=11)
    ax.set_xlabel("env steps (M)")
    ax.set_ylabel("episode return")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def runs_in(group, finished_only=True):
    rs = list(api.runs(ENT, filters={"group": group}))
    if finished_only:
        rs = [r for r in rs if r.state == "finished"]
    return rs


def one_run(name_substr, group):
    for r in runs_in(group):
        if name_substr in r.name:
            return r
    return None


def grid(panels, out, suptitle, ncols):
    """panels: list of (title, run). Renders an nrows x ncols grid."""
    n = len(panels)
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(6.0 * ncols, 4.4 * nrows),
                             squeeze=False)
    for ax in axes.flat:
        ax.set_visible(False)
    for ax, (title, r) in zip(axes.flat, panels):
        ax.set_visible(True)
        draw(ax, curve(r) if r is not None else None, title)
    fig.suptitle(suptitle, fontsize=15)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(out, dpi=140)
    plt.close(fig)
    print("saved", out, f"({n} panels)")


def single(run, out, title):
    fig, ax = plt.subplots(figsize=(6.4, 4.6), dpi=130)
    draw(ax, curve(run) if run is not None else None, title)
    fig.tight_layout()
    fig.savefig(out, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("saved", out)


# 1-2: v7 6x6 (1-inv) LSTM fs7 seed0/seed1 single-run cards (deck ids 19606204/05).
# These are the WINNING 6x6-inv1 runs (~97,110 / 96,480) that the slide captions —
# NOT v7_lstm_frameskip7 (base v7, game=analogen_nomemory_grid_v7, never wins).
single(one_run("seed0", "v7_2rooms_door_6x6_inv1_impala_lstm_fs7"),
       "outputs/figs/run_cards/impala_19606204/impala_19606204_plot.png",
       "v7 6x6 (1-inv) LSTM fs7 · seed 0")
single(one_run("seed1", "v7_2rooms_door_6x6_inv1_impala_lstm_fs7"),
       "outputs/figs/run_cards/impala_19606205/impala_19606205_plot.png",
       "v7 6x6 (1-inv) LSTM fs7 · seed 1")

# 3: v7 full 2x2 ablation — reward clip (symlog / abs_one) x seed (8 / 9)
v7_panels = [
    ("symlog · seed 8", one_run("seed8", "v7_lstm_frameskip7_g99_symlog")),
    ("symlog · seed 9", one_run("seed9", "v7_lstm_frameskip7_g99_symlog")),
    ("abs_one · seed 8", one_run("seed8", "v7_lstm_frameskip7_g99_abs_one")),
    ("abs_one · seed 9", one_run("seed9", "v7_lstm_frameskip7_g99_abs_one")),
]
grid(v7_panels, "outputs/figs/v7_full_curves_2x2.png",
     "v7 full · g99 frameskip7 · reward-clip x seed", ncols=2)

# 4: IMPALA door_6x6 matrix (v5_door_6x6_lstm_matrix, 4 runs)
imp_door = runs_in("v5_door_6x6_lstm_matrix")
grid([(r.name, r) for r in sorted(imp_door, key=lambda r: r.name)],
     "outputs/figs/impala_matrix_cards/impala_door_curves_grid.png",
     "IMPALA · door_6x6 · training return", ncols=2)

# 5: PPO door_6x6 matrix (v5_door_6x6_ppo_matrix, 6 runs)
ppo_door = runs_in("v5_door_6x6_ppo_matrix")
def ppo_title(r):
    return (r.name.replace("ppo_cnn_grid_v5_2rooms_door_6x6_", "")
                  .replace("_10m", ""))
grid([(ppo_title(r), r) for r in sorted(ppo_door, key=lambda r: r.name)],
     "outputs/figs/ppo_matrix_cards/ppo_door_curves_grid.png",
     "PPO · door_6x6 · training return", ncols=2)

# 6: IMPALA v5 full-task reward-design matrix (one seed0 run per reward variant)
v5_groups = [
    ("base lstm", "v5_base_lstm_50m"),
    ("base lstm symlog g999", "v5_base_lstm_symlog_g999_50m"),
    ("base lstm symlog fs7", "v5_base_lstm_symlog_frameskip7_50m"),
    ("stepcost lstm symlog g999", "v5_stepcost_lstm_symlog_g999_50m"),
    ("stepcost lstm abs_one fs7", "v5_stepcost_lstm_abs_one_frameskip7_50m"),
    ("stepcost lstm fs7", "v5_stepcost_lstm_frameskip7"),
]
v5_panels = []
for label, g in v5_groups:
    rs = runs_in(g)
    r = next((x for x in rs if "seed0" in x.name), rs[0] if rs else None)
    v5_panels.append((label, r))
grid(v5_panels, "outputs/figs/impala_v5_matrix_cards/impala_v5_curves_grid.png",
     "IMPALA · v5 full task · reward design", ncols=2)
