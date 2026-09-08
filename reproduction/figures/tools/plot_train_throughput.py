"""Two-layer throughput figure: env layer (vs real ProcGen/EnvPool) and
end-to-end training layer (per-game best config, baselines annotated).

Data = measured results, July 22-23 2026 (jobs in memory/notes). Units:
agent-steps/s (frame_skip=1 everywhere here; no frameskip inflation).
"""
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BLUE, ORANGE = "#1f77b4", "#ff7f0e"
GRAY = "#6a6a6a"

# --- Layer 1: env-only, 92 threads, same Sapphire node type, both real pixels
ENV_GAMES = ["bigfish", "starpilot", "maze", "coinrun", "chaser", "miner"]
ENV_OURS = [4054448, 701757, 1162265, 592589, 378197, 287989]
ENV_PROCGEN = [484363, 218380, 543539, 380360, 540713, 537726]

# --- Layer 2: training, per-game best measured config (b256 or b128/+fleet)
TRAIN_PG = {
    "plunder": (1123890, ""), "bigfish": (1123926, ""),
    "bossfight": (1104264, ""), "ninja": (1117370, ""),
    "starpilot": (1114093, ""), "heist": (1064558, ""),
    "leaper": (976269, "b128"), "maze": (958971, "b128"),
    "dodgeball": (956807, ""), "jumper": (954669, "b128"),
    "chaser": (912413, "b128"), "caveflyer": (891116, "b128"),
    "coinrun": (785910, "fleet"), "fruitbot": (761813, "b128"),
    "climber": (753633, "fleet"), "miner": (737270, "fleet"),
}
TRAIN_AT = {
    "freeway": (1133639, ""), "asteroids": (1127186, ""),
    "pong": (1123919, ""), "breakout": (1123916, ""),
    "space_invaders": (1117370, ""), "seaquest": (1114094, ""),
    "frostbite": (1110636, ""), "qbert": (773312, "fleet"),
}
BASELINES = [  # same-silicon measured training baselines
    ("MinAtar symbolic train (rejax PPO, H100)", 99646),
    ("Craftax-Classic-Pixels (their PPO, H100)", 33095),
]


def gm(vals):
    return math.exp(sum(math.log(v) for v in vals) / len(vals))


def bar_panel(ax, table, title):
    names = list(table)
    vals = [table[g][0] for g in names]
    tags = [table[g][1] for g in names]
    x = range(len(names))
    for i, (v, t) in enumerate(zip(vals, tags)):
        ax.bar(i, v / 1e6, width=0.72, color=BLUE,
               hatch="//" if t == "fleet" else None,
               edgecolor="white", linewidth=0.4)
    g = gm(vals)
    ax.axhline(g / 1e6, color=GRAY, lw=1.2, ls="--")
    ax.text(len(names) - 0.4, g / 1e6 + 0.02, f"geomean {g/1e6:.2f}M",
            ha="right", fontsize=8, color=GRAY)
    ax.set_xticks(list(x))
    ax.set_xticklabels(names, rotation=45, ha="right", fontsize=8)
    ax.set_ylim(0, 1.32)
    ax.set_title(title, fontsize=10, loc="left")
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", alpha=0.25)
    return g


fig = plt.figure(figsize=(11.5, 8.6))
gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.15], hspace=0.52, wspace=0.18)

# Panel A: env layer
axA = fig.add_subplot(gs[0, :])
x = range(len(ENV_GAMES))
w = 0.38
axA.bar([i - w / 2 for i in x], [v / 1e6 for v in ENV_OURS], w,
        color=BLUE, label="PlayTrain replica (QuickJS+rasterizer)",
        edgecolor="white", linewidth=0.4)
axA.bar([i + w / 2 for i in x], [v / 1e6 for v in ENV_PROCGEN], w,
        color=ORANGE, label="Real ProcGen (EnvPool C++)",
        edgecolor="white", linewidth=0.4)
for i, (a, b) in enumerate(zip(ENV_OURS, ENV_PROCGEN)):
    axA.text(i - w / 2, a / 1e6 + 0.05, f"{a/1e6:.2f}", ha="center", fontsize=7)
    axA.text(i + w / 2, b / 1e6 + 0.05, f"{b/1e6:.2f}", ha="center", fontsize=7,
             color="#7a4a12")
axA.set_xticks(list(x))
axA.set_xticklabels(ENV_GAMES, fontsize=9)
axA.set_ylabel("env steps / s (millions)")
axA.set_title("A — Environment layer: env-only stepping, 92 threads, one Sapphire"
              " Rapids node, 64×64×3 RGB both sides", fontsize=10, loc="left")
axA.legend(frameon=False, fontsize=9)
axA.spines[["top", "right"]].set_visible(False)
axA.grid(axis="y", alpha=0.25)

# Panel B/C: training layer
axB = fig.add_subplot(gs[1, 0])
gB = bar_panel(axB, TRAIN_PG, "B — Training: ProcGen-replica suite")
axB.set_ylabel("trained agent steps / s (millions)")
axC = fig.add_subplot(gs[1, 1])
gC = bar_panel(axC, TRAIN_AT, "C — Training: Atari-replica suite")

# Baseline annotations on panel B (same-silicon training baselines)
for k, (label, v) in enumerate(BASELINES):
    axB.axhline(v / 1e6, color=GRAY, lw=0.9, ls=":")
    axB.text(15.4, v / 1e6 + (0.05 if k == 0 else -0.078),
             f"{label}: {v/1000:.0f}k", fontsize=7.2, color="#333333",
             ha="right", bbox=dict(fc="white", ec="none", alpha=0.85, pad=1.2))

fig.text(0.01, 0.005,
         "Agent-steps/s, frame_skip=1 (no frameskip inflation). Hatched bars: env-bound"
         " games trained with +2 remote CPU fleet nodes (remote_vec, ~2% billing);"
         " solid bars: fully local single node (4×H100: 1 learner + 3 actor-inference"
         " GPUs, 92 cores). Per-game best measured config (batch 256 or 128)."
         " Record run 1.12M reproduced on 4 nodes.",
         fontsize=7.4, color="#444444")
fig.savefig("/Users/heyodogo/code/lab/node-gym-gen/analogen/outputs_fig_train_throughput.png",
            dpi=170, bbox_inches="tight")
print(f"geomeans: pg16 {gB:,.0f} atari8 {gC:,.0f}")
