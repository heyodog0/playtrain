"""Regenerate reproduction/data/paper_values.json from the live main.tex.

The checkers prefer the live paper and fall back to this snapshot, so a reader
without the paper repo still gets a paper-vs-data comparison. Run this whenever
main.tex changes a table these checkers parse.

    python tools/snapshot_paper_values.py
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_ref import repo_root, tex_lines, tex_path          # noqa: E402
import check_action_space, check_bench_scaling, check_eval     # noqa: E402
import check_llm_cost, check_p5_subset, check_step_return      # noqa: E402

PARSERS = {"tab:action-space": check_action_space._parse,
           "tab:bench-scaling": check_bench_scaling._parse,
           "tab:eval": check_eval._parse,
           "tab:llm-cost": check_llm_cost._parse,
           "tab:p5-subset": check_p5_subset._parse,
           "tab:step-return": check_step_return._parse}


def main():
    lines = tex_lines()
    if lines is None:
        raise SystemExit("no main.tex found; set $PLAYTRAIN_PAPER_TEX")
    out = {"//": (f"Snapshot of the values these checkers parse out of main.tex, "
                  f"taken {date.today().isoformat()} from {tex_path()}. "
                  f"Regenerate with tools/snapshot_paper_values.py. The checkers "
                  f"prefer the live paper when it is checked out.")}
    for key, parse in PARSERS.items():
        out[key] = parse(lines)
        print(f"    {key:<20} {len(out[key])} entries")
    f = repo_root() / "reproduction" / "data" / "paper_values.json"
    json.dump(out, open(f, "w"), indent=1, sort_keys=True)
    print(f"    wrote {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
