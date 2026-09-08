"""cavequest_easy generalization: normal vs item-recolor, balanced vs random.

4 lines (held-out win-rate vs N distinct training bindings):
  balanced — normal        (solid blue,  no band)
  balanced — item-recolor  (solid green, no band)
  random   — normal        (dashed orange, bootstrap 95% CI band)
  random   — item-recolor  (dashed red,    bootstrap 95% CI band)

normal reads heldout_eval.json; item-recolor reads heldout_eval_recolor.json
(env = analogen_cavequest_easy_recolor: items channel-permuted, world unchanged).
Balanced has 1 run/N (no CI); random has multiple draws/N (CI).
"""
import glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

N_BOOT = 1000
RNG = np.random.default_rng(0)
try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")


def boot_ci(vals):
    a = np.asarray(vals, float)
    if len(a) < 2 or np.ptp(a) == 0:
        return float(a.mean()), float(a.mean())
    idx = RNG.integers(0, len(a), size=(N_BOOT, len(a)))
    m = a[idx].mean(axis=1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def bal_curve(fname):
    out = {}
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_N[0-9]*/{fname}"):
        N = int(re.search(r"_finesweep_N(\d+)/", f).group(1))
        out[N] = json.load(open(f))["heldout_win_rate"]
    Ns = np.array(sorted(out)); return Ns, np.array([out[n] for n in Ns])


def rand_curve(fname):
    d = defaultdict(list)
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_rand_N*_s*/{fname}"):
        N = int(re.search(r"_rand_N(\d+)_s", f).group(1))
        d[N].append(json.load(open(f))["heldout_win_rate"])
    Ns = np.array(sorted(d))
    mean = np.array([np.mean(d[n]) for n in Ns])
    lo, hi = zip(*[boot_ci(d[n]) for n in Ns])
    return Ns, mean, np.array(lo), np.array(hi)


bN, bv = bal_curve("heldout_eval.json")
bNr, bvr = bal_curve("heldout_eval_recolor.json")
bNm, bvm = bal_curve("heldout_eval_mono.json")
rN, rm, rlo, rhi = rand_curve("heldout_eval.json")
rNr, rmr, rlor, rhir = rand_curve("heldout_eval_recolor.json")
rNm, rmm, rlom, rhim = rand_curve("heldout_eval_mono.json")

LBL, TICK, LEG, TITLE = 20, 16, 12, 16
fig, ax = plt.subplots(figsize=(9.0, 6))
# random bands (CI only on random)
ax.fill_between(rN, rlo, rhi, color="#DD8452", alpha=0.15)
ax.fill_between(rNr, rlor, rhir, color="#C44E52", alpha=0.13)
if len(rNm):
    ax.fill_between(rNm, rlom, rhim, color="#8172B3", alpha=0.13)
# random lines
ax.plot(rN, rm, "--s", lw=2.2, ms=6, color="#DD8452", label="random — normal")
ax.plot(rNr, rmr, "--^", lw=2.2, ms=6, color="#C44E52", label="random — item-recolor")
if len(rNm):
    ax.plot(rNm, rmm, "--D", lw=2.2, ms=6, color="#8172B3", label="random — monochrome")
# balanced lines (no CI)
ax.plot(bN, bv, "-o", lw=3, ms=7, color="#4C72B0", label="balanced — normal")
ax.plot(bNr, bvr, "-o", lw=3, ms=7, color="#55A868", label="balanced — item-recolor")
if len(bNm):
    ax.plot(bNm, bvm, "-o", lw=3, ms=7, color="#937860", label="balanced — monochrome")

ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("cavequest_easy held-out: normal vs item-recolor vs monochrome\n(items restyled; world unchanged)",
             fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95, borderpad=0.6)
fig.tight_layout()
out = "outputs/figs/cavequest_recolor_generalization.png"
fig.savefig(out, dpi=160)
print("saved", out)
print("balanced   normal:", dict(zip(bN.tolist(), np.round(bv, 3).tolist())))
print("balanced  recolor:", dict(zip(bNr.tolist(), np.round(bvr, 3).tolist())))
print("balanced     mono:", dict(zip(bNm.tolist(), np.round(bvm, 3).tolist())))
print("random     normal:", dict(zip(rN.tolist(), np.round(rm, 3).tolist())))
print("random    recolor:", dict(zip(rNr.tolist(), np.round(rmr, 3).tolist())))
print("random       mono:", dict(zip(rNm.tolist(), np.round(rmm, 3).tolist())))
