"""Freeze Figure 4's learning curves into one JSON.

Panels B and C read ~100 MB of TensorBoard event files that live only on
cluster scratch. This dumps the single scalar the plotter actually uses --
the run's return tag, from 1M steps on -- keyed by the same run directories
`plot_main_composite._runs` selects, so the figure's inputs survive a purge
and can be checked into git.

usage: python extract_fig4_curves.py OUT.json
"""
import importlib.util
import json
import sys

sys.argv = ["x", "/tmp/_ignore_extract"]
spec = importlib.util.spec_from_file_location("pmc", "tools/plot_main_composite.py")
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except SystemExit:
    pass

out_path = "outputs/fig4_curves.json"
games = sorted(set(list(mod.GAMES8) + [g for p in mod.PAIRS for g in p[:2]]))

data = {"impala": {}, "ppo": {}}
missing = []
for g in games:
    for arm, fn in (("impala", mod.matrix_impala_runs), ("ppo", mod.ppo_dirs)):
        runs = []
        for d in fn(g):
            r = mod.load_tb(f"{d}/tb")
            if r is None:
                missing.append(f"{arm}:{g}:{d}")
                continue
            step, val = r
            runs.append({"dir": d,
                         "step": [int(s) for s in step],
                         "value": [round(float(v), 4) for v in val]})
        data[arm][g] = runs

json.dump(data, open(out_path, "w"))
for arm in ("impala", "ppo"):
    counts = {g: len(v) for g, v in data[arm].items()}
    print(arm, "seeds per game:", counts)
print("games:", len(games), "unreadable run dirs:", len(missing))
for m in missing[:10]:
    print("  MISSING", m)
