"""Build a side-by-side "run card" for a finished training job.

Produces three artifacts per job:
  <out_dir>/<tag>_plot.png   — episode-return training curve
  <out_dir>/<tag>_rollout.gif — animated rollout of the trained policy
  <out_dir>/<tag>.gif         — side-by-side: plot (static) + rollout (animated)

Works on both PPO (`ckpt_*.pt` / `final.pt` with key 'model') and IMPALA
(`final.pt` with key 'model_state_dict'), feedforward OR LSTM — the LSTM
arch is inferred from the checkpoint and the recurrent state is threaded
through the rollout (for PPO-LSTM, a_{t-1}/r_{t-1} are fed too). Auto-detects
the checkpoint format and env-side observation shape. Title pulls game +
step budget from the run's config.json.

Usage:
    # one job
    uv run python tools/make_run_card.py outputs/ppo_16809055

    # multiple jobs into the same session folder
    uv run python tools/make_run_card.py outputs/ppo_16809055 outputs/impala_16809057 \\
        --out-dir outputs/figs/sessions/v5_door_6x6_3way --tag-prefix 01

    # tweak rollout sampling
    uv run python tools/make_run_card.py outputs/ppo_16809055 \\
        --n-trials 30 --deterministic --fps 12 --scale 4
"""
from __future__ import annotations

import argparse
import io
import json
import os
from dataclasses import dataclass
from pathlib import Path

import imageio.v2 as imageio
import matplotlib.pyplot as plt
import numpy as np
import torch
from PIL import Image

from playtrain.runtime import PlayTrainEnv


WIN_THRESHOLD = 30_000


# ---------------------------------------------------------------------------
# Checkpoint loading — dispatch on PPO vs IMPALA layout
# ---------------------------------------------------------------------------
@dataclass
class LoadedPolicy:
    model: torch.nn.Module
    method: str  # "PPO" or "IMPALA"
    use_lstm: bool = False  # threads recurrent state at rollout (PPO or IMPALA)
    feed_prev_action_reward: bool = False  # PPO LSTM: a_{t-1}/r_{t-1} into core
    symlog_reward: bool = True             # PPO LSTM reward-cue squash
    reward_clip: str = "none"              # how training shaped the reward (PPO)


def _load_ppo(ckpt_path: Path, env: PlayTrainEnv, device: torch.device,
              cfg: dict | None = None) -> LoadedPolicy:
    from playtrain_trainers.policy import ActorCritic
    cfg = cfg or {}
    H, W, C = env.observation_space.shape
    n_actions = int(env.action_space.n)
    payload = torch.load(ckpt_path, map_location=device, weights_only=False)
    sd = payload["model"]
    # Infer the architecture from the checkpoint (no config needed for shape):
    # an LSTM checkpoint has `lstm.*` params; features_dim is the actor head's
    # input width; and the LSTM input width tells us whether a_{t-1}/r_{t-1}
    # were concatenated (features_dim+n_actions+1 vs features_dim).
    use_lstm = any(k.startswith("lstm.") for k in sd)
    features_dim = int(sd["actor.weight"].shape[1])
    feed = False
    if use_lstm:
        feed = int(sd["lstm.weight_ih_l0"].shape[1]) != features_dim
    # symlog_reward is not a weight — read it from the run config (default True,
    # matching the trainer). reward_clip lets us reproduce the exact reward value
    # the core saw when symlog_reward was off.
    symlog_reward = bool(cfg.get("lstm_symlog_reward", True))
    reward_clip = str(cfg.get("reward_clip", "none"))
    model = ActorCritic(n_actions=n_actions, in_channels=C,
                        features_dim=features_dim, input_hw=H, use_lstm=use_lstm,
                        feed_prev_action_reward=feed,
                        symlog_reward=symlog_reward).to(device)
    model.load_state_dict(sd)
    model.eval()
    return LoadedPolicy(model=model, method="PPO", use_lstm=use_lstm,
                        feed_prev_action_reward=feed, symlog_reward=symlog_reward,
                        reward_clip=reward_clip)


