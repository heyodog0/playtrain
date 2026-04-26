import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _():
    import csv
    import io
    import json
    import math
    import sys
    from pathlib import Path

    import marimo as mo
    import matplotlib
    import matplotlib.pyplot as plt
    import numpy as np

    _cwd = Path.cwd()
    REPO_ROOT = _cwd
    for _p in [_cwd] + list(_cwd.parents):
        if (_p / "pyproject.toml").exists():
            REPO_ROOT = _p
            break

    SRC_ROOT = REPO_ROOT / "src"
    if str(SRC_ROOT) not in sys.path:
        sys.path.insert(0, str(SRC_ROOT))

    from fast_games.env import GameGymEnv

    matplotlib.rcParams.update(
        {
            "figure.dpi": 150,
            "savefig.dpi": 150,
            "font.size": 11,
            "axes.titlesize": 13,
            "axes.labelsize": 11,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.grid": True,
            "grid.alpha": 0.25,
            "grid.linestyle": "--",
            "axes.spines.top": False,
            "axes.spines.right": False,
        }
    )

    ACTIONS = [
        {"id": 0, "name": "NOOP", "held": "—", "press": "—", "meaning": "Do nothing"},
        {"id": 1, "name": "LEFT", "held": "←", "press": "—", "meaning": "Move paddle left"},
        {"id": 2, "name": "RIGHT", "held": "→", "press": "—", "meaning": "Move paddle right"},
        {"id": 3, "name": "UP", "held": "↑", "press": "—", "meaning": "Unused in breakout"},
        {"id": 4, "name": "DOWN", "held": "↓", "press": "—", "meaning": "Unused in breakout"},
        {"id": 5, "name": "D", "held": "—", "press": "SPACE", "meaning": "Unused in breakout"},
        {"id": 6, "name": "LEFT+D", "held": "←", "press": "SPACE", "meaning": "Mostly same as LEFT"},
        {"id": 7, "name": "RIGHT+D", "held": "→", "press": "SPACE", "meaning": "Mostly same as RIGHT"},
    ]

    def load_json(path: Path):
        return json.loads(path.read_text()) if path.exists() else None

    def load_monitor(path: Path):
        if not path.exists():
            return []
        lines = [line for line in path.read_text().splitlines() if not line.startswith("#")]
        if not lines:
            return []
        reader = csv.DictReader(io.StringIO("\n".join(lines)))
        rows = []
        for row in reader:
            rows.append(
                {
                    "return": float(row["r"]),
                    "length": int(float(row["l"])),
                    "wall_time_s": float(row["t"]),
                }
            )
        return rows

    def discounted_returns(rewards, gamma):
        out = np.zeros(len(rewards), dtype=np.float64)
        running = 0.0
        for i in reversed(range(len(rewards))):
            running = rewards[i] + gamma * running
            out[i] = running
        return out

    def gae_advantages(rewards, values, gamma, lam):
        adv = np.zeros(len(rewards), dtype=np.float64)
        gae = 0.0
        next_value = 0.0
        for i in reversed(range(len(rewards))):
            delta = rewards[i] + gamma * next_value - values[i]
            gae = delta + gamma * lam * gae
            adv[i] = gae
            next_value = values[i]
        return adv

    def capture_rollout(game: str, seed: int, actions: list[int]):
        env = GameGymEnv(game=game, max_steps=max(len(actions) + 5, 50))
        try:
            obs, info = env.reset(seed=seed)
            frames = [obs.copy()]
            rewards = []
            scores = [float(info["score"])]
            terms = []
            truncs = []
            infos = [info]
            for action in actions:
                obs, reward, terminated, truncated, info = env.step(action)
                frames.append(obs.copy())
                rewards.append(float(reward))
                scores.append(float(info["score"]))
                terms.append(bool(terminated))
                truncs.append(bool(truncated))
                infos.append(info)
                if terminated or truncated:
                    break
            return {
                "frames": frames,
                "rewards": rewards,
                "scores": scores,
                "terminated": terms,
                "truncated": truncs,
                "infos": infos,
            }
        finally:
            env.close()

    def random_episode_returns(game: str, episodes: int = 16, max_steps: int = 500, seed0: int = 0):
        returns = []
        lengths = []
        for ep in range(episodes):
            env = GameGymEnv(game=game, max_steps=max_steps)
            try:
                rng = np.random.default_rng(seed0 + ep + 10_000)
                _, _ = env.reset(seed=seed0 + ep)
                total = 0.0
                steps = 0
                while True:
                    action = int(rng.integers(0, 8))
                    _, reward, terminated, truncated, _ = env.step(action)
                    total += reward
                    steps += 1
                    if terminated or truncated:
                        break
                returns.append(total)
                lengths.append(steps)
            finally:
                env.close()
        return np.array(returns), np.array(lengths)

    return (
        ACTIONS,
        GameGymEnv,
        REPO_ROOT,
        capture_rollout,
        discounted_returns,
        gae_advantages,
        load_json,
        load_monitor,
        mo,
        np,
        plt,
        random_episode_returns,
    )


