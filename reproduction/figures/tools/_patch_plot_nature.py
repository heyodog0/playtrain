from pathlib import Path
p = Path("tools/plot_main_composite.py"); s = p.read_text()

# 1) matrix IMPALA selection must pin the encoder. Without this it happily picks
#    IMPALA-CNN runs while ppo_dirs() returns Nature ones.
old = '''        if c.get("game") == game and (c.get("total_steps") or 0) >= 100000000:'''
new = '''        if (c.get("game") == game and (c.get("total_steps") or 0) >= 100000000
                and c.get("net") == "nature"):'''
assert s.count(old) == 1, "matrix filter"
s = s.replace(old, new)

# 2) PPO Nature runs live under two prefixes: pv_p_* for most games,
#    ppo_nature_* for bigfish/miner/pong (which have no pv_p_* dirs).
old = '''def ppo_dirs(game):
    tag = game.replace(".", "_")
    return [d for d in (f"outputs/pv_p_{tag}_s{s}" for s in (0, 1, 2))
            if glob.glob(f"{d}/tb/events*")]'''
new = '''def ppo_dirs(game):
    """3-seed PPO Nature runs. Two prefixes: pv_p_* for most games,
    ppo_nature_* for bigfish/miner/pong, which have no pv_p_* dirs."""
    tag = game.replace(".", "_")
    for pref in ("pv_p", "ppo_nature"):
        ds = [d for d in (f"outputs/{pref}_{tag}_s{s}" for s in (0, 1, 2))
              if glob.glob(f"{d}/tb/events*")]
        if ds:
            return ds
    return []'''
assert s.count(old) == 1, "ppo_dirs"
s = s.replace(old, new)

# 3) Retire the ImpalaCNN fixed block. Keeping it would keep bigfish/miner/pong
#    on IMPALA-CNN while everything else moved to Nature.
old = '''    imp, ppo = curves_for(game, fixed_block=(game in IMPALA_RUNS))'''
new = '''    imp, ppo = curves_for(game, fixed_block=False)   # Nature everywhere'''
assert s.count(old) == 1, "call site"
s = s.replace(old, new)

old = '''# fixed-run block (ImpalaCNN both trainers)
IMPALA_RUNS = {'''
new = '''# Retired ImpalaCNN fixed block. It paired ImpalaCNN IMPALA with ImpalaCNN PPO
# for these games while every other game paired ImpalaCNN IMPALA with NATURE
# PPO -- so the panel mixed encoders across games AND mismatched them within the
# other five. Everything is Nature now; kept only because IMPALA_FALLBACK and
# the loader below still reference the names.
IMPALA_RUNS = {'''
assert s.count(old) == 1, "comment"
s = s.replace(old, new)

p.write_text(s)
print("patched plot_main_composite.py")
