"""tab:eval: all 48 published cells against the committed eval JSON.

The paper's table (main.tex L1483) gives a random and a greedy return for each of
the 24 games. They come from results/eval_iddp_suite.json.

The hazard this guards: results/eval_final_agents_b256.json sits in the same
directory with the same shape and the same random returns, but its greedy
returns are from weaker checkpoints. Pointing the table at it gives a table that
looks right -- every R column still matches -- while most G values are too low.
Pass --file to see that for yourself.

    python tools/check_eval.py [--file results/eval_iddp_suite.json]
"""
from __future__ import annotations

import argparse
import json
import re
import statistics as st
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from paper_ref import resolve  # noqa: E402
ROW = re.compile(
    r"^([a-z_\\]+) & (-?[\d.]+) & (-?[\d.]+) & ([a-z_\\]+) & (-?[\d.]+) & (-?[\d.]+) \\\\$")


def _parse(lines):
    """The 24 (game, R, IMPALA, PPO) rows of the tab:eval tabular.

    The table was `game & R & G` until the 2026-09 revision and is now
    `game & R & IMPALA & PPO`. paper_ref.resolve() fails loudly if this matches
    nothing, so a further reshape cannot pass vacuously again.
    """
    end = next(i for i, l in enumerate(lines) if "\\label{tab:eval}" in l)
    stop = next(i for i in range(end, len(lines)) if "\\end{tabular}" in lines[i])
    num = r"-?[\d.]+"
    row = re.compile(rf"^([a-z_\\]+) & ({num}) & ({num}) & ({num}) & "
                     rf"([a-z_\\]+) & ({num}) & ({num}) & ({num}) \\\\$")
    out = {}
    for line in lines[end:stop]:
        m = row.match(re.sub(r"\s+", " ", line.strip()))
        if not m:
            continue
        g = m.groups()
        out[g[0].replace("\\_", "_")] = [float(g[1]), float(g[2]), float(g[3])]
        out[g[4].replace("\\_", "_")] = [float(g[5]), float(g[6]), float(g[7])]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=HERE.parent / "results" / "eval_iddp_suite.json")
    args = ap.parse_args()
    RES = Path(args.file).parent
    paper, src = resolve("tab:eval", _parse)
    print(f"    parsed {len(paper)} games from {src}")

    # R comes from the evaluator's own random arm; the two G columns are the
    # 3-seed means, exactly as tools/eval_suite3.py computes them.
    I = [json.load(open(RES / f"eval_s3_icnn_s{i}.json")) for i in range(3)]
    P = [json.load(open(RES / f"eval_p3_icnn_s{i}.json")) for i in range(3)]
    bad = []
    for g, (pr, pi, pp) in sorted(paper.items()):
        if g not in I[0]:
            bad.append(f"{g}: absent from the eval data")
            continue
        got = [I[0][g]["random_return"],
               st.fmean([s[g]["greedy_return"] for s in I]),
               st.fmean([s[g]["greedy_return"] for s in P])]
        for v, w, what in zip(got, (pr, pi, pp), ("R", "IMPALA", "PPO")):
            if abs(round(v, 1) - w) > 0.05:
                bad.append(f"{g} {what}: data {v:.1f}, paper {w}")
    print(f"    cells checked {3 * len(paper)}, mismatches {len(bad)}")
    for b in bad[:12]:
        print(f"      {b}")
    print(f"    3 seeds per trainer, 8 held-out level seeds; R identical across all six runs:"
          f" {all(abs(s[g]['random_return'] - I[0][g]['random_return']) < 1e-6 for g in paper for s in I + P)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