@app.cell(hide_code=True)
def _(REPO_ROOT, load_json, load_monitor):
    smoke_cfg = load_json(REPO_ROOT / "configs" / "smoke_test.json")
    run_cfg = load_json(REPO_ROOT / "outputs" / "experiments" / "breakout" / "ppo" / "20260413_204429" / "config.json")
    result_summary = load_json(REPO_ROOT / "outputs" / "results" / "summary.json")
    validation_summary = load_json(REPO_ROOT / "outputs" / "validation" / "summary.json")
    baselines = load_json(REPO_ROOT / "outputs" / "baselines" / "random_agent_scores.json")
    train_rows = load_monitor(REPO_ROOT / "outputs" / "experiments" / "breakout" / "ppo" / "20260413_204429" / "train_monitor.monitor.csv")
    eval_rows = load_monitor(REPO_ROOT / "outputs" / "experiments" / "breakout" / "ppo" / "20260413_204429" / "eval_monitor.monitor.csv")
    return (
        baselines,
        eval_rows,
        result_summary,
        run_cfg,
        smoke_cfg,
        train_rows,
        validation_summary,
    )


@app.cell(hide_code=True)
def _(REPO_ROOT, np):
    eval_npz_path = REPO_ROOT / "outputs" / "experiments" / "breakout" / "ppo" / "20260413_204429" / "eval" / "evaluations.npz"
    eval_npz = np.load(eval_npz_path) if eval_npz_path.exists() else None
    return (eval_npz,)


@app.cell(hide_code=True)
def _(mo):
    mo.Html(
        """
        <style>
        .ppo-note { font-family: ui-sans-serif, system-ui, sans-serif; }
        .hero {
            padding: 18px 22px;
            border-radius: 16px;
            background: linear-gradient(135deg, #f4f7ff 0%, #eef9f4 100%);
            border: 1px solid #d8e3f0;
            margin-bottom: 10px;
        }
        .hero h1 {
            margin: 0 0 8px 0;
            font-size: 32px;
            line-height: 1.1;
            color: #17324d;
        }
        .hero p {
            margin: 0;
            color: #36516c;
            font-size: 15px;
            line-height: 1.5;
        }
        .card-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin: 14px 0 8px 0;
        }
        .mini-card {
            border-radius: 14px;
            padding: 12px 14px;
            border: 1px solid #d9e2ec;
            background: white;
        }
        .mini-card .k {
            font-size: 11px;
            font-weight: 700;
            color: #5b7086;
            letter-spacing: 0.04em;
        }
        .mini-card .v {
            font-size: 24px;
            font-weight: 800;
            color: #17324d;
            margin-top: 4px;
        }
        .mini-card .s {
            font-size: 12px;
            color: #51677c;
            margin-top: 4px;
            line-height: 1.35;
        }
        .flow {
            font-family: ui-monospace, monospace;
            font-size: 12px;
            max-width: 760px;
            margin: 8px 0 14px 0;
        }
        .flow-row {
            display: flex;
            align-items: stretch;
            gap: 10px;
            margin: 8px 0;
        }
        .flow-box {
            flex: 1;
            border-radius: 12px;
            padding: 10px 12px;
            border: 1px solid #d9e2ec;
        }
        .flow-blue { background: #eef6ff; border-color: #bdd8ff; }
        .flow-green { background: #eefaf3; border-color: #bfe8cd; }
        .flow-orange { background: #fff5e9; border-color: #ffd5a1; }
        .flow-red { background: #fff0f0; border-color: #f0c1c1; }
        .flow-title {
            font-weight: 800;
            margin-bottom: 5px;
            color: #213547;
        }
        .flow-sub { color: #4f6478; line-height: 1.4; }
        .arrow {
            text-align: center;
            color: #74879b;
            font-size: 18px;
            line-height: 1;
            margin: 2px 0;
        }
        </style>
        """
    )
    return


