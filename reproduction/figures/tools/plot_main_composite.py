"""fig_main: (A) 24 game thumbnails, (B) variant pairs -- frames + base-vs-
variant curves (right column), (C) learning curves for eight of the panel-A
games, (D) environment-layer throughput, three panels flat across the bottom.

A and C share a 2x4 column order so each thumbnail sits directly above its
curve. B reuses the variant-strip PNGs from render_variant_strips.py. D draws
the committed throughput data via throughput_panels.py -- the same code behind
the standalone plot_throughput_all.py -- so the two never diverge.

Reads TB dirs directly; partial runs give partial curves. Re-run on drain.
Usage: python tools/plot_main_composite.py outputs/figs/fig_main.png
"""
import glob, json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from PIL import Image
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

from throughput_panels import (C_ALE, C_PROCGEN, INK, ladder_panel, load,
                               throughput_panel)

IMP_C, PPO_C = "#1f77b4", "#ff7f0e"

GAMES_ALL = ["asteroids", "bigfish", "bossfight", "breakout", "caveflyer",
             "chaser", "climber", "coinrun", "dodgeball", "freeway",
             "frostbite", "fruitbot", "heist", "jumper", "leaper", "maze",
             "miner", "ninja", "plunder", "pong", "qbert", "seaquest",
             "space_invaders", "starpilot"]
GAMES8 = ["bigfish", "bossfight", "chaser", "leaper",
          "ninja", "starpilot", "miner", "pong"]
# Retired ImpalaCNN fixed block. It paired ImpalaCNN IMPALA with ImpalaCNN PPO
# for these games while every other game paired ImpalaCNN IMPALA with NATURE
# PPO -- so the panel mixed encoders across games AND mismatched them within the
# other five. Everything is Nature now; kept only because IMPALA_FALLBACK and
# the loader below still reference the names.
IMPALA_RUNS = {
  "bigfish": ["impala_34819869", "impala_34897676", "impala_34897678"],
  "coinrun": ["impala_34824270", "impala_34897679", "impala_34897680"],
  "seaquest":["impala_34824301", "impala_34897683", "impala_34897684"],
  "pong":    ["impala_34824299", "impala_34897685", "impala_34897686"],
  "miner":   ["impala_34824295", "impala_34897687", "impala_34897688"],
}
# interim fallback until the 3-seed pv_i runs land: DDP2-suite 150M runs
IMPALA_FALLBACK = {
  "caveflyer": ["impala_34824267"],
  "plunder": ["impala_34824297"],
  "space_invaders": ["impala_34824302"],
}
PAIRS = [("breakout", "breakout.multi", "multi-ball + pierce"),
         ("qbert", "qbert.v2", "new enemies + open map"),
         ("flappy_bird", "flappy_bird.dunk2", "new objective"),
         ("frostbite", "frostbite.jungle", "retheme + layout")]
FRAMES = [30, 240, 480]


def load_tb(tb_dir, min_step=1e6):
    try:
        acc = EventAccumulator(tb_dir, size_guidance={"scalars": 0})
        acc.Reload()
        tag = [t for t in acc.Tags()["scalars"] if "return" in t.lower()][0]
        evs = [e for e in acc.Scalars(tag) if e.step >= min_step]
        if len(evs) < 5:
            return None
        return (np.array([e.step for e in evs], float),
                np.array([e.value for e in evs], float))
    except Exception:
        return None


def ema(y, span_frac=0.02):
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y); m = 0.0; c = 0.0
    for i, val in enumerate(y):
        m = alpha * val + (1 - alpha) * m
        c = alpha + (1 - alpha) * c
        out[i] = m / c
    return out


def band(runs, n=200):
    runs = [r for r in runs if r is not None]
    if not runs:
        return None
    # drop still-running stragglers so a fresh partial rerun doesn't
    # truncate finished siblings down to its own progress
    far = max(s[-1] for s, _ in runs)
    runs = [r for r in runs if r[0][-1] >= 0.6 * far]
    hi = min(s[-1] for s, _ in runs)
    lo = max(s[0] for s, _ in runs)
    grid = np.linspace(lo, hi, n)
    ys = np.stack([np.interp(grid, s, ema(v)) for s, v in runs])
    return grid / 1e6, ys.mean(0), ys.min(0), ys.max(0), len(runs)