def _load_impala(ckpt_path: Path, env: PlayTrainEnv, device: torch.device) -> LoadedPolicy:
    from playtrain_trainers.impala.net import ImpalaNet
    H, W, C = env.observation_space.shape
    n_actions = int(env.action_space.n)
    payload = torch.load(ckpt_path, map_location=device, weights_only=False)
    state_dict = payload["model_state_dict"]
    # Infer the architecture from the checkpoint itself rather than a config
    # file: an LSTM checkpoint has `core.*` params, and features_dim is the
    # policy head's input width (== LSTM hidden size). This keeps the run card
    # correct for both feedforward and LSTM runs without a config.json.
    use_lstm = any(k.startswith("core.") for k in state_dict)
    features_dim = int(state_dict["policy.weight"].shape[1])
    # ImpalaNet takes CHW obs; our actor pipeline transposes at write-time.
    model = ImpalaNet(observation_shape=(C, H, W), num_actions=n_actions,
                      features_dim=features_dim, use_lstm=use_lstm).to(device)
    model.load_state_dict(state_dict)
    model.eval()
    return LoadedPolicy(model=model, method="IMPALA", use_lstm=use_lstm)


def find_checkpoint(run_dir: Path) -> Path:
    """Prefer final.pt, fall back to the highest-numbered ckpt_*.pt."""
    final = run_dir / "final.pt"
    if final.exists():
        return final
    ckpts = sorted(run_dir.glob("ckpt_*.pt"))
    if not ckpts:
        raise FileNotFoundError(f"No final.pt or ckpt_*.pt in {run_dir}")
    return ckpts[-1]


def detect_method(ckpt_path: Path) -> str:
    payload = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if "model_state_dict" in payload:
        return "IMPALA"
    if "model" in payload:
        return "PPO"
    raise ValueError(f"Can't detect method from ckpt keys: {list(payload.keys())}")


def load_policy(ckpt_path: Path, env: PlayTrainEnv, device: torch.device,
                cfg: dict | None = None) -> LoadedPolicy:
    method = detect_method(ckpt_path)
    if method == "PPO":
        return _load_ppo(ckpt_path, env, device, cfg)
    return _load_impala(ckpt_path, env, device)


def _shape_reward(r: float, mode: str) -> float:
    """Reproduce the trainer's reward_clip shaping (for feeding r_{t-1} to a
    PPO-LSTM core that was trained with symlog_reward=False)."""
    if mode == "sign":
        return float(np.sign(r))
    if mode == "symlog":
        return float(np.sign(r) * np.log1p(abs(r)))
    return float(r)