@app.cell(hide_code=True)
def _(
    baselines,
    eval_rows,
    mo,
    run_cfg,
    smoke_cfg,
    train_rows,
    validation_summary,
):
    _baseline = baselines["baselines"]["breakout"] if baselines else {}
    _val = validation_summary["games"]["breakout"] if validation_summary else {}
    _fps = _val.get("throughput", {}).get("fps", 0.0)
    _random_mean = _baseline.get("mean_return", 0.0)
    _train_last = train_rows[-1]["return"] if train_rows else 0.0
    _eval_last = eval_rows[-1]["return"] if eval_rows else 0.0
    _n_envs = run_cfg["n_envs"] if run_cfg else smoke_cfg["n_envs"]
    _n_steps = run_cfg["n_steps"] if run_cfg else smoke_cfg["n_steps"]
    _rollout = _n_envs * _n_steps
    mo.Html(
        f"""
        <div class="ppo-note">
          <div class="hero">
            <h1>RL and PPO, End to End, on Breakout</h1>
            <p>
              This notebook explains reinforcement learning from first principles, then maps each concept
              to the exact <code>breakout</code> environment and PPO training code in this repo. The goal is
              not just to define PPO, but to show what the algorithm is actually doing when it interacts with
              this game, what data it stores, what objective it optimizes, and how to interpret the smoke-test
              artifacts already saved locally.
            </p>
          </div>
          <div class="card-grid">
            <div class="mini-card">
              <div class="k">CASE STUDY</div>
              <div class="v">breakout</div>
              <div class="s">64x64 RGB observations, discrete 8-action interface, reward = score delta.</div>
            </div>
            <div class="mini-card">
              <div class="k">ENV SPEED</div>
              <div class="v">{_fps:,.0f} FPS</div>
              <div class="s">Measured single-game environment throughput from the validation artifacts.</div>
            </div>
            <div class="mini-card">
              <div class="k">ROLLOUT SIZE</div>
              <div class="v">{_rollout:,}</div>
              <div class="s">{_n_envs} envs × {_n_steps} steps per PPO update in the saved smoke run.</div>
            </div>
            <div class="mini-card">
              <div class="k">RANDOM BASELINE</div>
              <div class="v">{_random_mean:.1f}</div>
              <div class="s">Mean episode return from the current cached random-agent baseline file.</div>
            </div>
            <div class="mini-card">
              <div class="k">LAST TRAIN EPISODE</div>
              <div class="v">{_train_last:.1f}</div>
              <div class="s">Final training-episode return from <code>train_monitor.monitor.csv</code>.</div>
            </div>
            <div class="mini-card">
              <div class="k">LAST EVAL EPISODE</div>
              <div class="v">{_eval_last:.1f}</div>
              <div class="s">Final evaluation-episode return from <code>eval_monitor.monitor.csv</code>.</div>
            </div>
          </div>
        </div>
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 1. What Reinforcement Learning Is

    Reinforcement learning (RL) is the study of **sequential decision making under uncertainty**.
    An agent does not get a correct answer label for each frame. Instead, it repeatedly:

    1. sees the current state of the world,
    2. chooses an action,
    3. receives a reward,
    4. lands in a new state,
    5. repeats until the episode ends.

    The agent's objective is not to maximize the next reward only. It tries to maximize the
    **expected sum of discounted future rewards**:

    \[
    G_t = r_t + \gamma r_{t+1} + \gamma^2 r_{t+2} + \cdots
    \]

    where `gamma` is the **discount factor**. In this repo's PPO training script, `gamma = 0.99`
    for per-game training.

    In a game like Breakout, that matters because some actions are useful only indirectly:
    moving the paddle now keeps the ball alive later, which creates more future chances to hit blocks.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.Html(
        """
        <div class="flow">
          <div class="flow-row">
            <div class="flow-box flow-blue">
              <div class="flow-title">Observation</div>
              <div class="flow-sub">The agent receives a 64×64×3 uint8 RGB image from the headless game runtime.</div>
            </div>
            <div class="flow-box flow-orange">
              <div class="flow-title">Policy</div>
              <div class="flow-sub">A neural network turns that image into a probability distribution over 8 discrete actions.</div>
            </div>
            <div class="flow-box flow-green">
              <div class="flow-title">Action</div>
              <div class="flow-sub">The sampled action is sent to the Node worker, which advances the game by one tick.</div>
            </div>
          </div>
          <div class="arrow">↓</div>
          <div class="flow-row">
            <div class="flow-box flow-red">
              <div class="flow-title">Reward</div>
              <div class="flow-sub">Python receives reward = current score − previous score, plus termination/truncation flags.</div>
            </div>
            <div class="flow-box flow-blue">
              <div class="flow-title">New State</div>
              <div class="flow-sub">The new image becomes the next observation, and the loop repeats.</div>
            </div>
            <div class="flow-box flow-green">
              <div class="flow-title">Learning Signal</div>
              <div class="flow-sub">PPO later uses the stored rollout to update both the policy and the value function.</div>
            </div>
          </div>
        </div>
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### RL as a Markov Decision Process in This Repo

    The standard formalism is a **Markov Decision Process (MDP)**: \((\mathcal{S}, \mathcal{A}, P, R, \gamma)\).
    That sounds abstract, but here each piece is concrete:

    | MDP piece | What it means in `gym-gen` breakout |
    |---|---|
    | State `s_t` | The true hidden game state inside the JS runtime: ball position, velocity, paddle position, remaining bricks, score, lives, timers |
    | Observation `o_t` | The rendered `64x64x3` RGB image given to the CNN policy |
    | Action `a_t` | One of 8 discrete template actions |
    | Transition `P(s_{t+1} | s_t, a_t)` | Deterministic game logic given current state, action, and fixed seed |
    | Reward `r_t` | `score_t - score_{t-1}` |
    | Discount `gamma` | `0.99` in the single-game PPO script |

    Note the distinction between **state** and **observation**:
    PPO only sees pixels. The environment internally has richer structured state,
    but that state is not exposed to the policy.
    """)
    return


@app.cell(hide_code=True)
def _(ACTIONS, mo):
    _rows = "\n".join(
        [
            f"| {a['id']} | `{a['name']}` | {a['held']} | {a['press']} | {a['meaning']} |"
            for a in ACTIONS
        ]
    )
    mo.md(
        f"""
        ### Action Space Used by Breakout

        The environment template standardizes **8 actions** across all games. In breakout,
        only left/right movement really matters.

        | id | action | held keys | pressed key | effect in breakout |
        |---:|---|---|---|---|
        {_rows}

        This mismatch is important. PPO is learning over a larger action space than the game really needs.
        That wastes some probability mass and makes random exploration weaker than it would be in a minimal
        3-action breakout-specific interface.
        """
    )
    return


@app.cell(hide_code=True)
def _(capture_rollout):
    scripted_actions = (
        [0] * 8
        + [2] * 16
        + [0] * 8
        + [1] * 16
        + [0] * 8
        + [2] * 12
        + [0] * 12
    )
    scripted_rollout = capture_rollout("breakout", seed=42, actions=scripted_actions)
    return scripted_actions, scripted_rollout


@app.cell(hide_code=True)
def _(np, plt, scripted_actions, scripted_rollout):
    _indices = np.linspace(0, len(scripted_rollout["frames"]) - 1, 6, dtype=int)
    _fig, _axes = plt.subplots(2, 3, figsize=(10.5, 6))
    for _ax, _idx in zip(_axes.flat, _indices):
        _ax.imshow(scripted_rollout["frames"][_idx])
        _title = f"t={_idx}"
        if _idx > 0:
            _title += f"\na={scripted_actions[_idx - 1]}"
        _ax.set_title(_title, fontsize=10)
        _ax.set_xticks([])
        _ax.set_yticks([])
        _ax.grid(False)
    _fig.suptitle("Breakout Observations from a Single Scripted Episode", fontsize=14, y=1.02)
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(np, plt, scripted_rollout):
    _steps = np.arange(len(scripted_rollout["scores"]))
    _fig, _ax = plt.subplots(figsize=(10, 3.8))
    _ax.step(_steps, scripted_rollout["scores"], where="post", linewidth=2.0, color="#1f77b4", label="cumulative score")
    if scripted_rollout["rewards"]:
        _reward_steps = np.arange(1, len(scripted_rollout["rewards"]) + 1)
        _ax.bar(_reward_steps, scripted_rollout["rewards"], width=0.8, alpha=0.35, color="#2ca02c", label="per-step reward")
    _ax.set_xlabel("Environment step")
    _ax.set_ylabel("Score / reward")
    _ax.set_title("Reward in This Repo Is Literally the Score Delta")
    _ax.legend(loc="upper right")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### What the previous two plots show

    1. **Observation stream**:
       the agent sees raw RGB frames only. It never directly observes the ball velocity or the set of bricks remaining.

    2. **Reward stream**:
       reward is sparse and delayed. Many steps yield zero reward, then a brick hit produces a positive jump.
       PPO therefore has to assign credit backward across many earlier paddle movements.

    3. **Episode continuity matters**:
       one action usually has value only because it changes the probability of future rewards.
       This is why RL needs discounting, value estimation, and advantage estimation.
    """)
    return


