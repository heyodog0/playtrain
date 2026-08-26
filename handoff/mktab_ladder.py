"""Emit the five-arm trainer-ladder LaTeX table from ladder_<jobid>.json.

Anonymised: no hostnames, cluster names, or job IDs anywhere in the output,
comments included (ICLR double-blind). Provenance lives in the notes file
next to the JSON, not here.

usage: python mktab_ladder.py ladder.json [sf.json] > tab_ladder.tex
"""
from __future__ import annotations

import json
import math
import sys

ARM_LABEL = {
    "a1": r"per-actor CPU inference",
    "a2": r"central batched GPU inference",
    "a3": r"vectorized workers, single-buffered",
    "a4": r"vectorized workers, double-buffered",
    "b1": r"Sample Factory 2 (APPO)",
}
ORDER = ["a1", "a2", "a3", "a4", "b1"]


def fmt(v: float) -> str:
    if v <= 0:
        return "--"
    if v >= 1_000_000:
        return f"{v / 1e6:.2f}M"
    if v >= 10_000:
        return f"{v / 1e3:.0f}k"
    if v >= 1_000:
        return f"{v / 1e3:.1f}k"
    return f"{v:.0f}"


def main() -> None:
    data = json.loads(open(sys.argv[1]).read())
    arms = dict(data["arms"])
    if len(sys.argv) > 2:  # optional Sample Factory result file
        sf = json.loads(open(sys.argv[2]).read())
        arms["b1"] = sf["arms"]["b1"] if "arms" in sf else sf

    games = data["games"].split(",")
    rows = []
    prev_geo = None
    for arm in ORDER:
        if arm not in arms:
            continue
        rec = arms[arm]
        by_game = {r["game"]: r.get("sps", 0) for r in rec["rows"]}
        geo = rec.get("geomean_sps") or 0
        step = (geo / prev_geo) if (prev_geo and geo) else None
        rows.append((arm, by_game, geo, step))
        if geo:
            prev_geo = geo

    print(r"\begin{table}[H]")
    print(r"\caption{}")
    print(r"\label{tab:trainer-ladder}")
    print(r"\centering")
    print(r"\small")
    cols = "l" + "r" * len(games) + "rr"
    print(rf"\begin{{tabular}}{{@{{}}{cols}@{{}}}}")
    print(r"\toprule")
    head = " & ".join(g.replace("_", r"\_") for g in games)
    print(rf"Trainer rung & {head} & geo.\ mean & step \\")
    print(r"\midrule")
    for arm, by_game, geo, step in rows:
        cells = " & ".join(fmt(by_game.get(g, 0)) for g in games)
        stepcell = f"{step:.2f}$\\times$" if step else "--"
        print(rf"{ARM_LABEL[arm]} & {cells} & {fmt(geo)} & {stepcell} \\")
    print(r"\bottomrule")
    print(r"\end{tabular}")
    print(r"\end{table}")

    # sanity echo to stderr: A4/A3 per-game ratios for the caption cross-check
    if "a4_over_a3_per_game" in data:
        print(f"% A4/A3 per game: {data['a4_over_a3_per_game']}, "
              f"geomean {data.get('a4_over_a3_geomean')}", file=sys.stderr)


if __name__ == "__main__":
    main()
