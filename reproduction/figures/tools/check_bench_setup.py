"""tab:bench-setup: recompute the per-core row from the raw trials.

The per-core speedups are geometric means over the shared games of the per-game
mean steps/s, PlayTrain over the baseline, from the same committed trials that
draw Figure 4 C and D. The thread-scaling row is Figure 4A's 80-thread point
(checked by `reproduce.sh panel_a` and `bench_scaling`), and the trainer row is
Table 1(b) (checked by `reproduce.sh t1b`).

    python tools/check_bench_setup.py
"""
from __future__ import annotations

import collections
import json
import math
import statistics as st
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "results" / "env_throughput"
PAPER = {"ALE": 12.62, "ProcGen": 2.18}


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
    meta = json.load(open(D / "procgen4.json"))
    print(f"    per core, Intel Sapphire Rapids: {meta['trials']} trials x {meta['frames']} frames"
          f" after {meta['warmup']} warmup, per-game mean, geometric mean over games")
    bad = 0
    for suite, qf, bf in (("ALE", "qjs_atari6_raw.txt", "ale_atari6.json"),
                          ("ProcGen", "qjs_raw4.txt", "procgen4.json")):
        Q, B = qjs(qf), base(bf)
        gs = [g for g in Q if g in B]
        r = gm([st.fmean(Q[g]) for g in gs]) / gm([B[g]["fps_mean"] for g in gs])
        ok = round(r, 2) == PAPER[suite]
        bad += not ok
        print(f"      vs {suite:8s} {r:8.5f}x over {len(gs)} games   paper {PAPER[suite]}x   "
              f"{'match' if ok else 'DIFFERS'}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
