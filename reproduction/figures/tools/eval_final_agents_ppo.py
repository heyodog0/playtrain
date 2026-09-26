"""Post-hoc verification of trained PPO suite agents, tab:eval protocol.

The PPO twin of eval_final_agents.py, same protocol to the letter: greedy
(argmax) rollout of the run's final.pt on held-out seeds 9_000_000+i (disjoint
from training seeds by construction), --episodes episodes, --max-steps cap, and
a uniform-random policy on the SAME seeds for the R column. Output schema is
identical so the two files can be merged column-wise. Usage:
  python tools/eval_final_agents_ppo.py OUT.json --episodes 8 --max-steps 3000 RUN_DIR...
One run per game per invocation: the output dict is keyed by game.
"""
import argparse, json, random
import torch
from playtrain.runtime.env import PlayTrainEnv
from playtrain_trainers.policy import ActorCritic
from playtrain_trainers.ppo_eval import greedy_rollout

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("run_dirs", nargs="+")
p.add_argument("--episodes", type=int, default=8)
p.add_argument("--max-steps", type=int, default=3000)
args = p.parse_args()
dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
seeds = [9_000_000 + i for i in range(args.episodes)]


def random_baseline(env, seeds, max_steps):
    rets = []
    for s in seeds:
        env.reset(seed=s)
        rng = random.Random(s)
        na = env.action_space.n
        total = 0.0
        for _ in range(max_steps):
            _, r, term, trunc, _ = env.step(rng.randrange(na))
            total += float(r)
            if term or trunc:
                break
        rets.append(total)
    return sum(rets) / len(rets)


out = {}
for rd in args.run_dirs:
    rd = rd.rstrip("/")
    cfg = json.load(open(f"{rd}/config.json"))
    env = PlayTrainEnv(game=cfg["game"], frame_skip=cfg.get("frame_skip", 1))
    H, W, C = env.observation_space.shape
    payload = torch.load(f"{rd}/final.pt", map_location=dev, weights_only=False)
    sd = payload["model"]
    use_lstm = any(k.startswith("lstm.") for k in sd)
    features_dim = int(sd["actor.weight"].shape[1])
    feed = use_lstm and int(sd["lstm.weight_ih_l0"].shape[1]) != features_dim
    model = ActorCritic(n_actions=int(env.action_space.n), in_channels=C,
                        features_dim=features_dim, input_hw=H, use_lstm=use_lstm,
                        feed_prev_action_reward=feed,
                        symlog_reward=bool(cfg.get("lstm_symlog_reward", True)),
                        net=cfg["net"]).to(dev)
    model.load_state_dict(sd)
    model.eval()
    rets = [greedy_rollout(model, env, seed=s, max_steps=args.max_steps, device=dev,
                           reward_clip=str(cfg.get("reward_clip", "none")))["total_return"]
            for s in seeds]
    greedy_ret = sum(rets) / len(rets)
    rand_ret = random_baseline(env, seeds, args.max_steps)
    env.close()
    out[cfg["game"]] = {"run": rd + "/", "greedy_return": greedy_ret,
                        "random_return": rand_ret, "ckpt_step": -1,
                        "trainer": "ppo", "net": cfg["net"], "per_seed": rets}
    print(f"{cfg['game']:>16}: greedy {greedy_ret:10.1f}  random {rand_ret:10.1f}", flush=True)
    json.dump(out, open(args.out, "w"), indent=1)
print(f"wrote {args.out} ({len(out)} games)")