# ---------------------------------------------------------------------------
# Rollout
# ---------------------------------------------------------------------------
def _step_policy(policy: LoadedPolicy, obs_hwc: np.ndarray,
                 last_action: int, last_reward: float,
                 device: torch.device, deterministic: bool,
                 core_state: tuple = (),
                 temperature: float | None = None) -> tuple[int, tuple]:
    """One forward through the loaded policy. Returns (action, new_core_state).

    For an LSTM IMPALA policy the recurrent state must be threaded across the
    rollout (the caller carries core_state); without it the policy runs from a
    zero state every step and its greedy rollout is meaningless. core_state is
    () for PPO and feedforward IMPALA, so threading it is a harmless no-op.

    ``temperature`` overrides ``deterministic`` when not None: T<=0 is argmax
    (greedy), T>0 samples from softmax(logits / T). T=1.0 reproduces the plain
    stochastic policy. This lets an eval sweep interpolate between the collapsing
    argmax policy and the working sampled one."""
    def _pick(logits, new_core):
        if temperature is not None:
            if temperature <= 0:
                return int(logits.argmax().item()), new_core
            probs = torch.softmax(logits / temperature, dim=-1)
            return int(torch.multinomial(probs, 1).item()), new_core
        if deterministic:
            return int(logits.argmax().item()), new_core
        probs = torch.softmax(logits, dim=-1)
        return int(torch.multinomial(probs, 1).item()), new_core

    obs = torch.as_tensor(obs_hwc, device=device).permute(2, 0, 1).contiguous()
    obs = obs.unsqueeze(0)  # (1, C, H, W)
    with torch.no_grad():
        if policy.method == "PPO":
            # get_states unifies FF and LSTM: it threads core_state (() for FF)
            # and, when feed_prev_action_reward, concats a_{t-1}/r_{t-1}. We read
            # logits off the actor head so argmax/sample is explicit (the net's
            # own action sampling is train/eval-mode dependent).
            done = torch.zeros(1, device=device)
            la = rw = None
            if policy.feed_prev_action_reward:
                la = torch.tensor([last_action], device=device, dtype=torch.int64)
                fed = (last_reward if policy.symlog_reward
                       else _shape_reward(last_reward, policy.reward_clip))
                rw = torch.tensor([fed], device=device, dtype=torch.float32)
            z, new_core = policy.model.get_states(obs, core_state, done, la, rw)
            logits = policy.model.actor(z).view(-1)  # (A,)
            return _pick(logits, new_core)
        # IMPALA: needs the time-major dict.
        inputs = {
            "frame": obs.unsqueeze(0),  # (T=1, B=1, C, H, W)
            "reward": torch.tensor([[last_reward]], device=device, dtype=torch.float32),
            "done": torch.zeros(1, 1, dtype=torch.bool, device=device),
            "last_action": torch.tensor([[last_action]], device=device, dtype=torch.int64),
        }
        # Eval mode is set in load; the forward branches on self.training,
        # so we explicitly use argmax for deterministic or multinomial for
        # stochastic, post-hoc:
        out, new_core_state = policy.model(inputs, core_state)
        logits = out["policy_logits"].view(-1)  # (A,)
        return _pick(logits, new_core_state)


def rollout_one(policy: LoadedPolicy, env: PlayTrainEnv, seed: int,
                device: torch.device, deterministic: bool,
                max_steps: int = 2000, obs_transform=None,
                temperature: float | None = None) -> dict:
    """obs_transform: optional fn applied to each frame BEFORE the policy sees it
    (env dynamics unchanged) — e.g. a fixed recolor, to test visual robustness.
    temperature: see _step_policy; overrides deterministic when not None."""
    obs, _ = env.reset(seed=seed)
    frames = [obs.copy()]
    total_return = 0.0
    last_action, last_reward = 0, 0.0
    # Fresh recurrent state per episode (() for PPO / feedforward IMPALA). The
    # rollout is a single episode, so no mid-rollout reset is needed — done is
    # always False until we break.
    core_state: tuple = ()
    if policy.use_lstm:
        core_state = tuple(s.to(device) for s in policy.model.initial_state(batch_size=1))
    for _ in range(max_steps):
        pobs = obs if obs_transform is None else obs_transform(obs)
        action, core_state = _step_policy(policy, pobs, last_action, last_reward,
                                          device, deterministic, core_state,
                                          temperature=temperature)
        obs, reward, term, trunc, _info = env.step(action)
        frames.append(obs.copy())
        total_return += float(reward)
        last_action, last_reward = action, float(reward)
        if term or trunc:
            break
    return {
        "frames": frames,
        "total_return": total_return,
        "length": len(frames),
        "won": total_return >= WIN_THRESHOLD,
    }


