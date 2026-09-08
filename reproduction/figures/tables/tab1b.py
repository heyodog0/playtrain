#!/usr/bin/env python3
"""Table 1(b), the environment swap: PlayTrain replicas against the originals.

Reads the per-game verdicts in verdicts/ and prints the geometric mean per arm.
Jobs 44516162 (ProcGen, 16 games) and 44516167 (ALE, 8 games). Both arms are the
same trainer at the same settings, so only the environment differs.

    python tab1b.py
"""
import glob, math, os, re

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verdicts")


def geo(xs):
    return math.exp(sum(map(math.log, xs)) / len(xs)) if xs else float("nan")


for suite, pat, published in (("ProcGen", "pgt3_*_44516162.verdict", (372, 838)),
                              ("ALE", "alet3_*_44516167.verdict", (175, 1018))):
    arms = {}
    for f in glob.glob(os.path.join(D, pat)):
        m = re.search(r"MEDIAN_SPS (\S+) ([\d.]+)", open(f).read())
        if not m:
            continue
        name = os.path.basename(f)
        arm = "envpool" if "envpool" in name else "tier3"
        arms.setdefault(arm, []).append(float(m.group(2)))
    print(f"{suite}:")
    for arm in ("envpool", "tier3"):
        if arm in arms:
            print(f"  {arm:8s} {geo(arms[arm]):>10,.0f}  (n={len(arms[arm])})")
    print(f"  paper     {published[0]:>7}k -> {published[1]:,}k   (envpool -> tier3)")
