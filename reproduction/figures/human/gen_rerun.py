"""Generate configs for the human-study rerun: 8 games x {impala, ppo} x 3 seeds.

Templates are the runs that already worked, so only game / seed / log_dir / budget
change. Fresh runs also pick up the current game files, which matters because
flappy_bird's dynamics changed after the existing agents were trained.
"""
import json, os, sys
GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]
STEPS = 100_000_000
TPL = {"impala": "outputs/impala_35040081/config.json",
       "ppo":    "outputs/pv_p_caveflyer_s0/config.json"}
only = sys.argv[1] if len(sys.argv) > 1 else None
os.makedirs("outputs/_rerun/configs", exist_ok=True)
made = []
for tr, tp in TPL.items():
    base = json.load(open(tp))
    for g in GAMES:
        if only and g != only:
            continue
        for s in (0, 1, 2):
            c = dict(base)
            c["game"] = g
            c["seed"] = s
            name = f"rr_{tr}_{g}_s{s}"
            c["log_dir"] = f"outputs/_rerun/{name}"
            # Both arms on the IMPALA-CNN. They were mismatched before
            # (IMPALA-CNN IMPALA against Nature PPO), putting a 4.3x-FLOP
            # encoder gap inside every trainer comparison in the figure.
            # IMPALA-CNN is the ProcGen-standard encoder and the stronger one;
            # Table 1 now reports both encoders, so the figure does not have to
            # share the throughput headline's encoder to be readable.
            c["net"] = "impala"
            if tr == "impala":
                # 50 -> 5: 61 logged points per run left the curve starting at
                # 1.6M steps with nothing before it. 5 gives ~610, from ~160k.
                c["stats_log_every"] = 5
                # keep vec workers off the learner's GPU: sharing cuda:0 with the
                # learner halves throughput (157k vs 308k on breakout, same config)
                c["vec_worker_device"] = "cuda:2,cuda:3"
            for k in ("total_timesteps", "total_steps", "steps"):
                if k in base:
                    c[k] = STEPS
            p = f"outputs/_rerun/configs/{name}.json"
            json.dump(c, open(p, "w"), indent=1)
            made.append((tr, p))
for trainer in ("impala", "ppo"):
    with open(f"outputs/_rerun/manifest_{trainer}.txt", "w") as f:
        for tr, p in made:
            if tr == trainer:
                f.write(f"{tr} {p}\n")
print(f"wrote {len(made)} configs -> manifest_impala.txt + manifest_ppo.txt")
for tr, p in made[:4]:
    print("  ", tr, p)
print("  template keys checked:", [k for k in ("total_timesteps","total_steps","steps","vec_worker_device","device") if k in json.load(open(TPL['impala']))])
