"""tab:dbuf-ablation: the caption's claims beside what the data says.

The table body itself is reproduced byte-for-byte by dbuf_tex2.py. What this
checks is the caption's prose: the overall 1.34x, the plunder regression, and
the mechanism claim that the gain "tracks how environment-bound a game is".

That mechanism claim holds strongly. Its worked example does not: miner and
leaper are the two largest GAINS, not the two slowest environments, and leaper
is in fact mid-pack and the clearest exception to the trend. See PROVENANCE.md
and.

    python dbuf_check.py
"""
import glob
import json
import math
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import throughput_panels as T          # noqa: E402  (per-core env-only speeds)

PAPER_OVERALL, PAPER_MEDIAN = 1.34, 1.20


def corr(xs, ys):
    mx, my = st.fmean(xs), st.fmean(ys)
    return (sum((a - mx) * (b - my) for a, b in zip(xs, ys))
            / math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys)))


def main():
    pg, at, _ = T.load()
    env = {r[0]: r[1] for r in pg + at}
    ratio, single, double = {}, {}, {}
    for f in glob.glob(os.path.join(HERE, "data", "dbuf_t3_44861569_*.json")):
        d = json.load(open(f))
        g = d["games"]
        ratio[g] = d["a4_over_a3_geomean"]
        single[g] = d["arms"]["a3"]["geomean_sps"]
        double[g] = d["arms"]["a4"]["geomean_sps"]

    gm = lambda xs: math.exp(st.fmean([math.log(x) for x in xs]))
    overall = gm(list(double.values())) / gm(list(single.values()))
    med = st.median(ratio.values())
    gs = sorted(ratio, key=lambda g: -ratio[g])
    r_env = corr([math.log(env[g]) for g in gs], [math.log(ratio[g]) for g in gs])
    checks = [
        (f"geometric-mean gain {overall:.2f}x (paper 1.34x)", round(overall, 2) == PAPER_OVERALL),
        (f"median {med:.2f}x (paper 1.20x)", round(med, 2) == PAPER_MEDIAN),
        (f"range {min(ratio.values()):.2f}-{max(ratio.values()):.2f}x (paper 0.92-2.08x)",
         (round(min(ratio.values()), 2), round(max(ratio.values()), 2)) == (0.92, 2.08)),
        (f"helps most on the slowest environments (corr of gain with env speed {r_env:+.2f})", r_env < -0.5),
    ]
    for what, ok in checks:
        print(f"    {what:72s} {'match' if ok else 'DIFFERS'}")
    return 0 if all(ok for _, ok in checks) else 1

if __name__ == "__main__":
    raise SystemExit(main())