# Ablations and probes that must never enter a figure: bench_* are throughput
# runs with a 1e12 step budget stopped by SIGINT, and _gamma is the flappy_bird
# discount ablation (0.999 instead of the paper's 0.99).
# "_partial" matters: a superseded run kept for reference sorts AFTER the
# rerun that replaced it ("..._s0_partial94M" > "..._s0"), so the
# latest-dir-wins tiebreak below silently preferred the stale one.
_EXCLUDE = ("bench_", "/_gamma/", "_partial", "_failed", "_dead")


def _runs(game, trainer):
    """3-seed IMPALA-CNN run dirs for `game`, one per seed (latest wins).

    Selected by CONFIG CONTENT, not by directory prefix. A single game's runs are
    spread over outputs/impala_*, outputs/_icnnfix, outputs/_icnnppo and
    outputs/_rerun, and prefix globs have twice silently dropped a whole arm --
    first the _natfix panel-C seeds, then the IMPALA-CNN PPO seeds -- each time
    rendering as a curve with no band rather than as an error. Reading the config
    cannot fail that way: a run either declares the right game, encoder and step
    budget or it does not.

    Trainer is inferred from the config key: IMPALA writes `total_steps`, PPO
    writes `total_timesteps`.
    """
    by_seed = {}
    for cj in (glob.glob("outputs/*/config.json")
               + glob.glob("outputs/*/*/config.json")):
        d = cj.rsplit("/", 1)[0]
        if any(x in cj for x in _EXCLUDE):
            continue
        try:
            c = json.load(open(cj))
        except Exception:
            continue
        if c.get("game") != game or c.get("net") != "impala":
            continue
        n = c.get("total_steps") or c.get("total_timesteps") or 0
        if not (100_000_000 <= n <= 200_000_000):
            continue
        if not glob.glob(f"{d}/tb/events*"):
            continue
        if ("total_steps" in c) != (trainer == "impala"):
            continue
        s = c.get("seed", 0)
        if s not in by_seed or d > by_seed[s]:
            by_seed[s] = d
    return sorted(by_seed.values())


def matrix_impala_runs(game):
    return _runs(game, "impala")


def ppo_dirs(game):
    return _runs(game, "ppo")


def curves_for(game, fixed_block):
    if fixed_block:
        imp = band([load_tb(f"outputs/{d}/tb") for d in IMPALA_RUNS[game]])
        ppo = band([load_tb(f"outputs/ppo_impala_{game}_s{s}/tb") for s in (0, 1, 2)])
    else:
        imp = band([load_tb(f"{d}/tb") for d in matrix_impala_runs(game)])
        if imp is None and game in IMPALA_FALLBACK:
            imp = band([load_tb(f"outputs/{d}/tb") for d in IMPALA_FALLBACK[game]])
        ppo = band([load_tb(f"{d}/tb") for d in ppo_dirs(game)])
    return imp, ppo


def style_axis(ax, fs_tick=8):
    ax.tick_params(labelsize=fs_tick)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)


# ---------------------------------------------------------------- figure
# The curves/thumbnails block keeps its original 13.6x8.0in geometry exactly;
# the figure just grows by the throughput row's height, and the block's margins
# are re-expressed as fractions of the taller canvas. --throughput-top puts the
# throughput row above that block instead of below, and relabels accordingly --
# note its rotated x-tick labels always hang below its axes, so on top they land
# in the gap between the two blocks.
FS_TITLE, FS_LAB, FS_TICK, FS_PANEL = 12.5, 12.5, 10.5, 21
FS_D = 0.70            # type scale for the throughput row, matching FS_LAB/FS_TICK
W, H_ABC = 13.6, 8.0
D_AX, D_LAB = 1.70, 0.62       # throughput axes height / rotated label strip
D_GAP = 0.30                   # slack between the two blocks
D_TOPPAD = 0.42                # room above the row for its letter, when on top
TOP = "--throughput-top" in sys.argv
# The throughput row moved to its own figure (fig:env_efficiency), which
# folds it together with the thread-scaling curves. Kept behind a flag
# rather than deleted so the four-panel version stays reproducible.
NOTP = "--no-throughput" in sys.argv

D_BLOCK = 0.0 if NOTP else (D_TOPPAD if TOP else D_GAP) + D_AX + D_LAB
H = H_ABC + D_BLOCK
d_bottom = ((H_ABC + D_LAB) if TOP else D_LAB) / H
d_top = d_bottom + D_AX / H
fig = plt.figure(figsize=(W, H))


def up(y):
    """Curves/thumbnails figure-fraction y from the original 8.0in layout."""
    return (y * H_ABC + (0.0 if TOP else D_BLOCK)) / H