def best_rollout(policy: LoadedPolicy, env: PlayTrainEnv, n_trials: int,
                 device: torch.device, deterministic: bool,
                 seed_offset: int = 0, seeds: list[int] | None = None,
                 max_steps: int = 2000) -> dict:
    """Return the highest-return episode out of n_trials rollouts.

    If `seeds` is given, roll out on the first n_trials of those EXPLICIT env
    seeds. This is required for train_pool runs: the policy only ever saw a
    fixed pool of layouts (SeedSetWrapper), so rolling out on cfg.seed drops a
    memorizer onto an UNSEEN layout where it scores ~0. Otherwise fall back to
    seed_offset + range(n_trials).

    seed_offset shifts the rollout seeds so two different jobs (same env
    + similar trained policy) produce *different* rollout gifs. Without
    this, all 3 IMPALA-seed-{0,1,2} cards used seeds 0..n_trials and
    rendered identical gameplay — the policies were similar, env was the
    same, so the gifs matched. Offsetting by cfg.seed * 10000 lifts that.

    max_steps bounds the decision count per episode — pass the trained
    max_decisions so the rollout isn't truncated before the policy can solve.
    """
    candidates = (list(seeds)[:n_trials] if seeds is not None
                  else [seed_offset + s for s in range(n_trials)])
    best = None
    for s in candidates:
        ep = rollout_one(policy, env, seed=s, device=device,
                         deterministic=deterministic, max_steps=max_steps)
        if best is None or ep["total_return"] > best["total_return"]:
            best = ep
            best["seed"] = s
    return best


