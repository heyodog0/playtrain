"""tab:dbuf-ablation: the caption's claims beside what the data says.

The table body itself is reproduced byte-for-byte by dbuf_tex2.py. What this
checks is the caption's prose: the overall 1.34x, the plunder regression, and
the mechanism claim that the gain "tracks how environment-bound a game is".

That mechanism claim holds strongly. Its worked example does not: miner and
leaper are the two largest GAINS, not the two slowest environments, and leaper
is in fact mid-pack and the clearest exception to the trend. See PROVENANCE.md
and STATE.md flag 14.

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
    print(f"    overall geomean ratio {overall:.2f}x   (paper: {PAPER_OVERALL}x)")
    print(f"    median {med:.2f}x, range {min(ratio.values()):.2f}-{max(ratio.values()):.2f}x"
          f"   (paper: median {PAPER_MEDIAN}x, range 0.92-2.08x)")
    print(f"    plunder {ratio['plunder']:.2f}x at {single['plunder']:,.0f} single-buffered"
          "   (paper: 0.97x at nearly a million)")

    gs = sorted(ratio, key=lambda g: -ratio[g])
    print(f"    corr(log env-only per-core SPS, log ratio)      {corr([math.log(env[g]) for g in gs], [math.log(ratio[g]) for g in gs]):+.3f}")
    print(f"    corr(log single-buffered trainer SPS, log ratio) {corr([math.log(single[g]) for g in gs], [math.log(ratio[g]) for g in gs]):+.3f}")
    print("    -> the caption's \"gain tracks how environment-bound a game is\" holds")

    slow_env = sorted(env, key=lambda g: env[g])[:2]
    slow_run = sorted(single, key=lambda g: single[g])[:2]
    print(f"    largest gains:                    {', '.join(gs[:2])}"
          "   (paper calls these the two slowest)")
    print(f"    actually slowest, env-only:       {', '.join(slow_env)}")
    print(f"    actually slowest, single-buffered: {', '.join(slow_run)}")
    rank = sorted(env, key=lambda g: env[g]).index("leaper") + 1
    print(f"    leaper is {rank}th slowest of {len(env)} by env-only SPS ({env['leaper']:,.0f}),"
          f" yet gains {ratio['leaper']:.2f}x -- the trend's clearest exception")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
