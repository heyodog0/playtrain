"""Post-hoc verification of trained suite agents.

For each run dir (config.json + final.pt): greedy-eval the checkpoint on
held-out seeds (disjoint from training seeds by construction: 9_000_000+i,
the trainer's own eval convention) and run a random-policy baseline on the
SAME seeds. Reports mean return for both. Usage:
  python tools/eval_final_agents.py OUT.json --episodes 8 --max-steps 3000 RUN_DIR...
"""
import argparse, json, random
import torch
from playtrain.runtime.env import PlayTrainEnv
from playtrain_trainers.impala.net import ImpalaNet
from playtrain_trainers.impala.eval import greedy_eval

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
    cfg = json.load(open(f"{rd}/config.json"))
    model = ImpalaNet(cfg["obs_shape"], cfg["num_actions"],
                      features_dim=cfg["features_dim"], use_lstm=cfg["use_lstm"],
                      use_popart=cfg.get("use_popart", False), net=cfg["net"]).to(dev)
    ckpt = torch.load(f"{rd}/final.pt", map_location=dev, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    env = PlayTrainEnv(game=cfg["game"], frame_skip=cfg["frame_skip"],
                       frame_stack=cfg["frame_stack"])
    _, greedy_ret = greedy_eval(model, env, seeds=seeds, device=dev,
                                max_steps=args.max_steps, win_threshold=1e18)
    rand_ret = random_baseline(env, seeds, args.max_steps)
    env.close()
    out[cfg["game"]] = {"run": rd, "greedy_return": greedy_ret,
                        "random_return": rand_ret,
                        "ckpt_step": int(ckpt.get("step", -1))}
    print(f'{cfg["game"]:>16}: greedy {greedy_ret:10.1f}  random {rand_ret:10.1f}', flush=True)
json.dump(out, open(args.out, "w"), indent=1)
print("wrote", args.out)
