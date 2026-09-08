"""Generation-showcase panels: one PNG per game, 3 trained-policy frames with
the curves directly underneath (same stacking as fig_main's panel B).

For each game picks the best-scoring finished checkpoint (IMPALA or PPO) to
play the frames, and plots 3-seed IMPALA vs PPO bands below the strip.
Writes outputs/figs/fig_gen_<game>.png

    python tools/render_showcase_panels.py                  # roll out fresh frames
    python tools/render_showcase_panels.py --reuse-strips   # relayout only

--reuse-strips reads the already-rendered outputs/showcase_strips/<game>.png
instead of replaying the policy, so a pure layout change needs no checkpoints
and no PlayTrain runtime.
"""
import glob, json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from PIL import Image
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

REUSE_STRIPS = "--reuse-strips" in sys.argv
if not REUSE_STRIPS:   # torch + the runtime are only needed to replay policies
    import torch
    from playtrain.runtime.env import PlayTrainEnv

GAMES = ["downwell_fresh", "jump_king", "vvvvvv"]
FRAMES = [60, 600, 1500]
# vvvvvv: the greedy policy parks mid-episode, so fixed capture times give
# duplicate frames. Sample its actions (fixed torch seed) and pick frames
# adaptively by visual distinctness instead.
ADAPTIVE = {"vvvvvv"}
SEED = 7
IMP_C, PPO_C = "#1f77b4", "#ff7f0e"
os.makedirs("outputs/figs", exist_ok=True)
os.makedirs("outputs/showcase_strips", exist_ok=True)


# ---------------- data helpers ----------------
def load_tb(tb_dir, min_step=1e6):
    try:
        acc = EventAccumulator(tb_dir, size_guidance={"scalars": 0})
        acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        if not tags:
            return None
        evs = [e for e in acc.Scalars(tags[0]) if e.step >= min_step]
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
    far = max(s[-1] for s, _ in runs)
    runs = [r for r in runs if r[0][-1] >= 0.6 * far]
    hi = min(s[-1] for s, _ in runs)
    lo = max(s[0] for s, _ in runs)
    grid = np.linspace(lo, hi, n)
    ys = np.stack([np.interp(grid, s, ema(v)) for s, v in runs])
    return grid / 1e6, ys.mean(0), ys.min(0), ys.max(0), len(runs)


def impala_runs(game):
    by_seed = {}
    for cj in glob.glob("outputs/impala_*/config.json"):
        try:
            c = json.load(open(cj))
        except Exception:
            continue
        if c.get("game") == game and c.get("total_steps") == 100000000:
            d = cj.rsplit("/", 1)[0]
            s = c.get("seed", 0)
            if s not in by_seed or d > by_seed[s]:
                by_seed[s] = d
    return sorted(by_seed.values())