outer = fig.add_gridspec(1, 2, width_ratios=[1.14, 1.38], wspace=0.15,
                         left=0.05, right=0.99, top=up(0.91), bottom=up(0.07))

# ---- left column: A (thumbs) over C (curves) ----
left = outer[0].subgridspec(2, 1, height_ratios=[1.35, 0.82], hspace=0.22)
gA = left[0].subgridspec(4, 6, hspace=0.34, wspace=0.10)
gC = left[1].subgridspec(2, 4, hspace=0.72, wspace=0.42)

for i, game in enumerate(GAMES_ALL):
    axa = fig.add_subplot(gA[i // 6, i % 6])
    try:
        img = np.asarray(Image.open(f"outputs/game_thumbs/{game}.png"))
        axa.imshow(img)
    except Exception:
        axa.text(0.5, 0.5, "?", ha="center", va="center")
    axa.set_title(game.replace("_", " "), fontsize=9.5, pad=2)
    axa.axis("off")

C_AXES = []
for i, game in enumerate(GAMES8):
    axc = fig.add_subplot(gC[i // 4, i % 4])
    imp, ppo = curves_for(game, fixed_block=False)   # Nature everywhere
    for data, color in ((imp, IMP_C), (ppo, PPO_C)):
        if data is None:
            continue
        x, m, lo, hi, k = data
        axc.plot(x, m, lw=1.4, color=color)
        if k > 1:
            axc.fill_between(x, lo, hi, color=color, alpha=0.18, lw=0)
    axc.set_title(game.replace("_", " "), fontsize=FS_TITLE, pad=3)
    axc.set_xlim(0, 100)
    axc.set_box_aspect(1.0)
    style_axis(axc, FS_TICK)
    C_AXES.append(axc)

# ---- right column: B (variant pairs), 2x2 cells of [strips over curve] ----
gB = outer[1].subgridspec(2, 2, hspace=0.16, wspace=0.18)

B_AXES = []
for i, (base, var, desc) in enumerate(PAIRS):
    cell = gB[i // 2, i % 2].subgridspec(2, 1, height_ratios=[2.45, 1.35],
                                         hspace=0.10)
    # frames: 2 rows (base over variant) x 3 capture times, as one image
    tiles = []
    ok = True
    for g in (base, var):
        row = []
        for t in FRAMES:
            p = f"outputs/variant_strips/{g.replace('.', '_')}_f{t:03d}.png"
            try:
                row.append(np.asarray(Image.open(p)))
            except Exception:
                ok = False
        if ok and row:
            row = [np.pad(r, ((0, 0), (0, 4), (0, 0)), constant_values=255)
                   for r in row[:-1]] + [row[-1]]
            tiles.append(np.concatenate(row, axis=1))
    axf = fig.add_subplot(cell[0])
    if ok and len(tiles) == 2:
        h = 6
        tiles = [np.pad(tiles[0], ((0, h), (0, 0), (0, 0)), constant_values=255),
                 tiles[1]]
        axf.imshow(np.concatenate(tiles, axis=0))
    else:
        axf.text(0.5, 0.5, "frames pending", ha="center", va="center",
                 fontsize=FS_LAB, color="#999999")
    axf.axis("off")

    # base and variant as two side-by-side axes, styled like panel C
    pair_gs = cell[1].subgridspec(1, 2, wspace=0.42)
    for j, (g, tag, ls) in enumerate(((base, "base", "-"),
                                      (var, "variant", "--"))):
        axc = fig.add_subplot(pair_gs[j])
        B_AXES.append(axc)
        imp = band([load_tb(f"{d}/tb") for d in matrix_impala_runs(g)])
        ppo = band([load_tb(f"{d}/tb") for d in ppo_dirs(g)])
        for data, color in ((imp, IMP_C), (ppo, PPO_C)):
            if data is None:
                continue
            x, m, lo, hi, k = data
            axc.plot(x, m, ls, lw=1.3, color=color)
            if k > 1:
                axc.fill_between(x, lo, hi, color=color, alpha=0.13, lw=0)
        axc.set_xlim(0, 100)
        style_axis(axc, FS_TICK)
        if i % 2 == 0 and j == 0:
            axc.set_ylabel("episode return", fontsize=FS_LAB - 2)
        axc.set_xlabel("env steps (M)", fontsize=FS_LAB - 3, labelpad=1.5)
def _c_legend_anchor(fig, axes_):
    """(x, y) in figure coords just above panel C, centred on its width."""
    fig.canvas.draw()
    boxes = [a.get_position() for a in axes_]
    x0 = min(b.x0 for b in boxes)
    x1 = max(b.x1 for b in boxes)
    y1 = max(b.y1 for b in boxes)
    # Absolute gap, not a figure fraction: 0.055 was tuned against the 10.62in
    # figure that included the throughput row, so with --no-throughput (H=8.0)
    # the same fraction shrinks to 0.44in and the legend crowds panel C.
    return ((x0 + x1) / 2.0, y1 + 0.62 / H)


def _b_legend_anchor(fig, axes_):
    """(x, y) in figure coords just above panel B, centred on its width."""
    fig.canvas.draw()
    boxes = [a.get_position() for a in axes_]
    x0 = min(b.x0 for b in boxes)
    x1 = max(b.x1 for b in boxes)
    return ((x0 + x1) / 2.0, up(0.995))

# one shared legend for panel B (trainer color x base/variant style)
fig.legend(handles=[Line2D([], [], color=IMP_C, lw=1.6, label="IMPALA"),
                    Line2D([], [], color=PPO_C, lw=1.6, label="PPO"),
                    Line2D([], [], color="#555555", lw=1.6, ls="-", label="base"),
                    Line2D([], [], color="#555555", lw=1.6, ls="--", label="variant")],
           loc="upper center", bbox_to_anchor=_b_legend_anchor(fig, B_AXES),
           ncol=4, fontsize=12, frameon=False, handlelength=1.6,
           columnspacing=1.2)

fig.legend(handles=[Line2D([], [], color=IMP_C, lw=1.6, label="IMPALA"),
                    Line2D([], [], color=PPO_C, lw=1.6, label="PPO")],
           loc="upper center", bbox_to_anchor=_c_legend_anchor(fig, C_AXES),
           ncol=2, fontsize=12, frameon=False, handlelength=1.6,
           columnspacing=1.2)

fig.text(0.245, up(0.012), "env steps (M)", fontsize=FS_LAB, ha="center")
fig.text(0.012, up(0.21), "episode return", fontsize=FS_LAB, va="center",
         rotation="vertical")

# ---- environment throughput, flat across the full width ----
# column widths track bar counts (17 / 9 / 3 groups) so bar width is uniform
if not NOTP:
    gD = fig.add_gridspec(1, 3, width_ratios=[17, 9, 5], wspace=0.20,
                          left=0.055, right=0.99, bottom=d_bottom, top=d_top)
    PROCGEN, ATARI, LAD = load()
    ax_pg, ax_at, ax_ld = (fig.add_subplot(gD[0, i]) for i in range(3))
    throughput_panel(ax_pg, PROCGEN, "ProcGen", C_PROCGEN, 40, fs=FS_D)
    throughput_panel(ax_at, ATARI, "ALE", C_ALE, 30, fs=FS_D, show_ylabel=False)
    ladder_panel(ax_ld, LAD, fs=FS_D,
                 labels=["Play-\nwright", "Node.js\n/ V8", "QuickJS\n(PlayTrain)"])
    for ax, s in ((ax_pg, "(a)"), (ax_at, "(b)"), (ax_ld, "(c)")):
        fig.text(ax.get_position().x0, d_top + 0.005, s,
                 ha="left", va="bottom", fontsize=FS_LAB - 1.5, color=INK)

# ---- panel letters ----
# Default order is the paper's: thumbs A, variants B, curves C, throughput D.
# With --throughput-top the throughput row leads as A and the rest run straight
# down the left column (B, C) before crossing to the right block (D), rather
# than zig-zagging left-right-left.
# The left-column rail's ceiling is the throughput row's "(a)" tag at the panel-a
# axes edge (0.055): the bold letter is ~0.021 wide, so past ~0.030 they touch.
X_PANEL = 0.024
L_TPUT, L_THUMBS, L_CURVES, L_VARIANTS = (
    ("", "A", "C", "B") if NOTP else
    ("A", "B", "C", "D") if TOP else ("D", "A", "C", "B"))
fig.text(X_PANEL, up(0.955), L_THUMBS, fontsize=FS_PANEL, fontweight="bold")
fig.text(X_PANEL, up(0.385), L_CURVES, fontsize=FS_PANEL, fontweight="bold")
fig.text(0.502, up(0.955), L_VARIANTS, fontsize=FS_PANEL, fontweight="bold")
if not NOTP:
    fig.text(X_PANEL, d_top + 0.015, L_TPUT, fontsize=FS_PANEL,
             fontweight="bold", va="bottom")

out = [a for a in sys.argv[1:] if not a.startswith("--")][0]
fig.savefig(out, dpi=150)
print("wrote", out)
