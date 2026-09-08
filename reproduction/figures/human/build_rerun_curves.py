"""Rebuild CURVES.json for the human figure straight from the rr_* run dirs.

Supersedes the extract/add_ppo pair, which globbed `outputs/*/config.json` and
so could not even see `outputs/_rerun/rr_*` (one level deeper). Reading the
protocol runs by name is both simpler and auditable: the encoder actually used
is read from each run's own config and recorded in the meta, rather than being
implied by a directory-naming convention.

Both arms must be the SAME encoder. They were not: rr_impala_* was IMPALA-CNN
while rr_ppo_* was Nature, putting a 4.3x-FLOP encoder gap inside every
trainer comparison in the figure. --require-net enforces it.

usage: python build_rerun_curves.py OUT.json [--root outputs/_rerun] [--require-net nature]
"""
import argparse, glob, json, os, statistics as st

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]
RET_TAGS = ("charts/ep_return_mean", "episode_return")
SPS_TAGS = ("charts/sps", "sps")


def read(run_dir):
    fs = (glob.glob(f"{run_dir}/tb/**/events*", recursive=True)
          or glob.glob(f"{run_dir}/tb/events*"))
    if not fs:
        return None
    ea = EventAccumulator(sorted(fs)[-1]); ea.Reload()
    tags = ea.Tags().get("scalars", [])
    rt = next((t for t in RET_TAGS if t in tags), None)
    if not rt:
        return None
    s = ea.Scalars(rt)
    sp = next((t for t in SPS_TAGS if t in tags), None)
    sps = st.median([x.value for x in ea.Scalars(sp)]) if sp else None
    return {"run": os.path.basename(run_dir),
            "step": [x.step for x in s], "value": [x.value for x in s],
            "sps": sps}


ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--root", default="outputs/_rerun")
ap.add_argument("--require-net", default="nature")
a = ap.parse_args()

d = {"curves": {}, "ppo_curves": {}, "meta": {}, "ppo_meta": {}}
problems = []
for trainer, ck, mk in (("impala", "curves", "meta"), ("ppo", "ppo_curves", "ppo_meta")):
    for g in GAMES:
        runs, nets = [], set()
        for s in (0, 1, 2):
            rd = f"{a.root}/rr_{trainer}_{g}_s{s}"
            if not os.path.isdir(rd):
                continue
            try:
                nets.add(str(json.load(open(f"{rd}/config.json")).get("net")))
            except Exception:
                nets.add("?")
            c = read(rd)
            if c:
                runs.append(c)
        if not runs:
            problems.append(f"{trainer}/{g}: no runs")
            continue
        if len(runs) < 3:
            problems.append(f"{trainer}/{g}: only {len(runs)} seeds")
        if len(nets) != 1:
            problems.append(f"{trainer}/{g}: mixed encoders {sorted(nets)}")
        elif a.require_net and nets != {a.require_net}:
            problems.append(f"{trainer}/{g}: net={nets.pop()} != {a.require_net}")
        d[ck][g] = runs
        d[mk][g] = {"trainer": trainer, "net": sorted(nets)[0],
                    "runs": [r["run"] for r in runs]}

json.dump(d, open(a.out, "w"))
print(f"wrote {a.out}: "
      f"{sum(len(v) for v in d['curves'].values())} impala + "
      f"{sum(len(v) for v in d['ppo_curves'].values())} ppo runs "
      f"over {len(d['curves'])} games")
for g in GAMES:
    i, p = d["meta"].get(g, {}), d["ppo_meta"].get(g, {})
    print(f"  {g:13s} impala net={i.get('net'):7s} n={len(d['curves'].get(g, [])):d}   "
          f"ppo net={p.get('net'):7s} n={len(d['ppo_curves'].get(g, [])):d}")
if problems:
    print("\n!! problems:")
    for p in problems:
        print("   " + p)
    raise SystemExit(1)
