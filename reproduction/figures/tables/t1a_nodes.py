"""Table 1(a): the node each measurement came from, and what that costs.

Every row of Table 1(a) is an array job with one game per task and no --nodelist,
so its 24 games were measured on seven or eight different nodes. The campaign
already knew some nodes were degraded: t1a_t3fix.sbatch excludes
holygpu8a134{01..04} and holygpu8a17601, and the three re-run jobs (44784183/84/85)
add holygpu8a15203 to that exclude list.

impala_icnn is the one row with no re-run, so six of its games still carry
measurements from holygpu8a15203. This script shows the per-node means and what
the row's geometric mean becomes without that node. See PROVENANCE.md
§ tab:train-throughput and STATE.md flag 7.

    python t1a_nodes.py
"""
import glob
import json
import math
import os
import statistics as st
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
EXCLUDED_ON_RERUN = "holygpu8a15203"
ROWS = {"impala_nature": ["44748571", "44784183"], "impala_icnn": ["44748573", "47057946"],
        "ppo_nature": ["44748574", "44784184"], "ppo_impala": ["44748575", "44784185"]}
PAPER = {"impala_nature": 1.07e6, "impala_icnn": 0.35e6,
         "ppo_nature": 185e3, "ppo_impala": 68e3}


def gm(xs):
    return math.exp(st.fmean([math.log(x) for x in xs]))


def node_map():
    m = {}
    for line in open(os.path.join(HERE, "nodes", "t1a_nodes.tsv")):
        if line.startswith("#"):
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) >= 6 and f[3] != "-":
            m[(f[2], f[4])] = f[5]      # (job, game) -> node
    return m


def main():
    nodes = node_map()
    for row, jobs in ROWS.items():
        sps, src = {}, {}
        for j in jobs:                   # later jobs override earlier ones
            for p in glob.glob(os.path.join(HERE, "data", f"t1a_t3fix_{row}_{j}_*.json")):
                # the game comes from the record, not the filename: space_invaders
                # has an underscore and a filename split drops half of it.
                try:
                    r = json.load(open(p))["rows"][0]
                    g, v = r["game"], r.get("sps")
                except Exception:
                    continue
                if v:
                    sps[g], src[g] = float(v), j
        by = defaultdict(list)
        for g, v in sps.items():
            by[nodes.get((src[g], g), "unknown")].append((g, v))

        all24 = gm(list(sps.values()))
        print(f"\n== {row}   n={len(sps)}   geomean {all24:,.0f}"
              f"   paper {PAPER[row]:,.0f}")
        for n, v in sorted(by.items(), key=lambda kv: -st.fmean([x[1] for x in kv[1]])):
            mark = "  <- excluded by every re-run" if n == EXCLUDED_ON_RERUN else ""
            print(f"   {n:<16} n={len(v):2d}  mean {st.fmean([x[1] for x in v]):>10,.0f}{mark}")
        bad = [g for g, v in sps.items() if nodes.get((src[g], g)) == EXCLUDED_ON_RERUN]
        if bad:
            kept = gm([v for g, v in sps.items() if g not in bad])
            print(f"   without {EXCLUDED_ON_RERUN} (n={len(sps) - len(bad)}): {kept:,.0f}"
                  f"   -> {kept / 1e6:.2f}M, the paper's figure"
                  if abs(kept - PAPER[row]) < abs(all24 - PAPER[row]) else
                  f"   without {EXCLUDED_ON_RERUN} (n={len(sps) - len(bad)}): {kept:,.0f}")
            print(f"   affected games: {', '.join(sorted(bad))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