# ---------------- agents ----------------
def make_impala_agent(run_dir, cfg, sample=False):
    from playtrain_trainers.impala.net import ImpalaNet
    from playtrain_trainers.impala.environment import _format_frame
    model = ImpalaNet(cfg["obs_shape"], cfg["num_actions"],
                      features_dim=cfg["features_dim"], use_lstm=cfg["use_lstm"],
                      use_popart=cfg.get("use_popart", False), net=cfg["net"])
    ckpt = torch.load(f"{run_dir}/final.pt", map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    state = [model.initial_state(batch_size=1)]
    last = [0]

    @torch.no_grad()
    def act(obs):
        inputs = {"frame": _format_frame(obs, True),
                  "reward": torch.zeros(1, 1),
                  "done": torch.zeros(1, 1, dtype=torch.bool),
                  "last_action": torch.tensor([[last[0]]], dtype=torch.int64)}
        out, state[0] = model(inputs, state[0])
        logits = out["policy_logits"].view(-1)
        if sample:
            a = int(torch.distributions.Categorical(logits=logits).sample())
        else:
            a = int(logits.argmax())
        last[0] = a
        return a
    return act


def make_ppo_agent(run_dir, sample=False):
    from playtrain_trainers.policy import ActorCritic
    ckpt = torch.load(f"{run_dir}/final.pt", map_location="cpu", weights_only=False)
    cfg = ckpt.get("config", {})
    model = ActorCritic(n_actions=8, in_channels=3, input_hw=cfg.get("obs_size", 64),
                        net=cfg.get("net", "nature"))
    model.load_state_dict(ckpt["model"])
    model.eval()

    @torch.no_grad()
    def act(obs):
        x = torch.from_numpy(np.asarray(obs)).permute(2, 0, 1).unsqueeze(0)
        dist, _ = model.forward(x)
        if sample:
            return int(torch.distributions.Categorical(logits=dist.logits.view(-1)).sample())
        return int(dist.logits.view(-1).argmax())
    return act


def final_return(tb_dir):
    r = load_tb(tb_dir, min_step=0)
    return float(np.mean(r[1][-10:])) if r else -1e9


def best_agent(game):
    """Best finished checkpoint across trainers, by final TB return."""
    cands = []
    for d in impala_runs(game):
        if os.path.exists(f"{d}/final.pt"):
            cfg = json.load(open(f"{d}/config.json"))
            cands.append((final_return(f"{d}/tb"), "impala", d, cfg))
    for s in range(3):
        d = f"outputs/pv_p_{game}_s{s}"
        if os.path.exists(f"{d}/final.pt"):
            cands.append((final_return(f"{d}/tb"), "ppo", d, None))
    if not cands:
        return None, "none"
    cands.sort(key=lambda x: -x[0])
    ret, kind, d, cfg = cands[0]
    sample = game in ADAPTIVE
    agent = (make_impala_agent(d, cfg, sample) if kind == "impala"
             else make_ppo_agent(d, sample))
    return agent, f"{kind}:{d} (return {ret:.0f}, sample={sample})"


# ---------------- render + plot ----------------
# Panel geometry, in inches. The strip and the curve share one column so the
# curve sits directly under the frames (fig_main panel B does the same); the
# figure height falls out of the strip's own aspect so the frames fill their
# axes exactly rather than floating inside a mismatched box.
P_W = 5.4                       # panel width
P_L, P_R, P_TOP, P_BOT = 0.58, 0.16, 0.03, 0.45   # margins (P_L holds the
#                        y-label, P_R keeps the last x-tick off the edge)
P_GAP, P_CURVE = 0.06, 1.10     # strip-to-curve gap, curve height


def make_panel(game, strip):
    axw = P_W - P_L - P_R
    strip_h = axw / (strip.shape[1] / strip.shape[0])
    H = P_TOP + strip_h + P_GAP + P_CURVE + P_BOT
    fig = plt.figure(figsize=(P_W, H))

    axf = fig.add_axes([P_L / P_W, (P_BOT + P_CURVE + P_GAP) / H,
                        axw / P_W, strip_h / H])
    axf.imshow(strip, aspect="auto")
    axf.axis("off")

    axc = fig.add_axes([P_L / P_W, P_BOT / H, axw / P_W, P_CURVE / H])
    imp = band([load_tb(f"{d}/tb") for d in impala_runs(game)])
    ppo = band([load_tb(f"outputs/pv_p_{game}_s{s}/tb") for s in range(3)])
    for data, color in ((imp, IMP_C), (ppo, PPO_C)):
        if data is None:
            continue
        x, m, lo, hi, k = data
        axc.plot(x, m, lw=1.6, color=color)
        if k > 1:
            axc.fill_between(x, lo, hi, color=color, alpha=0.16, lw=0)
    axc.set_xlim(0, 100)
    axc.tick_params(labelsize=10)
    axc.grid(alpha=0.22, lw=0.5)
    axc.spines[["top", "right"]].set_visible(False)
    if game == "downwell_fresh":
        axc.set_xlabel("env steps (M)", fontsize=11)
    axc.set_ylabel("episode return", fontsize=11)
    axc.legend(handles=[Line2D([], [], color=IMP_C, lw=1.6, label="IMPALA"),
                        Line2D([], [], color=PPO_C, lw=1.6, label="PPO")],
               fontsize=9, frameon=False, loc="upper left",
               handlelength=1.2, borderaxespad=0.1)

    out = f"outputs/figs/fig_gen_{game}.png"
    fig.savefig(out, dpi=150)
    plt.close(fig)
    print("wrote", out)


for game in GAMES:
    strip_path = f"outputs/showcase_strips/{game}.png"
    if REUSE_STRIPS:
        if not os.path.exists(strip_path):
            print(f"{game}: no cached strip at {strip_path}, skipping")
            continue
        strip = np.asarray(Image.open(strip_path).convert("RGB"))
        print(f"{game}: reusing {strip_path}")
        make_panel(game, strip)
        continue

    agent, src = best_agent(game)
    print(f"{game}: frames from {src}")
    if agent is None:
        continue

    torch.manual_seed(0)
    e64 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=64)
    e256 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=256)
    o64, _ = e64.reset(seed=SEED)
    o256, _ = e256.reset(seed=SEED)
    frames = {}
    cand = []  # (t, frame) pool for adaptive selection
    for t in range(max(FRAMES) + 400):
        if t in FRAMES:
            frames[t] = np.asarray(o256, dtype=np.uint8).copy()
        if game in ADAPTIVE and t >= 60 and t % 25 == 0:
            cand.append((t, np.asarray(o256, dtype=np.uint8).copy()))
        a = agent(o64)
        o64, r, term, trunc, _ = e64.step(a)
        o256, _, _, _, _ = e256.step(a)
        if term or trunc:
            o64, _ = e64.reset(seed=SEED + 1)
            o256, _ = e256.reset(seed=SEED + 1)
    e64.close(); e256.close()

    if game in ADAPTIVE and cand:
        # greedily pick 3 frames: spaced >=200 steps apart and visually
        # distinct (mean abs pixel diff) from every already-chosen frame
        chosen = [cand[0]]
        for t, f in cand[1:]:
            if len(chosen) == 3:
                break
            if t - chosen[-1][0] < 200:
                continue
            if all(np.mean(np.abs(f.astype(float) - c.astype(float))) > 6.0
                   for _, c in chosen):
                chosen.append((t, f))
        while len(chosen) < 3:  # fallback: max-diff frames
            best = max(cand, key=lambda tf: min(
                np.mean(np.abs(tf[1].astype(float) - c.astype(float)))
                for _, c in chosen))
            chosen.append(best)
        chosen.sort(key=lambda tf: tf[0])
        print(f"  adaptive frames at t={[t for t, _ in chosen]}")
        tiles = [f for _, f in chosen]
    else:
        tiles = [frames[t] for t in FRAMES]
    tiles = [np.pad(x, ((0, 0), (0, 5), (0, 0)), constant_values=255)
             for x in tiles[:-1]] + [tiles[-1]]
    strip = np.concatenate(tiles, axis=1)
    Image.fromarray(strip).save(strip_path)
    make_panel(game, strip)
