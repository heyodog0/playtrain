"""Final generalization curve on analogen_cavequest_easy (seaborn, large fonts):
IMPALA-LSTM (N=1-10) vs IMPALA-FF (coarse log)."""
import glob, re, json
import numpy as np
import matplotlib.pyplot as plt

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

def curve(tag):
    out = {}
    for f in glob.glob(f"outputs/impala_{tag}_*/heldout_eval.json"):
        N = int(re.search(r"_N(\d+)", f).group(1))
        out[N] = json.load(open(f))["heldout_win_rate"]
    Ns = sorted(out)
    return np.array(Ns), np.array([out[n] for n in Ns])

lN, lv = curve("cavequest_finesweep")
fN, fv = curve("cavequest_ff_nsweep")

LBL, TICK, LEG, TITLE = 20, 16, 16, 18
fig, ax = plt.subplots(figsize=(8.5, 6))
ax.plot(lN, lv, "-o", lw=3, ms=8, color="#4C72B0", label="IMPALA-LSTM")
ax.plot(fN, fv, "--s", lw=2.6, ms=8, color="#DD8452", label="IMPALA-FF")
ax.set_xscale("log")
ticks = [1, 2, 3, 4, 6, 8, 16, 32, 64, 128, 300]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("Binding generalization is memory-gated\n(analogen_cavequest_easy)", fontsize=TITLE)
ax.legend(loc="center right", fontsize=LEG, framealpha=0.9)
fig.tight_layout()
out = "outputs/figs/cavequest_generalization_curve.png"
fig.savefig(out, dpi=160)
print("saved", out)
