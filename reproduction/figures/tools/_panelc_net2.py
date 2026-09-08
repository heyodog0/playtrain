"""Mirror the PATCHED selection logic in plot_main_composite.py and report
encoder + seed count per panel-C game."""
import glob, json
GAMES8 = ["bigfish","bossfight","chaser","leaper","ninja","starpilot","miner","pong"]

def matrix_impala_runs(game):                      # patched: net=="nature"
    by_seed = {}
    for cj in glob.glob("outputs/impala_*/config.json") + glob.glob("outputs/_natfix/*/config.json"):
        try: c = json.load(open(cj))
        except Exception: continue
        if (c.get("game") == game and (c.get("total_steps") or 0) >= 100000000
                and c.get("net") == "nature"):
            d = cj.rsplit("/",1)[0]; s = c.get("seed", 0)
            if s not in by_seed or d > by_seed[s]: by_seed[s] = d
    return sorted(by_seed.values())

def ppo_dirs(game):                                # patched: two prefixes
    tag = game.replace(".", "_")
    for pref in ("pv_p", "ppo_nature"):
        ds = [d for d in (f"outputs/{pref}_{tag}_s{s}" for s in (0,1,2))
              if glob.glob(f"{d}/tb/events*")]
        if ds: return ds
    return []

def nets(ds):
    out = set()
    for d in ds:
        try: out.add(json.load(open(f"{d}/config.json")).get("net"))
        except Exception: out.add("?")
    return ",".join(sorted(map(str, out))) or "-"

print("%-11s %-16s %-16s %s" % ("game", "IMPALA (net/n)", "PPO (net/n)", "status"))
print("-"*62)
for g in GAMES8:
    i, p = matrix_impala_runs(g), ppo_dirs(g)
    istr, pstr = f"{nets(i)}/{len(i)}", f"{nets(p)}/{len(p)}"
    if nets(i) == "nature" and nets(p) == "nature":
        st = "MATCHED" + ("" if len(i) >= 3 else f"  (only {len(i)} impala seeds)")
    else:
        st = "*** MISMATCH ***"
    print("%-11s %-16s %-16s %s" % (g, istr, pstr, st))
