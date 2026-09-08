"""Figure Z (final form): 4 variant pairs, frame strips + banded curves.

Per pair panel: 4 series — IMPALA base (blue solid), IMPALA variant (blue
dashed), PPO base (orange solid), PPO variant (orange dashed); mean +
min-max band over 3 seeds. IMPALA runs = pv_i matrix (found via
outputs/impala_*/config.json: game + total_steps=100M + seed, latest per
seed); PPO runs = outputs/pv_p_<tag>_s<seed> (NatureCNN — caption note).
"""
import glob, json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
from matplotlib.lines import Line2D
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

IMP_C, PPO_C = "#1f77b4", "#ff7f0e"
PAIRS = [("breakout", "breakout.multi", "multi-ball + pierce"),
         ("qbert", "qbert.v2", "new enemies + open map"),
         ("flappy_bird", "flappy_bird.dunk2", "new objective"),
         ("frostbite", "frostbite.jungle", "retheme + layout")]
FRAMES = [30, 240, 480]

def impala_runs(game):
    by_seed = {}
    for cj in glob.glob("outputs/impala_*/config.json"):
        try:
            c = json.load(open(cj))
            if c.get("game") == game and c.get("total_steps") == 100000000:
                sd = c.get("seed", 0)
                d = cj.rsplit("/", 1)[0]
                if sd not in by_seed or d > by_seed[sd]:
                    by_seed[sd] = d
        except Exception:
            pass
    return list(by_seed.values())

def ppo_runs(game):
    tag = game.replace(".", "_")
    return [d for d in (f"outputs/pv_p_{tag}_s{s}" for s in (0, 1, 2))
            if glob.glob(f"{d}/tb/events*")]

def curve(run_dir, min_step=1e6):
    try:
        acc = EventAccumulator(f"{run_dir}/tb", size_guidance={"scalars": 0})
        acc.Reload()
        evs = [e for e in acc.Scalars("charts/ep_return_mean") if e.step >= min_step]
        if len(evs) < 5:
            return None
        return (np.array([e.step for e in evs], float),
                np.array([e.value for e in evs], float))
    except Exception:
        return None

def ema(y, span_frac=0.02):
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y); m = 0.0; c = 0.0
    for i, v in enumerate(y):
        m = alpha * v + (1 - alpha) * m; c = alpha + (1 - alpha) * c
        out[i] = m / c
    return out

def band(runs, n=200):
    cs = [c for c in (curve(r) for r in runs) if c is not None]
    if not cs:
        return None
    hi = min(s[-1] for s, _ in cs); lo = max(s[0] for s, _ in cs)
    grid = np.linspace(lo, hi, n)
    ys = np.stack([np.interp(grid, s, ema(v)) for s, v in cs])
    return grid / 1e6, ys.mean(0), ys.min(0), ys.max(0), len(cs)

fig = plt.figure(figsize=(13.2, 11.0))
gs = fig.add_gridspec(len(PAIRS), 2, width_ratios=[1.55, 1.0], hspace=0.28, wspace=0.12)
for i, (base, var, kind) in enumerate(PAIRS):
    rows = []
    for g in (base, var):
        imgs = [mpimg.imread(f"outputs/variant_strips/{g.replace('.', '_')}_f{t:03d}.png")
                for t in FRAMES]
        pad = np.ones((imgs[0].shape[0], 6, imgs[0].shape[2]))
        strip = np.concatenate(sum(([im, pad] for im in imgs), [])[:-1], axis=1)
        rows.append(strip)
    vpad = np.ones((10, rows[0].shape[1], rows[0].shape[2]))
    block = np.concatenate([rows[0], vpad, rows[1]], axis=0)
    axs = fig.add_subplot(gs[i, 0])
    axs.imshow(block); axs.set_axis_off()
    axs.set_title(f"{base}  vs  {var}  ({kind})", fontsize=11.5, pad=4)
    axs.text(-0.012, 0.76, "base", transform=axs.transAxes, rotation=90,
             fontsize=9, va="center", ha="right", color="#444444")
    axs.text(-0.012, 0.24, "variant", transform=axs.transAxes, rotation=90,
             fontsize=9, va="center", ha="right", color="#444444")

    axc = fig.add_subplot(gs[i, 1])
    for trainer, color, finder in (("IMPALA", IMP_C, impala_runs), ("PPO", PPO_C, ppo_runs)):
        for g, ls in ((base, "-"), (var, "--")):
            data = band(finder(g))
            if data is None:
                continue
            x, m, lo, hi, k = data
            axc.plot(x, m, ls, lw=1.5, color=color)
            if k > 1:
                axc.fill_between(x, lo, hi, color=color, alpha=0.14, lw=0)
    axc.set_xlim(0, 100)
    axc.tick_params(labelsize=8.5)
    axc.grid(alpha=0.22, lw=0.5)
    axc.spines[["top", "right"]].set_visible(False)
    axc.set_ylabel("episode return", fontsize=9)
    if i == 0:
        proxies = [Line2D([], [], color=IMP_C, lw=1.5, label="IMPALA"),
                   Line2D([], [], color=PPO_C, lw=1.5, label="PPO"),
                   Line2D([], [], color="#555555", lw=1.5, ls="-", label="base"),
                   Line2D([], [], color="#555555", lw=1.5, ls="--", label="variant")]
        axc.legend(handles=proxies, fontsize=8, frameon=False, loc="upper left",
                   ncol=2, columnspacing=1.0, handletextpad=0.4)
    if i == len(PAIRS) - 1:
        axc.set_xlabel("env steps (M)", fontsize=9.5)
fig.savefig(sys.argv[1], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[1])