@app.cell(hide_code=True)
def _(random_episode_returns):
    random_returns, random_lengths = random_episode_returns("breakout", episodes=20, max_steps=500, seed0=100)
    return random_lengths, random_returns


@app.cell(hide_code=True)
def _(np, plt, random_returns):
    _fig, _ax = plt.subplots(figsize=(9, 4))
    _bins = np.arange(random_returns.min() - 5, random_returns.max() + 10, 10)
    _ax.hist(random_returns, bins=_bins, color="#6baed6", edgecolor="white")
    _ax.axvline(random_returns.mean(), color="#d62728", linestyle="--", linewidth=2, label=f"mean = {random_returns.mean():.1f}")
    _ax.set_xlabel("Episode return")
    _ax.set_ylabel("count")
    _ax.set_title("Random Policy Returns on Breakout (20 live episodes)")
    _ax.legend()
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(plt, random_lengths, random_returns):
    _fig, _ax = plt.subplots(figsize=(9, 4))
    _ax.scatter(random_lengths, random_returns, s=50, color="#2ca02c", alpha=0.85)
    _ax.set_xlabel("Episode length")
    _ax.set_ylabel("Episode return")
    _ax.set_title("Random Exploration: Longer Episodes Usually Mean More Chances to Score")
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(baselines, mo, np, random_lengths, random_returns):
    _cached = baselines["baselines"]["breakout"] if baselines else {}
    mo.md(
        f"""
        ### Why start with a random policy?

        A random policy is the cheapest sanity check for any RL environment:

        - It tells you whether the game is trivially scoreable by chance.
        - It gives you a normalization baseline for later experiments.
        - It reveals how sparse the reward signal is.

        In the **live sample above**, the random policy averaged **{random_returns.mean():.1f}** return over
        **{len(random_returns)}** episodes, with mean length **{np.mean(random_lengths):.1f}** steps.

        The **cached baseline artifact** in this repo currently records:

        - mean return = **{_cached.get("mean_return", 0.0):.1f}**
        - std return = **{_cached.get("std_return", 0.0):.1f}**
        - mean length = **{_cached.get("mean_length", 0.0):.1f}**

        That gives a reference point for interpreting PPO. If PPO cannot beat random consistently,
        something is wrong: the implementation, the hyperparameters, or the task itself.
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 2. What PPO Is

    PPO stands for **Proximal Policy Optimization**. It is an **on-policy actor-critic** algorithm.

    Break the phrase apart:

    - **policy optimization**: it directly updates the action distribution \(\pi_\theta(a \mid o)\),
      not just a Q-function.
    - **actor-critic**: it learns two things at once:
      the policy (actor) and a value estimate \(V_\phi(o)\) (critic).
    - **on-policy**: each update uses trajectories collected with the current policy, not stale old data from a replay buffer.
    - **proximal**: the update is deliberately constrained so the policy does not move too far in one step.

    PPO became popular because it is simpler and more stable than older policy-gradient methods like TRPO,
    while still working well on image-control tasks.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.Html(
        """
        <div class="flow">
          <div class="flow-row">
            <div class="flow-box flow-blue">
              <div class="flow-title">1. Collect rollout</div>
              <div class="flow-sub">Run the current policy in the environment for a fixed horizon. Store observations, actions, rewards, dones, and value estimates.</div>
            </div>
            <div class="flow-box flow-green">
              <div class="flow-title">2. Estimate returns</div>
              <div class="flow-sub">Use rewards plus bootstrap values to estimate how good each visited state actually was.</div>
            </div>
          </div>
          <div class="arrow">↓</div>
          <div class="flow-row">
            <div class="flow-box flow-orange">
              <div class="flow-title">3. Compute advantages</div>
              <div class="flow-sub">Measure whether each sampled action did better or worse than the critic expected.</div>
            </div>
            <div class="flow-box flow-red">
              <div class="flow-title">4. Update policy and critic</div>
              <div class="flow-sub">Improve action probabilities for positive-advantage actions, reduce them for negative-advantage actions, and fit the value network.</div>
            </div>
          </div>
          <div class="arrow">↓</div>
          <div class="flow-row">
            <div class="flow-box flow-blue">
              <div class="flow-title">5. Clip policy change</div>
              <div class="flow-sub">Reject updates that change action probabilities too aggressively, which stabilizes learning.</div>
            </div>
            <div class="flow-box flow-green">
              <div class="flow-title">6. Repeat</div>
              <div class="flow-sub">Collect new on-policy data from the updated policy and start another iteration.</div>
            </div>
          </div>
        </div>
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### The three central objects PPO learns

    1. **Policy** \(\pi_\theta(a \mid o)\)
       gives a probability for each action after seeing an observation.

    2. **Value function** \(V_\phi(o)\)
       predicts the expected future discounted return from that observation.

    3. **Advantage** \(A_t\)
       tells us whether the chosen action turned out better or worse than the critic expected.

    The core policy-gradient intuition is:

    - if an action had **positive** advantage, increase its probability;
    - if an action had **negative** advantage, decrease its probability;
    - do not move too far in one update, because large policy jumps often destabilize training.
    """)
    return


@app.cell(hide_code=True)
def _(discounted_returns, np, plt):
    _rewards = np.array([0, 0, 0, 1, 0, 2, 0, 0], dtype=np.float64)
    _gammas = [0.90, 0.99]
    _fig, _ax = plt.subplots(figsize=(9, 4))
    _x = np.arange(len(_rewards))
    _ax.bar(_x, _rewards, color="#9ecae1", label="rewards")
    for _gamma, _color in zip(_gammas, ["#1f77b4", "#d62728"]):
        _returns = discounted_returns(_rewards, _gamma)
        _ax.plot(_x, _returns, marker="o", linewidth=2, color=_color, label=f"discounted return (gamma={_gamma})")
    _ax.set_xlabel("time step")
    _ax.set_ylabel("value")
    _ax.set_title("Discounting Makes Future Rewards Count, but Count Less")
    _ax.legend()
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(gae_advantages, np, plt):
    _rewards = np.array([0, 0, 1, 0, 0, 2], dtype=np.float64)
    _values = np.array([0.30, 0.35, 0.40, 0.45, 0.50, 0.20], dtype=np.float64)
    _advs_95 = gae_advantages(_rewards, _values, gamma=0.99, lam=0.95)
    _advs_50 = gae_advantages(_rewards, _values, gamma=0.99, lam=0.50)

    _fig, _axes = plt.subplots(1, 2, figsize=(11, 4), sharey=True)
    _x = np.arange(len(_rewards))

    _axes[0].bar(_x, _rewards, color="#a1d99b", alpha=0.7, label="reward")
    _axes[0].plot(_x, _values, marker="o", color="#3182bd", linewidth=2, label="critic value")
    _axes[0].set_title("Rewards and Critic Values")
    _axes[0].set_xlabel("time step")
    _axes[0].set_ylabel("value")
    _axes[0].legend()

    _axes[1].plot(_x, _advs_95, marker="o", linewidth=2, color="#e6550d", label="GAE lambda=0.95")
    _axes[1].plot(_x, _advs_50, marker="s", linewidth=2, color="#756bb1", label="GAE lambda=0.50")
    _axes[1].axhline(0.0, color="#666", linewidth=1)
    _axes[1].set_title("Advantage Estimates")
    _axes[1].set_xlabel("time step")
    _axes[1].legend()

    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Advantage estimation, in words

    Suppose the critic predicted that a state was worth `0.4`, but after taking the sampled action,
    the realized future rewards imply that this state-action pair was actually much better.
    Then the action has **positive advantage**.

    PPO often uses **Generalized Advantage Estimation (GAE)**:

    \[
    \delta_t = r_t + \gamma V(o_{t+1}) - V(o_t)
    \]

    \[
    A_t^{\text{GAE}(\gamma,\lambda)} =
    \delta_t + \gamma \lambda \delta_{t+1} + \gamma^2 \lambda^2 \delta_{t+2} + \cdots
    \]

    The parameter `gae_lambda` controls the bias-variance tradeoff:

    - higher `lambda` looks farther ahead and is usually less biased but noisier,
    - lower `lambda` is more myopic and often lower variance.

    In this repo's PPO script, `gae_lambda = 0.95`.
    """)
    return


