"""Greedy-eval suite checkpoints on the HUMAN seed pool, capped like humans.

Differs from the suite evaluator in ways that matter for comparing to
human play:
  * seeds are 90000+i, the pool the study served, not the trainer's 9_000_000+i
  * --max-steps defaults to 2000, the study's episode truncation, so agent and
    human episodes end on the same rule
  * output is keyed per run dir, so a game's seeds do not overwrite each other
  * handles BOTH checkpoint formats: IMPALA runs store `model_state_dict` and
    are ImpalaNet; PPO runs (pv_p_*) store `model` and are ActorCritic

usage: python _eval_human_seeds.py OUT.json CURVES.json [--episodes N] [--max-steps N]
"""
import argparse
import json
import random

import torch
from playtrain.runtime.env import PlayTrainEnv

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("curves")
p.add_argument("--episodes", type=int, default=100)
p.add_argument("--max-steps", type=int, default=2000)
p.add_argument("--seed-base", type=int, default=90000)
args = p.parse_args()

dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
seeds = [args.seed_base + i for i in range(args.episodes)]
print(f"device={dev}  seeds={seeds[0]}..{seeds[-1]}  max_steps={args.max_steps}",
      flush=True)


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


def eval_impala(rdp, cfg, env):
    from playtrain_trainers.impala.net import ImpalaNet
    from playtrain_trainers.impala.eval import greedy_eval
    model = ImpalaNet(cfg["obs_shape"], cfg["num_actions"],
                      features_dim=cfg["features_dim"], use_lstm=cfg["use_lstm"],
                      use_popart=cfg.get("use_popart", False),
                      net=cfg["net"]).to(dev)
    ck = torch.load(f"{rdp}/final.pt", map_location=dev, weights_only=False)
    model.load_state_dict(ck["model_state_dict"])
    model.eval()
    _, ret = greedy_eval(model, env, seeds=seeds, device=dev,
                         max_steps=args.max_steps, win_threshold=1e18)
    return ret, int(ck.get("step", -1))


def eval_ppo(rdp, cfg, env):
    from playtrain_trainers.policy import ActorCritic
    from playtrain_trainers.ppo_eval import greedy_rollout
    obs, _ = env.reset(seed=seeds[0])
    H, W, C = obs.shape
    model = ActorCritic(n_actions=env.action_space.n, in_channels=C, input_hw=H,
                        net=cfg.get("net", "nature"),
                        use_lstm=cfg.get("use_lstm", False),
                        feed_prev_action_reward=bool(cfg.get("use_lstm", False))
                        and bool(cfg.get("feed_prev_action_reward", False)),
                        symlog_reward=cfg.get("lstm_symlog_reward", False)).to(dev)
    ck = torch.load(f"{rdp}/final.pt", map_location=dev, weights_only=False)
    model.load_state_dict(ck["model"])
    model.eval()
    rets = [greedy_rollout(model, env, seed=s, max_steps=args.max_steps,
                           device=dev,
                           reward_clip=cfg.get("reward_clip", "none"))["total_return"]
            for s in seeds]
    return sum(rets) / len(rets), int(ck.get("global_step", -1))


chosen = json.load(open(args.curves))["chosen"]
out = {}
for game, info in chosen.items():
    for rd in info["runs"]:
        rdp = f"outputs/{rd}"
        cfg = json.load(open(f"{rdp}/config.json"))
        env = PlayTrainEnv(game=cfg["game"],
                           frame_skip=cfg.get("frame_skip", 1),
                           frame_stack=cfg.get("frame_stack", 1))
        is_ppo = rd.startswith("pv_p_") or rd.startswith("ppo_")
        try:
            ret, cstep = (eval_ppo if is_ppo else eval_impala)(rdp, cfg, env)
        except Exception as e:
            print(f"!! {rd}: {type(e).__name__}: {e}", flush=True)
            env.close()
            continue
        rand = random_baseline(env, seeds, args.max_steps)
        env.close()
        out[rd] = dict(game=game, run=rd, trainer="ppo" if is_ppo else "impala",
                       net=cfg.get("net"), greedy_return=ret, random_return=rand,
                       episodes=len(seeds), max_steps=args.max_steps,
                       seed_base=args.seed_base, ckpt_step=cstep)
        print(f"{game:>13} {rd:<24} {'ppo' if is_ppo else 'impala':<7} "
              f"greedy {ret:9.2f}  random {rand:9.2f}", flush=True)
        json.dump(out, open(args.out, "w"), indent=1)

json.dump(out, open(args.out, "w"), indent=1)
print("wrote", args.out)
