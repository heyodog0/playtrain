"""tab:bench-scaling: every cell, parsed from main.tex and recomputed.

The two throughput columns are panel A of fig:env_efficiency, so they come from
the same constants in plot_env_efficiency_bestonly.py (see PROVENANCE.md
§ fig:env_efficiency panel A -- they are constants, not committed data). This
script re-derives the ratio and both scaling-efficiency columns from those
throughputs and checks all of it against the published tabular.

Scaling efficiency, per the caption: throughput per thread relative to the
5-thread point, so 100% is linear.

    python tools/check_bench_scaling.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEX = HERE.parents[3] / "ICLR-PlayTrain-Fast-LLM-VGEs" / "main.tex"
sys.path.insert(0, str(HERE))

THREADS = [5, 10, 20, 30, 40, 60, 80]
# Panel A's constants, kept in step with plot_env_efficiency_bestonly.py.
PG_PT = [227433, 455799, 910956, 1368468, 1819564, 2741906, 3650005]
PG_EP = [177338, 354686, 584458, 777384, 931467, 1197708, 1412903]
AL_PT = [460983, 920486, 1846763, 2760813, 3692641, 5517172, 7300384]
AL_EP = [22806, 45600, 89270, 134145, 177666, 265505, 350959]

NUM = r"(?:\d{1,3}(?:\{,\}\d{3})*)"
ROW = re.compile(
    rf"^\s*(\d+) & \\?t?e?x?t?b?f?\{{?({NUM})\}}? & \\?t?e?x?t?b?f?\{{?({NUM})\}}? & "
    rf"\\?t?e?x?t?b?f?\{{?([\d.]+)\}}?\$?\\?times\$? & (\d+)\\% & "
    rf"\\?t?e?x?t?b?f?\{{?(\d+)\}}?\\% \\\\$")


def published():
    """The 14 data rows of the tabular, as the paper prints them."""
    lines = TEX.read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if "\\label{tab:bench-scaling}" in l)
    head = next(i for i in range(start, 0, -1) if "\\begin{table}" in lines[i])
    rows, suite = {}, None
    for line in lines[head:start]:
        t = line.strip()
        if "ProcGen, 16 shared games" in t:
            suite = "ProcGen"
            continue
        if "ALE, 8 shared games" in t:
            suite = "ALE"
            continue
        # Order matters: turn LaTeX digit separators into commas BEFORE
        # stripping \textbf{...} braces, or the brace strip eats the {,}.
        t = t.replace("{,}", ",").replace("$\\times$", "")
        t = re.sub(r"\\textbf\{([^}]*)\}", r"\1", t)
        t = re.sub(r"\s+", " ", t).strip()   # the tabular is space-aligned
        m = re.match(r"^(\d+) & ([\d,]+) & ([\d,]+) & ([\d.]+) & (\d+)\\% & (\d+)\\% \\\\$", t)
        if m and suite:
            n = lambda x: int(x.replace(",", ""))
            rows[(suite, int(m.group(1)))] = (n(m.group(2)), n(m.group(3)),
                                              float(m.group(4)), int(m.group(5)),
                                              int(m.group(6)))
    return rows


def eff(vals, threads):
    base = vals[0] / threads[0]
    return [round(100 * (v / t) / base) for v, t in zip(vals, threads)]


def main():
    paper = published()
    print(f"    parsed {len(paper)} rows from the tab:bench-scaling tabular   (expected 14)")
    bad = []
    for suite, pt, ep in (("ProcGen", PG_PT, PG_EP), ("ALE", AL_PT, AL_EP)):
        e_pt, e_ep = eff(pt, THREADS), eff(ep, THREADS)
        for i, t in enumerate(THREADS):
            key = (suite, t)
            if key not in paper:
                bad.append(f"{suite} {t}t: row absent from the tabular")
                continue
            ppt, pep, prat, ppe, ppee = paper[key]
            mine = [pt[i], ep[i], round(pt[i] / ep[i], 2), e_pt[i], e_ep[i]]
            for got, want, what in zip(mine, (ppt, pep, prat, ppe, ppee),
                                       ("PlayTrain", "EnvPool", "ratio", "PT eff", "EP eff")):
                if abs(got - want) > (0.005 if what == "ratio" else 0):
                    bad.append(f"{suite} {t}t {what}: computed {got} vs paper {want}")
    print(f"    cells checked {5 * len(paper)}, mismatches {len(bad)}")
    for b in bad:
        print(f"      {b}")
    print(f"    headline cells: ProcGen 80t {PG_PT[-1]/PG_EP[-1]:.2f}x,"
          f" ALE 80t {AL_PT[-1]/AL_EP[-1]:.2f}x   (paper: 2.58x, 20.80x)")
    print(f"    EnvPool ProcGen efficiency at 80t {eff(PG_EP, THREADS)[-1]}%,"
          f" ALE {eff(AL_EP, THREADS)[-1]}%   (paper: falls to 50%, holds 96%)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
