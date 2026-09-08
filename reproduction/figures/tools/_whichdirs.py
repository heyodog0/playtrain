import glob, json
for g in ["bigfish","miner","pong","bossfight","chaser","leaper","ninja","starpilot"]:
    ppo, imp = [], []
    for cj in glob.glob("outputs/*/config.json"):
        try: c = json.load(open(cj))
        except Exception: continue
        if c.get("game") != g or c.get("net") != "nature": continue
        steps = c.get("total_steps") or c.get("total_timesteps") or 0
        if steps < 1e8: continue
        d = cj.rsplit("/",1)[0]
        if not (glob.glob(f"{d}/tb/**/events*", recursive=True) or glob.glob(f"{d}/tb/events*")):
            continue
        (ppo if "n_minibatches" in c else imp).append((d.split("/")[-1], c.get("seed",0), steps))
    print(f"--- {g}")
    print("   PPO   :", sorted(ppo)[:4])
    print("   IMPALA:", sorted(imp)[:4])
print()
c = json.load(open("outputs/impala_35040081/config.json"))
print("gen_rerun impala template impala_35040081: net =", c.get("net"),
      " batch =", c.get("batch_size"), " workers =", c.get("vec_workers"))
