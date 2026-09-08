"""cavequest_easy held-out: normal vs sprite-swap (new shapes, same colors).

4 lines: balanced (no CI) + random (bootstrap 95% CI), for normal and swap.
swap env = analogen_cavequest_easy_swap (6 items redrawn as gem/potion/ring/
coin/torch/shield; colors + world unchanged) -> isolates SHAPE-novelty.
"""
import glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

RNG = np.random.default_rng(0)
try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")


def boot_ci(vals):
    a = np.asarray(vals, float)
    if len(a) < 2 or np.ptp(a) == 0:
        return float(a.mean()), float(a.mean())
    idx = RNG.integers(0, len(a), size=(1000, len(a)))
    m = a[idx].mean(axis=1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def bal(fn):
    o = {}
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_N[0-9]*/{fn}"):
        o[int(re.search(r"_finesweep_N(\d+)/", f).group(1))] = json.load(open(f))["heldout_win_rate"]
    N = np.array(sorted(o)); return N, np.array([o[n] for n in N])


def rnd(fn):
    d = defaultdict(list)
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_rand_N*_s*/{fn}"):
        d[int(re.search(r"_rand_N(\d+)_s", f).group(1))].append(json.load(open(f))["heldout_win_rate"])
    N = np.array(sorted(d))
    mean = np.array([np.mean(d[n]) for n in N])
    lo, hi = zip(*[boot_ci(d[n]) for n in N])
    return N, mean, np.array(lo), np.array(hi)


bN, bv = bal("heldout_eval.json"); bNs, bvs = bal("heldout_eval_swap.json")
rN, rm, rlo, rhi = rnd("heldout_eval.json"); rNs, rms, rlos, rhis = rnd("heldout_eval_swap.json")

LBL, TICK, LEG, TITLE = 20, 16, 13, 17
fig, ax = plt.subplots(figsize=(8.8, 6))
ax.fill_between(rN, rlo, rhi, color="#DD8452", alpha=0.16)
ax.fill_between(rNs, rlos, rhis, color="#8172B3", alpha=0.16)
ax.plot(rN, rm, "--s", lw=2.4, ms=7, color="#DD8452", label="random — normal (95% CI)")
ax.plot(rNs, rms, "--D", lw=2.4, ms=7, color="#8172B3", label="random — sprite-swap (95% CI)")
ax.plot(bN, bv, "-o", lw=3, ms=8, color="#4C72B0", label="balanced — normal")
ax.plot(bNs, bvs, "-o", lw=3, ms=8, color="#55A868", label="balanced — sprite-swap")

ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("cavequest_easy held-out: normal vs sprite-swap\n(items = new shapes, same colors; world unchanged)",
             fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95, borderpad=0.6)
fig.tight_layout()
out = "outputs/figs/cavequest_swap_generalization.png"
fig.savefig(out, dpi=160)
print("saved", out)
print("balanced normal:", dict(zip(bN.tolist(), np.round(bv, 3).tolist())))
print("balanced   swap:", dict(zip(bNs.tolist(), np.round(bvs, 3).tolist())))
print("random   normal:", dict(zip(rN.tolist(), np.round(rm, 3).tolist())))
print("random     swap:", dict(zip(rNs.tolist(), np.round(rms, 3).tolist())))
