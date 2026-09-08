import glob, json, collections
WANT = ["bigfish","bossfight","chaser","leaper","ninja","starpilot","miner","pong",
        "asteroids","breakout","caveflyer","coinrun","flappy_bird","plunder","seaquest","vvvvvv"]
have = collections.defaultdict(lambda: collections.defaultdict(set))
for cj in glob.glob("outputs/*/config.json"):
    try: c = json.load(open(cj))
    except Exception: continue
    g, net = c.get("game"), c.get("net")
    if g not in WANT: continue
    steps = c.get("total_steps") or c.get("total_timesteps") or 0
    if steps < 1e8: continue
    trainer = "ppo" if "n_minibatches" in c else "impala"
    d = cj.rsplit("/",1)[0]
    if glob.glob(f"{d}/tb/**/events*", recursive=True) or glob.glob(f"{d}/tb/events*"):
        have[g][(trainer, net)].add(c.get("seed", 0))
print("%-14s %-22s %-22s" % ("game", "IMPALA nature seeds", "PPO nature seeds"))
print("-"*62)
for g in WANT:
    i = sorted(have[g].get(("impala","nature"), []))
    p = sorted(have[g].get(("ppo","nature"), []))
    flag = "" if (len(i)>=3 and len(p)>=3) else "   <- needs runs"
    print("%-14s %-22s %-22s%s" % (g, i or "-", p or "-", flag))
