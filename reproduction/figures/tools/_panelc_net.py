import glob, json
GAMES8 = ["bigfish","bossfight","chaser","leaper","ninja","starpilot","miner","pong"]
IMPALA_RUNS = {"bigfish":1,"coinrun":1,"seaquest":1,"pong":1,"miner":1}

def matrix_impala_runs(game):
    by_seed = {}
    for cj in glob.glob("outputs/impala_*/config.json"):
        try: c = json.load(open(cj))
        except Exception: continue
        if c.get("game") == game and (c.get("total_steps") or 0) >= 100000000:
            d = cj.rsplit("/", 1)[0]; s = c.get("seed", 0)
            if s not in by_seed or d > by_seed[s]: by_seed[s] = d
    return sorted(by_seed.values())

def net_of(d, key="net"):
    try: return json.load(open(f"{d}/config.json")).get(key)
    except Exception: return "?"

print("%-12s %-8s %-22s %-22s %s" % ("game", "block", "IMPALA net", "PPO net", "match"))
print("-" * 82)
for g in GAMES8:
    if g in IMPALA_RUNS:
        blk = "fixed"
        inets = "impala(hardcoded)"
        pnets = sorted({net_of(f"outputs/ppo_impala_{g}_s{s}") for s in (0,1,2)})
    else:
        blk = "matrix"
        inets = sorted({net_of(d) for d in matrix_impala_runs(g)}) or ["<none>"]
        pnets = sorted({net_of(f"outputs/pv_p_{g}_s{s}") for s in (0,1,2)
                        if glob.glob(f"outputs/pv_p_{g}_s{s}/tb/events*")}) or ["<none>"]
        inets = ",".join(map(str, inets))
    pnets = ",".join(map(str, pnets)) if not isinstance(pnets, str) else pnets
    ok = "OK" if (str(inets).startswith("impala") and "impala" in str(pnets)) or \
                 (str(inets) == str(pnets)) else "*** MISMATCH ***"
    print("%-12s %-8s %-22s %-22s %s" % (g, blk, inets, pnets, ok))
