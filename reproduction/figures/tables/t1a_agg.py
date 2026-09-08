#!/usr/bin/env python
# Table 1(a) aggregation: tier3fix (this run) vs adv2 (jobs 44670988/899/900/901).
# Per game: rows[0]["sps"] (the harness median of windows, first discarded).
# Across games: GEOMETRIC mean. ProcGen16 / ALE8 splits printed separately.
import glob, json, math, os, sys

OUTS = os.environ.get("T1A_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PROCGEN = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
ALE = "asteroids breakout freeway frostbite pong qbert seaquest space_invaders".split()
ALL24 = PROCGEN + ALE
ADV = {"impala_nature": "44670988", "impala_icnn": "44670899",
       "ppo_nature": "44670900", "ppo_impala": "44670901"}
NEWJOB = dict(z.split("=", 1) for z in sys.argv[1:])   # row=arrayjobid


def load(pat):
    d = {}
    for f in glob.glob(pat):
        g = os.path.basename(f)[:-5].split("_", 4)[-1]
        try:
            j = json.load(open(f))
            r = j["rows"][0]
            if r.get("sps"):
                d[r["game"]] = float(r["sps"])
        except Exception as e:
            print("  BAD", os.path.basename(f), e)
    return d


def gm(xs):
    return math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")


def split(d):
    return (gm([d[g] for g in ALL24 if g in d]),
            gm([d[g] for g in PROCGEN if g in d]),
            gm([d[g] for g in ALE if g in d]))


print("row                     n   ARM        ALL24     ProcGen16        ALE8")
summary = {}
for row in ("impala_nature", "impala_icnn", "ppo_nature", "ppo_impala"):
    a = load(f"{OUTS}/t1a_adv2_{row}_{ADV[row]}_*.json")
    # row=job1+job2: later jobs override earlier ones per game (re-runs of tasks
    # that landed on a degraded node win over the original measurement).
    t = {}
    for jid in NEWJOB.get(row, "").split("+"):
        if jid:
            t.update(load(f"{OUTS}/t1a_t3fix_{row}_{jid}_*.json"))
    for name, d in (("adv2", a), ("t3fix", t)):
        if not d:
            print(f"{row:22s} {len(d):3d}  {name:6s}  (no data)")
            continue
        A, P, L = split(d)
        print(f"{row:22s} {len(d):3d}  {name:6s} {A:12,.0f} {P:12,.0f} {L:12,.0f}")
    summary[row] = (a, t)
    common = sorted(set(a) & set(t))
    if common:
        print(f"{'':22s}      ratio  {gm([t[g]/a[g] for g in common]):12.4f}"
              f" {gm([t[g]/a[g] for g in common if g in PROCGEN]):12.4f}"
              f" {gm([t[g]/a[g] for g in common if g in ALE]):12.4f}   (n={len(common)})")
        miss = [g for g in ALL24 if g not in t]
        if miss:
            print(f"{'':22s}      MISSING t3fix: {' '.join(miss)}")
    print()

print("\nper-game t3fix / adv2")
print(f"{'game':16s}" + "".join(f"{r:>26s}" for r in summary))
for g in ALL24:
    line = f"{g:16s}"
    for row, (a, t) in summary.items():
        if g in a and g in t:
            line += f"{a[g]:11,.0f}{t[g]:11,.0f}{t[g]/a[g]:5.2f}"
        else:
            line += f"{'-':>26s}"
    print(line)
