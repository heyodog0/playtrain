"""Balanced binding-generalization curve on analogen_cavequest_medium.

Held-out = C3 functional_holdout (key->12, boots->17, sword->18): the test
re-binds the win-critical KEY and BOOTS (+ one sword) onto never-trained icons.
6 held-out bindings x 10 placements = 60 eval episodes per run.

y = held-out win-rate vs N distinct (balanced) training bindings. Single draw
per N (split_seed 0); the band is a bootstrap 95% CI over the 6 held-out
BINDINGS (the unit of generalization), 1000 resamples.
"""
import glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
from analogen.generalization import _bindings

GAME = "analogen_cavequest_medium"
N_BOOT = 1000
RNG = np.random.default_rng(0)
B = _bindings(GAME)

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")


def bkey(seed):
    return tuple(sorted(B.role_binding(seed)["tool"].items()))


def boot_ci(binding_rates):
    a = np.asarray(binding_rates, dtype=float)
    if len(a) < 2 or np.ptp(a) == 0:
        return float(a.mean()), float(a.mean())
    idx = RNG.integers(0, len(a), size=(N_BOOT, len(a)))
    means = a[idx].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


rows = {}
for f in glob.glob("outputs/impala_cqm_balsweep_c3_N*_50M/heldout_eval.json"):
    N = int(re.search(r"_N(\d+)_", f).group(1))
    j = json.load(open(f))
    by = defaultdict(list)
    for e in j["per_seed"]:
        by[bkey(e["seed"])].append(1.0 if e["won"] else 0.0)
    brates = [np.mean(v) for v in by.values()]
    rows[N] = (j["heldout_win_rate"], brates)

Ns = np.array(sorted(rows))
wr = np.array([rows[n][0] for n in Ns])
lo, hi = zip(*[boot_ci(rows[n][1]) for n in Ns])
lo, hi = np.array(lo), np.array(hi)

LBL, TICK, LEG, TITLE = 20, 16, 15, 17
fig, ax = plt.subplots(figsize=(8.5, 6))
ax.fill_between(Ns, lo, hi, color="#4C72B0", alpha=0.22,
                label="bootstrap 95% CI (6 bindings)")
ax.plot(Ns, wr, "-o", lw=3, ms=8, color="#4C72B0", label="held-out win-rate")
ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("Binding generalization — cavequest_medium\n"
             "(balanced; held-out re-binds KEY+BOOTS+sword)", fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95, borderpad=0.8)
fig.tight_layout()
out = "outputs/figs/cqm_balsweep_c3_generalization.png"
fig.savefig(out, dpi=160)
print("saved", out)
for n in Ns:
    print(f"  N={n:>2}  win-rate={rows[n][0]:.3f}")
