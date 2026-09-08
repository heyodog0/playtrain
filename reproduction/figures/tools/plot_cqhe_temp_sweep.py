"""cavequest_hard_explore nohd: win rate vs decoding temperature.
Settles greedy-vs-sampled collapse. Two panels: (L) per-N mean win rate vs T,
(R) aggregate over all runs. If win rate holds down to T~0.1 -> policy is
argmax-stable (sharpening recovers greedy). If it slopes down to a plateau only
at high T -> policy is genuinely sampling-dependent."""
import glob, re, json
from collections import defaultdict
import numpy as np, matplotlib as mpl, matplotlib.pyplot as plt
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")

def tag(t): return ("%g" % t).replace(".", "p")
TEMPS = [0.0, 0.1, 0.25, 0.5, 1.0]

# data[N][T] = list of win rates (one per seed)
data = defaultdict(lambda: defaultdict(list))
for T in TEMPS:
    for f in glob.glob(f"outputs/impala_cqhe_nohd_N*_s*/temp_sweep_T{tag(T)}.json"):
        N = int(re.search(r"_N(\d+)_s", f).group(1))
        data[N][T].append(json.load(open(f))["heldout_win_rate"] * 100.0)

Ns = sorted(data)
norm = mpl.colors.LogNorm(vmin=max(1, min(Ns)), vmax=max(Ns))
cmap = mpl.cm.viridis
x = list(range(len(TEMPS)))

fig, (axL, axR) = plt.subplots(1, 2, figsize=(14, 5.6))

# ---- L: per-N ----
for N in Ns:
    m = [np.mean(data[N][T]) for T in TEMPS]
    axL.plot(x, m, "-o", lw=2, ms=6, color=cmap(norm(N)), label=f"N={N}")
axL.set_title("Win rate vs temperature, per N", fontsize=14)
sm = mpl.cm.ScalarMappable(norm=norm, cmap=cmap)
cb = fig.colorbar(sm, ax=axL, pad=0.01); cb.set_label("N train bindings", fontsize=10)

# ---- R: aggregate over all 40 runs ----
agg_m, agg_sd = [], []
for T in TEMPS:
    allwr = [w for N in Ns for w in data[N][T]]
    agg_m.append(np.mean(allwr)); agg_sd.append(np.std(allwr))
axR.errorbar(x, agg_m, yerr=agg_sd, fmt="-o", lw=2.6, ms=8, color="#C44E52", capsize=5)
axR.set_title("Aggregate win rate vs temperature (all 40 runs)", fontsize=14)
for xi, m in zip(x, agg_m):
    axR.annotate(f"{m:.0f}%", (xi, m), textcoords="offset points", xytext=(0, 10),
                 ha="center", fontsize=11, color="#C44E52")

for ax in (axL, axR):
    ax.set_xticks(x); ax.set_xticklabels([f"{t:g}\n{'greedy' if t==0 else ('sampled' if t==1 else '')}" for t in TEMPS], fontsize=12)
    ax.set_xlabel("decoding temperature", fontsize=13)
    ax.set_ylabel("win rate (% of 360 bindings)", fontsize=13)
    ax.set_ylim(-2, None)
axL.legend(loc="upper left", fontsize=8, ncol=2, framealpha=.9)
fig.suptitle("cavequest_hard_explore (nohd): decoding-temperature sweep on the 40M checkpoints", fontsize=15)
fig.tight_layout(rect=[0, 0, 1, 0.96])
out = "outputs/figs/cqhe_temp_sweep.png"
fig.savefig(out, dpi=160); print("saved", out)

# ---- table ----
print(f"\n{'N':>5} " + " ".join(f"T={t:<5g}" for t in TEMPS))
for N in Ns:
    print(f"{N:>5} " + " ".join(f"{np.mean(data[N][T]):5.1f}%" for T in TEMPS))
print(f"{'ALL':>5} " + " ".join(f"{m:5.1f}%" for m in agg_m))