@app.cell(hide_code=True)
def _(np, plt):
    _ratio = np.linspace(0.5, 1.5, 200)
    _eps = 0.2
    _adv_pos = 1.0
    _adv_neg = -1.0
    _unclipped_pos = _ratio * _adv_pos
    _clipped_pos = np.clip(_ratio, 1 - _eps, 1 + _eps) * _adv_pos
    _unclipped_neg = _ratio * _adv_neg
    _clipped_neg = np.clip(_ratio, 1 - _eps, 1 + _eps) * _adv_neg

    _fig, _axes = plt.subplots(1, 2, figsize=(11, 4), sharey=True)

    _axes[0].plot(_ratio, _unclipped_pos, color="#1f77b4", linewidth=2, label="ratio * A")
    _axes[0].plot(_ratio, _clipped_pos, color="#d62728", linewidth=2, linestyle="--", label="clipped")
    _axes[0].axvspan(1 - _eps, 1 + _eps, color="#fdd0a2", alpha=0.3)
    _axes[0].set_title("Positive Advantage")
    _axes[0].set_xlabel("probability ratio r_t(theta)")
    _axes[0].set_ylabel("surrogate contribution")
    _axes[0].legend()

    _axes[1].plot(_ratio, _unclipped_neg, color="#1f77b4", linewidth=2, label="ratio * A")
    _axes[1].plot(_ratio, _clipped_neg, color="#d62728", linewidth=2, linestyle="--", label="clipped")
    _axes[1].axvspan(1 - _eps, 1 + _eps, color="#fdd0a2", alpha=0.3)
    _axes[1].set_title("Negative Advantage")
    _axes[1].set_xlabel("probability ratio r_t(theta)")
    _axes[1].legend()

    _fig.suptitle("Why PPO Uses Clipping", fontsize=14, y=1.03)
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### The PPO clipped objective

    PPO compares the new policy to the old one through the probability ratio

    \[
    r_t(\theta) = \frac{\pi_\theta(a_t \mid o_t)}{\pi_{\theta_{\text{old}}}(a_t \mid o_t)}.
    \]

    Its clipped surrogate objective is

    \[
    L^{\text{CLIP}}(\theta) =
    \mathbb{E}\left[\min\left(
    r_t(\theta) A_t,\;
    \text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon) A_t
    \right)\right].
    \]

    Intuition:

    - If an action was good, PPO wants to raise its probability.
    - If an action was bad, PPO wants to lower its probability.
    - But it **stops trusting the update** once the ratio moves too far outside the clip window.

    In this repo, `clip_range = 0.2`, so PPO resists policy changes larger than roughly ±20% per update step.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 3. What PPO Looks Like in This Repo's Code

    The single-game training entry point is [`src/fast_games/train/ppo.py`](/Users/heyodogo/code/lab/gym-gen/src/fast_games/train/ppo.py).
    It does five operational things:

    1. create `n_envs` copies of `GameGymEnv`,
    2. collect rollouts of length `n_steps` per environment,
    3. wrap them in `VecMonitor` and `VecTransposeImage`,
    4. call Stable-Baselines3's PPO implementation,
    5. periodically evaluate and save artifacts.

    The actual smoke-test config in this repo is intentionally tiny. It is for plumbing verification, not scientific conclusions.
    """)
    return


@app.cell(hide_code=True)
def _(mo, run_cfg, smoke_cfg):
    _active = run_cfg or smoke_cfg
    _rollout = _active["n_envs"] * _active["n_steps"]
    mo.md(
        f"""
        ### Saved breakout PPO run configuration

        | hyperparameter | value | what it controls |
        |---|---:|---|
        | `n_envs` | {_active["n_envs"]} | parallel environments collecting experience |
        | `n_steps` | {_active["n_steps"]} | rollout length per environment before each PPO update |
        | `batch_size` | {_active["batch_size"]} | minibatch size used in SGD updates |
        | `total_timesteps` | {_active["total_timesteps"]:,} | total environment interactions budget |
        | `gamma` | {run_cfg.get("gamma", 0.99) if run_cfg else 0.99} | reward discount factor |
        | `gae_lambda` | {run_cfg.get("gae_lambda", 0.95) if run_cfg else 0.95} | GAE smoothing parameter |
        | `clip_range` | {run_cfg.get("clip_range", 0.2) if run_cfg else 0.2} | PPO trust-region-like clipping width |
        | `learning_rate` | {run_cfg.get("learning_rate", 2.5e-4) if run_cfg else 2.5e-4} | optimizer step size |
        | `n_epochs` | {run_cfg.get("n_epochs", "n/a") if run_cfg else "n/a"} | how many passes over each rollout |

        With this config, each PPO update uses a rollout buffer of **{_rollout:,} transitions**
        before the optimizer starts modifying the network.

        For the saved breakout smoke run, `total_timesteps = {run_cfg["total_timesteps"]:,}`.
        That means the whole run spans only about **{run_cfg["total_timesteps"] / _rollout:.1f} PPO rollout iterations**.
        That is useful for verifying the pipeline, but it is far too small to judge the real learning potential of the environment.
        """
    )
    return


@app.cell(hide_code=True)
def _(np, plt, train_rows):
    _returns = np.array([row["return"] for row in train_rows], dtype=np.float64)
    _lengths = np.array([row["length"] for row in train_rows], dtype=np.float64)
    _episodes = np.arange(1, len(train_rows) + 1)

    _fig, _axes = plt.subplots(1, 2, figsize=(11, 4))
    _axes[0].plot(_episodes, _returns, marker="o", linewidth=2, color="#1f77b4")
    _axes[0].set_title("Training Episode Returns")
    _axes[0].set_xlabel("episode index")
    _axes[0].set_ylabel("return")

    _axes[1].plot(_episodes, _lengths, marker="o", linewidth=2, color="#ff7f0e")
    _axes[1].set_title("Training Episode Lengths")
    _axes[1].set_xlabel("episode index")
    _axes[1].set_ylabel("steps")

    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(eval_npz, plt):
    if eval_npz is None:
        plt.figure()
    else:
        _timesteps = eval_npz["timesteps"]
        _results = eval_npz["results"]
        _means = _results.mean(axis=1)
        _mins = _results.min(axis=1)
        _maxs = _results.max(axis=1)

        _fig, _ax = plt.subplots(figsize=(8.5, 4))
        _ax.plot(_timesteps, _means, marker="o", linewidth=2, color="#2ca02c", label="mean eval return")
        _ax.fill_between(_timesteps, _mins, _maxs, alpha=0.2, color="#2ca02c", label="min/max across eval episodes")
        _ax.set_xlabel("training timesteps")
        _ax.set_ylabel("evaluation return")
        _ax.set_title("Saved PPO Evaluation Checkpoints")
        _ax.legend()
        _fig.tight_layout()
        _fig
    return


@app.cell(hide_code=True)
def _(baselines, eval_npz, mo, result_summary, train_rows):
    _baseline = baselines["baselines"]["breakout"] if baselines else {}
    _baseline_mean = _baseline.get("mean_return", 0.0)
    _baseline_std = _baseline.get("std_return", 0.0)
    _train_best = max(row["return"] for row in train_rows) if train_rows else 0.0
    _eval_best = float(eval_npz["results"].mean(axis=1).max()) if eval_npz is not None else 0.0
    _normalized = None
    if result_summary:
        _normalized = result_summary["algorithms"]["ppo"]["per_game_normalized"]["breakout"]
    mo.md(
        f"""
        ### Interpreting the saved smoke-test run honestly

        The best saved PPO evaluation checkpoint in this repo reaches about **{_eval_best:.1f}** mean return.
        The cached random baseline file currently reports **{_baseline_mean:.1f} ± {_baseline_std:.1f}**.

        That means:

        - this smoke run does **not** yet establish strong learning,
        - it does confirm that the PPO pipeline, logging, and evaluation path all execute end to end,
        - it gives a concrete artifact to explain how PPO training data is organized in this repo.

        The aggregated summary file currently reports a normalized breakout score of **{_normalized:.2f}**
        for PPO, which is negative because the run budget was tiny and the baseline file is noisy.

        This is exactly why smoke tests are engineering checks, not benchmark results.
        """
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 4. Why PPO Uses a CNN Here

    The policy sees pixels, not symbolic state. Stable-Baselines3's `CnnPolicy` therefore has to do two jobs:

    1. **perception**: infer useful latent features from 64×64 RGB images,
    2. **control**: map those latent features to both action probabilities and value predictions.

    In breakout, the network must infer things like:

    - where the paddle is,
    - where the ball is,
    - how the ball is moving,
    - how many bricks are left,
    - whether the current configuration is risky or promising.

    A single frame does not explicitly reveal velocity, so the policy often has to infer motion from
    short-term visual cues or from predictable dynamics. That is one reason many Atari setups use
    frame stacking; this repo's default breakout smoke run uses a single RGB frame.
    """)
    return


