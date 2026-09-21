"""tab:envcost: all 87 cells against the committed per-game cost data.

Same source as fig:envcost -- outputs/percmd.json from job 44381429 -- so the
table and the figure cannot disagree. Three columns per game:

  cmds     sum of the per-command call counts
  draw %   draw_us / us_per_step, as a percentage
  steps/s  the measured single-core throughput

Variant rows are printed under the paper's names, so they are resolved through
data/variant_names.tsv the same way check_llm_cost.py does.

    python tools/check_envcost_table.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_ref import repo_root, resolve  # noqa: E402

D = repo_root() / "reproduction" / "figures" / "outputs"


def _parse(lines):
    end = next(i for i, l in enumerate(lines) if "\\label{tab:envcost}" in l)
    stop = next(i for i in range(end, len(lines)) if "\\end{tabular}" in lines[i])
    rows = {}
    for line in lines[end:stop]:
        t = re.sub(r"\s+", " ", line.strip()).replace("{,}", "")
        for m in re.finditer(r"\\texttt\{([A-Za-z0-9_.\\]+)\} & (\d+) & (\d+) & (\d+)", t):
            rows[m.group(1).replace("\\_", "_")] = [int(m.group(2)), int(m.group(3)),
                                                    int(m.group(4))]
    return rows


def alias():
    f = repo_root() / "reproduction" / "data" / "variant_names.tsv"
    out = {}
    for line in f.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = line.split("\t")
        if len(p) >= 2:
            out[p[0]] = p[1]          # paper name -> repo name
    return out


def main():
    if not (D / "percmd.json").exists():
        print("    skipped: run 'bash reproduction/figures/fetch_data.sh' first")
        return 0
    rows = {r["game"]: r for r in json.load(open(D / "percmd.json"))["rows"]}
    paper, src = resolve("tab:envcost", _parse)
    a = alias()
    print(f"    paper values from {src}; {len(paper)} games in the table,"
          f" {len(rows)} in percmd.json")

    bad = []
    for name, (cmds, pct, sps) in sorted(paper.items()):
        key = a.get(name, name)
        r = rows.get(key)
        if r is None:
            bad.append(f"{name}: no row in percmd.json (looked for {key!r})")
            continue
        got = [round(sum(r["per_cmd"].values())),
               round(r["draw_us"] / r["us_per_step"] * 100),
               round(r["sps"])]
        for g, w, what in zip(got, (cmds, pct, sps), ("cmds", "draw %", "steps/s")):
            if g != w:
                bad.append(f"{name} {what}: data {g}, paper {w}")
    print(f"    cells checked {3 * len(paper)}, mismatches {len(bad)}")
    for b in bad[:10]:
        print(f"      {b}")
    over = [n for n, v in paper.items() if v[1] > 100]
    print(f"    games with draw % over 100: {over or 'none'}"
          "   (fig:envcost's caption: maze is the one)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
