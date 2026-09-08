"""Configs for the missing panel-C IMPALA *Nature* seeds.

bossfight/chaser/leaper/ninja/starpilot have a Nature IMPALA run at seed 0 only,
so plot_main_composite falls back to the IMPALA-CNN matrix runs for them while
PPO stays Nature -- an encoder mismatch inside the same panel. Seeds 1 and 2
close it.

Each config is a copy of the seed-0 run the plotter would ALREADY pick (the
lexicographic-max dir among nature runs >=100M at that seed), so the three seeds
are identical apart from the seed.
"""
import glob, json, os

GAMES = ["bossfight", "chaser", "leaper", "ninja", "starpilot"]

def seed0_nature(game):
    best = None
    for cj in glob.glob("outputs/impala_*/config.json"):
        try: c = json.load(open(cj))
        except Exception: continue
        if (c.get("game") == game and c.get("net") == "nature"
                and (c.get("total_steps") or 0) >= 100_000_000
                and c.get("seed", 0) == 0):
            d = cj.rsplit("/", 1)[0]
            if best is None or d > best[0]:      # same tie-break as the plotter
                best = (d, c)
    return best

os.makedirs("outputs/_natfix/configs", exist_ok=True)
made = []
for g in GAMES:
    got = seed0_nature(g)
    if got is None:
        print(f"!! {g}: no seed-0 nature run found"); continue
    src, base = got
    for s in (1, 2):
        c = dict(base)
        c["seed"] = s
        name = f"natfix_{g}_s{s}"
        c["log_dir"] = f"outputs/_natfix/{name}"
        p = f"outputs/_natfix/configs/{name}.json"
        json.dump(c, open(p, "w"), indent=1)
        made.append(p)
    print(f"{g}: template {src}  steps={base.get('total_steps'):,} "
          f"batch={base.get('batch_size')} workers={base.get('vec_workers')} "
          f"dev={base.get('vec_worker_device')} -> seeds 1,2")

with open("outputs/_natfix/manifest_impala.txt", "w") as f:
    for p in made:
        f.write(f"impala {p}\n")
print(f"\nwrote {len(made)} configs -> outputs/_natfix/manifest_impala.txt")