@app.cell(hide_code=True)
def _(GameGymEnv, plt):
    env = GameGymEnv(game="breakout", max_steps=40)
    try:
        obs0, _ = env.reset(seed=7)
        obs1, _, _, _, _ = env.step(2)
        obs2, _, _, _, _ = env.step(2)
    finally:
        env.close()

    _fig, _axes = plt.subplots(1, 3, figsize=(11, 3.6))
    for _ax, _obs, _title in zip(
        _axes,
        [obs0, obs1, obs2],
        ["reset", "after one RIGHT step", "after two RIGHT steps"],
    ):
        _ax.imshow(_obs)
        _ax.set_title(_title, fontsize=10)
        _ax.set_xticks([])
        _ax.set_yticks([])
        _ax.grid(False)
    _fig.suptitle("Even Small Actions Produce Subtle Pixel Changes", fontsize=14, y=1.02)
    _fig.tight_layout()
    _fig
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    That subtlety matters. A symbolic controller could read "paddle x moved from 120 to 124."
    A pixel CNN instead must learn a representation where those image differences become behaviorally meaningful.

    PPO itself does **not** solve perception. PPO is just the optimization method that updates the network.
    The CNN architecture and the environment design determine whether the task is visually learnable in the first place.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 5. How To Test PPO Rigorously on This Game

    A real experiment on breakout should answer a concrete question, not just "did the code run?"

    A sensible first question is:

    > Can PPO learn a policy that consistently beats a random baseline on breakout under held-out test seeds?

    The minimal rigorous protocol would be:

    1. choose a proper training budget, such as `500K` to `5M` timesteps instead of `2K`;
    2. run multiple seeds, not just one;
    3. record train and test seed performance separately;
    4. compare against random and maybe DQN;
    5. report mean and variability, not a single lucky curve.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### A concrete breakout experiment plan

    | experiment piece | recommended starting point |
    |---|---|
    | env | `breakout` |
    | train algorithm | PPO |
    | timesteps | start with `500_000`, then scale upward if learning is visible |
    | number of seeds | at least 3 |
    | eval split | train seeds `0..199`, test seeds `1000..1099` |
    | metrics | mean return, std return, normalized score vs random, generalization gap |
    | artifact checks | monitor logs, eval checkpoints, final deterministic evaluation JSON |

    The existing codebase already supports most of this. What is missing is simply enough training time
    and enough repeated runs to make the curves trustworthy.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ### Commands to reproduce or extend the breakout PPO study

    Smoke test:

    ```bash
    uv run python -m fast_games.train.ppo --game breakout --config configs/smoke_test.json
    ```

    Shorter but more meaningful run:

    ```bash
    uv run python -m fast_games.train.ppo --game breakout --config configs/short_run.json
    ```

    Evaluation on held-out seeds:

    ```bash
    uv run python -m fast_games.eval.evaluate   --game breakout   --model outputs/experiments/breakout/ppo/<run>/final_model.zip   --mode both   --episodes 50
    ```

    Random baseline refresh:

    ```bash
    uv run python -m fast_games.eval.baselines --game breakout --episodes 100
    ```
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ---

    ## 6. Final Mental Model

    If you want the shortest correct summary of what PPO is doing here, it is this:

    - The policy CNN looks at a breakout frame and proposes a distribution over actions.
    - The environment executes one action and produces a reward equal to the score change.
    - PPO gathers many such transitions.
    - The critic estimates how good each visited state was.
    - Advantages say whether sampled actions beat that estimate.
    - PPO nudges the policy toward actions with positive advantage and away from actions with negative advantage.
    - Clipping prevents the policy from changing too violently from one update to the next.

    The quality of the final agent depends on three things together:

    1. the environment providing a coherent learning problem,
    2. the perception stack being expressive enough to read the pixels,
    3. the optimization setup having enough data and stable enough hyperparameters.

    This notebook covered all three in the context of the actual breakout environment and smoke-run artifacts in this repo.
    """)
    return


if __name__ == "__main__":
    app.run()
