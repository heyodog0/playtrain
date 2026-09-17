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
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEX = HERE.parents[3] / "ICLR-PlayTrain-Fast-LLM-VGEs" / "main.tex"
ROW = re.compile(
    r"^([a-z_\\]+) & (-?[\d.]+) & (-?[\d.]+) & ([a-z_\\]+) & (-?[\d.]+) & (-?[\d.]+) \\\\$")


def published():
    """The 24 (game, R, G) triples, parsed out of the tab:eval tabular."""
    lines = TEX.read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if "\\label{tab:eval}" in l)
    out = {}
    for line in lines[start:start + 40]:
        m = ROW.match(line.strip())
        if not m:
            continue
        g1, r1, v1, g2, r2, v2 = m.groups()
        out[g1.replace("\\_", "_")] = (float(r1), float(v1))
        out[g2.replace("\\_", "_")] = (float(r2), float(v2))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=HERE.parent / "results" / "eval_iddp_suite.json")
    args = ap.parse_args()
    data = json.load(open(args.file))
    paper = published()
    print(f"    parsed {len(paper)} games from main.tex, {len(data)} in {Path(args.file).name}")

    bad = []
    for g, (pr, pg) in sorted(paper.items()):
        if g not in data:
            bad.append(f"{g}: absent from the data")
            continue
        dr, dg = data[g]["random_return"], data[g]["greedy_return"]
        for got, want, what in ((dr, pr, "R"), (dg, pg, "G")):
            if abs(round(got, 1) - want) > 0.05:
                bad.append(f"{g} {what}: data {got:.1f} vs paper {want}")
    print(f"    cells checked {2 * len(paper)}, mismatches {len(bad)}")
    for b in bad[:12]:
        print(f"      {b}")
    if len(bad) > 12:
        print(f"      ... and {len(bad) - 12} more")

    runs = {d["run"] for d in data.values()}
    print(f"    checkpoints from {len(runs)} run dirs, e.g. {sorted(runs)[0]}")
    print(f"    greedy beats random on {sum(1 for g in paper if data[g]['greedy_return'] > data[g]['random_return'])}"
          f" of {len(paper)} games")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
