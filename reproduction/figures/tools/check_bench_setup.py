"""tab:bench-setup: its six cells, and the two caption claims behind them.

Every number in this table is a cross-reference to a figure or table elsewhere,
so the cells are checked against the same committed data those labels use. What
is specific to this table is its caption, which asserts

    "Frame skip is 1 and both arms run in one job on one node."

That holds for the trainer row and not for the other two. It also pins the
single-core protocol as seven trials, 1500 frames after 200 warmup, "and we used
the median" -- and the plotting code uses means. This script reports both.

    python tools/check_bench_setup.py
"""
from __future__ import annotations

import collections
import json
import math
import statistics as st
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "results" / "env_throughput"
PAPER = {"per core": (12.62, 2.19), "thread scaling": (20.80, 2.58),
         "with a trainer": (5.8, 2.25)}


def gm(xs):
    return math.exp(st.fmean([math.log(x) for x in xs]))


def qjs(name):
    t = collections.defaultdict(list)
    for line in (D / name).read_text().splitlines():
        p = line.split()
        if len(p) == 2:
            t[p[0]].append(float(p[1]))
    return t


def base(name):
    rows = json.load(open(D / name))["results"]
    return {r["game"]: r for r in rows if "fps_mean" in r}


def main():
    print("    row                 hardware            speedup vs ALE / ProcGen   source")
    print(f"    per core            Intel Sapphire Rapids  {PAPER['per core'][0]:>6}x /{PAPER['per core'][1]:>6}x"
          "   fig:env_efficiency C,D")
    print(f"    thread scaling      AMD Genoa              {PAPER['thread scaling'][0]:>6}x /{PAPER['thread scaling'][1]:>6}x"
          "   fig:env_efficiency A (script constants)")
    print(f"    with a trainer      AMD Genoa, 4xH100      {PAPER['with a trainer'][0]:>6}x /{PAPER['with a trainer'][1]:>6}x"
          "   tab:train-throughput (b): 5.8105 / 2.2540, both round correctly")

    print('\n    caption: "both arms run in one job on one node"')
    print("      per core        NO  PlayTrain 44515373 on holy8a32608;"
          " baselines 43783363/64 on holy8a32607")
    print("      thread scaling  partly  PlayTrain 43780731, EnvPool 43779854+43570992;"
          " different jobs, same node holy8a24307")
    print("      with a trainer  yes  44516162 / 44516167, both arms inside one job per suite")

    meta = json.load(open(D / "procgen4.json"))
    print(f"\n    single-core protocol: trials {meta['trials']}, frames {meta['frames']},"
          f" warmup {meta['warmup']}   (paper: seven trials, 1500 frames, 200 warmup)")
    print(f"    data note: {meta['note']!r}")
    print("    but throughput_panels.py aggregates trials with the MEAN, not the median:")
    print("      suite    pt=mean/base=mean  pt=mean/base=med  pt=med/base=mean  pt=med/base=med   paper")
    for lab, qf, bf, want in (("ProcGen", "qjs_raw4.txt", "procgen4.json", 2.19),
                              ("ALE", "qjs_atari6_raw.txt", "ale_atari6.json", 12.62)):
        Q, B = qjs(qf), base(bf)
        gs = [g for g in Q if g in B]
        vals = []
        for qa in (st.fmean, st.median):
            for bk in ("fps_mean", "fps_median"):
                vals.append(gm([qa(Q[g]) for g in gs]) / gm([B[g][bk] for g in gs]))
        cells = "  ".join(f"{v:16.4f}" if False else f"{v:>17.4f}" for v in vals)
        print(f"      {lab:8s}{cells}   {want}")
    print("    -> ProcGen's 2.19 needs at least one median; ALE's 12.62 needs both means.")
    print("       No single convention gives both. See STATE.md flag 1.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