# ---------------------------------------------------------------------------
# Training curve from TB
# ---------------------------------------------------------------------------
def load_curve(run_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    from tensorboard.backend.event_processing import event_accumulator
    tb_dir = run_dir / "tb"
    if not tb_dir.is_dir():
        raise FileNotFoundError(f"No tb/ in {run_dir}")
    # Pick a SINGLE event file rather than loading the whole directory.
    # On preemptable partitions (kempner_requeue) a job can be killed and
    # restarted under SLURM --requeue — each restart re-trains from step
    # 0 and writes a new event file in the same dir. EventAccumulator on
    # the directory concatenates all of them, producing a non-monotonic
    # step axis: when plotted, matplotlib draws connecting line segments
    # back from the final step of run N to step 0 of run N+1, giving
    # the curve a zig-zag artifact (jobs 16837270, 16837271).
    #
    # Filename format is events.out.tfevents.<unix_ts>.<host>.<pid>.<seq>
    # — the unix timestamp in the filename is the file-open time. Picking
    # the largest timestamp picks the latest run; that's the one we want
    # for a finished checkpoint (it's the run that produced final.pt).
    event_files = sorted(tb_dir.glob("events.out.tfevents.*"))
    if not event_files:
        raise FileNotFoundError(f"No event files in {tb_dir}")
    latest = event_files[-1]
    if len(event_files) > 1:
        print(f"  [load_curve] {len(event_files)} event files in {tb_dir.name}; "
              f"using {latest.name} (likely SLURM --requeue restart)")
    ea = event_accumulator.EventAccumulator(
        str(latest), size_guidance={"scalars": 0}
    )
    ea.Reload()
    tags = ea.Tags()["scalars"]
    tag = "charts/ep_return_mean" if "charts/ep_return_mean" in tags else None
    if tag is None:
        raise KeyError(f"No charts/ep_return_mean in {latest}; have {tags}")
    evs = ea.Scalars(tag)
    steps = np.array([e.step for e in evs], dtype=np.int64)
    rets = np.array([e.value for e in evs], dtype=np.float32)
    return steps, rets


def _rolling_mean(x: np.ndarray, window: int) -> np.ndarray:
    """Centered rolling mean ignoring NaNs. Mirrors the smoothing literature
    plots in RIDE / NovelD / BeBold figures use (window~100 episodes worth)."""
    if window <= 1 or x.size <= window:
        return x.astype(float, copy=True)
    out = np.full_like(x, np.nan, dtype=float)
    half = window // 2
    for i in range(x.size):
        lo, hi = max(0, i - half), min(x.size, i + half + 1)
        seg = x[lo:hi]
        finite = seg[np.isfinite(seg)]
        if finite.size:
            out[i] = finite.mean()
    return out


def _auto_smooth_window(n_points: int) -> int:
    """Aim for ~3-5% of the total TB tick count, clamped to a sensible range.
    On a 30K-point IMPALA series this gives ~900-1500; on a 300-point PPO
    series ~9-15 (effectively no extra smoothing — PPO is already smoothed
    upstream by SB3's episode buffer)."""
    return int(np.clip(n_points * 0.04, 5, 2000))


def _draw(ax, steps, rets, smooth, title, peak, win_thresh):
    if smooth is not None:
        ax.plot(steps / 1e6, rets, color="#0a8c7e", lw=0.6, alpha=0.25,
                label="raw")
        ax.plot(steps / 1e6, smooth, color="#0a8c7e", lw=1.8, label="smoothed")
    else:
        ax.plot(steps / 1e6, rets, color="#0a8c7e", lw=1.6)
    if peak is not None:
        ax.axhline(peak, color="gray", lw=0.6, linestyle=":")
    ax.axhline(win_thresh, color="gray", lw=0.6, linestyle=":")
    ax.set_title(title, fontsize=12)
    ax.set_xlabel("env steps (M)")
    ax.set_ylabel("episode return")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def plot_curve(steps: np.ndarray, rets: np.ndarray, title: str,
               out_png: Path, peak: float | None = None,
               win_thresh: float = WIN_THRESHOLD) -> None:
    window = _auto_smooth_window(rets.size)
    smooth = _rolling_mean(rets, window) if window > 5 else None
    fig, ax = plt.subplots(figsize=(6.4, 4.6), dpi=130)
    _draw(ax, steps, rets, smooth, title, peak, win_thresh)
    fig.tight_layout()
    fig.savefig(out_png, dpi=130, bbox_inches="tight")
    plt.close(fig)


def fig_to_pil(steps, rets, title, peak, win_thresh) -> Image.Image:
    """Same plot, returned as a PIL Image (for compositing into the GIF)."""
    window = _auto_smooth_window(rets.size)
    smooth = _rolling_mean(rets, window) if window > 5 else None
    fig, ax = plt.subplots(figsize=(6.4, 4.6), dpi=130)
    _draw(ax, steps, rets, smooth, title, peak, win_thresh)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


# ---------------------------------------------------------------------------
# Side-by-side compositor
# ---------------------------------------------------------------------------
def _compose_frame(plot_img: Image.Image, frame: np.ndarray,
                   rollout_w: int, rollout_h: int) -> Image.Image:
    """Compose a single side-by-side frame: static plot on the left, the
    upscaled rollout obs on the right. Output height matches the plot."""
    rim = Image.fromarray(frame, mode="RGB").resize(
        (rollout_w, rollout_h), Image.NEAREST
    )
    canvas = Image.new("RGB", (plot_img.width + rollout_w + 16, plot_img.height),
                       color=(255, 255, 255))
    canvas.paste(plot_img, (0, 0))
    canvas.paste(rim, (plot_img.width + 16, 0))
    return canvas


def write_sidebyside_gif(out_gif: Path, plot_img: Image.Image,
                         rollout_frames: list[np.ndarray], fps: int = 15) -> None:
    """Stream the side-by-side GIF one frame at a time.

    Each composited frame is plot-resolution (~600x1450x3 ≈ 2.6 MB), so a long
    door rollout (up to max_steps frames) would otherwise hold multiple GB at
    once: the full list, the np.array() copy of it, AND imageio's internal
    buffer — three simultaneous copies that OOM-killed the run-card process
    (job 19435495) on the tail spike the SLURM sampler missed. Composing and
    appending one frame at a time bounds memory to a single frame regardless of
    episode length, so the card runs comfortably inside the training mem budget."""
    H0, W0 = rollout_frames[0].shape[:2]
    rollout_h = plot_img.height
    rollout_w = int(W0 * (rollout_h / H0))
    with imageio.get_writer(out_gif, mode="I", fps=fps) as writer:
        for f in rollout_frames:
            writer.append_data(
                np.asarray(_compose_frame(plot_img, f, rollout_w, rollout_h))
            )


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------
def title_for(run_dir: Path, peak_return: float | None,
              last20_mean: float | None) -> str:
    cfg = json.loads((run_dir / "config.json").read_text())
    game = cfg.get("game", "?")
    total = cfg.get("total_timesteps") or cfg.get("total_steps") or 0
    seed = cfg.get("seed", "?")
    use_rnd = cfg.get("use_rnd", False)
    method = "IMPALA" if "impala" in run_dir.name.lower() else (
        "PPO+RND" if use_rnd else "PPO"
    )
    if cfg.get("use_lstm", False):
        method += "+LSTM"
    base = f"{game} — {method} — {total/1e6:.0f}M (seed {seed})"
    stat = ""
    if last20_mean is not None and np.isfinite(last20_mean):
        stat = f"\nlast-20 mean={last20_mean:.0f}"
        if peak_return is not None:
            stat += f"  peak={peak_return:.0f}"
    return base + stat


def process_one(run_dir: Path, out_dir: Path, tag: str, args) -> None:
    print(f"=== {run_dir.name} -> {tag} ===")
    cfg = json.loads((run_dir / "config.json").read_text())
    game = args.game or cfg.get("game")  # --game lets a run render on a variant env (e.g. recolor)
    if game is None:
        raise ValueError(f"config.json missing 'game' in {run_dir}")

    steps, rets = load_curve(run_dir)
    peak = float(np.nanmax(rets)) if rets.size else None
    last20 = float(np.mean(rets[-20:])) if rets.size >= 20 else None
    title = title_for(run_dir, peak, last20)

    plot_png = out_dir / f"{tag}_plot.png"
    plot_curve(steps, rets, title, plot_png, peak=peak)
    print(f"  plot: {plot_png}")

    ckpt = find_checkpoint(run_dir)
    device = torch.device("cuda" if torch.cuda.is_available() else
                          ("mps" if torch.backends.mps.is_available() else "cpu"))
    # Roll out at the SAME action-repeat the policy trained under (config's
    # frame_skip, default 1), unless overridden. A frame_skip=7 policy rolled
    # out at fs=1 has ~6/7 of its moves swallowed by MOVE_COOLDOWN and only
    # stutters in place — the gif then libels a policy that actually moves.
    fs = args.frame_skip if args.frame_skip is not None else int(cfg.get("frame_skip", 1))
    # Decision horizon: runs trained with the max_decisions knob truncate the env
    # at max_decisions*frame_skip FRAMES (train.py:209). This tool predates that
    # knob and used node-gym's default ~2000-frame cap (~285 decisions at fs7),
    # which cut episodes off mid-solve and made winning policies look like they
    # failed (return at the door-farm floor, length≈285). Honor max_decisions so
    # the rollout has the same budget the policy trained under.
    max_decisions = cfg.get("max_decisions")
    if max_decisions is not None:
        env_max_steps = int(max_decisions) * fs   # node-gym counts frames
        rollout_cap = int(max_decisions)          # rollout loop counts decisions
    else:
        env_max_steps = cfg.get("max_steps") or 2000
        rollout_cap = 2000
    env = PlayTrainEnv(game=game, max_steps=env_max_steps, frame_skip=fs)
    print(f"  rollout frame_skip={fs}  env_max_steps={env_max_steps}f  cap={rollout_cap}d")
    try:
        policy = load_policy(ckpt, env, device, cfg)
        # Pick the rollout env seed(s). Priority:
        #   1. --env-seed CLI override (single seed)
        #   2. train_pool -> the memorized seed pool (resolve_pools). The policy
        #      only ever saw these layouts; cfg.seed is an UNSEEN layout, so a
        #      memorizer would score ~0 there. Roll out on the trained pool.
        #   3. cfg.fixed_env_seed (memorize-one-instance; older configs may drop
        #      this field, so caller can pass --env-seed)
        #   4. cfg.seed (no privileged seed; fall back to the run's torch seed)
        train_seeds = None
        tp = cfg.get("train_pool")
        if tp and args.env_seed is None:
            from analogen.generalization import resolve_pools
            train_seeds, _ = resolve_pools(tp)
        if args.env_seed is not None:
            seed_offset = int(args.env_seed)
        elif cfg.get("fixed_env_seed") is not None:
            seed_offset = int(cfg["fixed_env_seed"])
        else:
            seed_offset = int(cfg.get("seed", 0))
        if train_seeds is not None:
            print(f"  train_pool: {len(train_seeds)} memorized seeds; rolling "
                  f"first {args.n_trials} (deterministic={args.deterministic})")
            ep = best_rollout(policy, env, n_trials=args.n_trials, device=device,
                              deterministic=args.deterministic, seeds=train_seeds,
                              max_steps=rollout_cap)
        else:
            print(f"  rollout env_seed={seed_offset}  (n_trials={args.n_trials}, "
                  f"deterministic={args.deterministic})")
            ep = best_rollout(policy, env, n_trials=args.n_trials, device=device,
                              deterministic=args.deterministic,
                              seed_offset=seed_offset, max_steps=rollout_cap)
        print(f"  rollout: seed={ep.get('seed')} return={ep['total_return']:.0f} "
              f"length={ep['length']} won={ep['won']}")
    finally:
        env.close()

    rollout_gif = out_dir / f"{tag}_rollout.gif"
    imageio.mimsave(rollout_gif, ep["frames"], fps=args.fps)
    print(f"  rollout gif: {rollout_gif}")

    plot_img = fig_to_pil(steps, rets, title, peak, WIN_THRESHOLD)
    side_gif = out_dir / f"{tag}.gif"
    write_sidebyside_gif(side_gif, plot_img, ep["frames"], fps=args.fps)
    print(f"  side-by-side: {side_gif}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run_dirs", type=Path, nargs="+",
                   help="One or more outputs/ppo_* or outputs/impala_* dirs")
    p.add_argument("--out-dir", type=Path, default=Path("outputs/figs/run_cards"))
    p.add_argument("--tag-prefix", default="",
                   help="Prefix for the output filenames (e.g. '01', useful "
                        "for ordering in slack/reports)")
    p.add_argument("--n-trials", type=int, default=10,
                   help="Random-seed rollouts; best one is animated")
    p.add_argument("--deterministic", action="store_true",
                   help="argmax actions instead of sampling")
    p.add_argument("--game", default=None,
                   help="override env game (e.g. analogen_cavequest_easy_recolor) "
                        "to render the rollout on a variant; policy from the ckpt.")
    p.add_argument("--env-seed", type=int, default=None,
                   help="Override rollout env seed. Useful when training used "
                        "fixed_env_seed but the saved config dropped that field, "
                        "so you want to roll out at the actual training layout.")
    p.add_argument("--fps", type=int, default=15)
    p.add_argument("--frame-skip", type=int, default=None,
                   help="Action-repeat for the rollout env. Default None = use "
                        "the run config's frame_skip so the greedy rollout runs "
                        "at the SAME cadence the policy trained at. Rolling a "
                        "frame_skip=7 policy out at fs=1 makes ~6/7 of its moves "
                        "no-ops under MOVE_COOLDOWN, so it stutters/oscillates "
                        "and the gif misrepresents the trained policy.")
    p.add_argument("--scale", type=int, default=4,
                   help="(currently unused; rollout is sized to plot height)")
    args = p.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PLAYTRAIN_GAMES_DIR",
                          str(Path(__file__).resolve().parents[1] / "games" / "js"))

    for i, rd in enumerate(args.run_dirs):
        prefix = f"{args.tag_prefix}_" if args.tag_prefix else ""
        tag = f"{prefix}{rd.name}"
        try:
            process_one(rd, args.out_dir, tag, args)
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR on {rd}: {e}")


if __name__ == "__main__":
    main()
