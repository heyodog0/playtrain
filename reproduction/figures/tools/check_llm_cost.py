"""tab:llm-cost: the whole table, offline, against the committed JSON and logs.

The generator (playtrain.gen.count_tokens) needs GEMINI_API_KEY because it
re-tokenizes through the API. It also writes reproduction/data/llm_cost.json and
reproduction/data/tab_llm_cost.tex beside the counts, so the table is checkable
without a second API call -- which is what this does.

Checked here: every cell of the six artifact rows and the Total row against the
committed JSON, the cost column recomputed from the published rates, the call
count against the generation logs actually present on disk, and the paper's
printed totals against the data's own.

    python tools/check_llm_cost.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

R = Path(__file__).resolve().parents[2]   # reproduction/
LOGS = R / "data" / "generation-logs"
TEX = R.parents[1] / "ICLR-PlayTrain-Fast-LLM-VGEs" / "main.tex"
# LoC and SPS are hardcoded in count_tokens.EXTRA, not derived from any
# committed measurement -- see PROVENANCE.md and STATE.md flag 21.
UNSOURCED = ("LoC delta", "SPS")


def repo_to_paper():
    """Repo artifact name -> the name the paper prints (data/variant_names.tsv)."""
    m = {}
    for line in (R / "data" / "variant_names.tsv").read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split("\t")
        if len(f) >= 2:
            m[f[1]] = f[0]
    return m


def paper_rows():
    """The tab:llm-cost tabular as main.tex prints it."""
    lines = TEX.read_text().splitlines()
    end = next(i for i, l in enumerate(lines) if "\\label{tab:llm-cost}" in l)
    start = next(i for i in range(end, 0, -1) if "\\begin{table}" in lines[i])
    out = {}
    for line in lines[start:end]:
        t = re.sub(r"\s+", " ", line.strip()).replace("{,}", ",")
        m = re.match(r"^([A-Za-z_\\.0-9]+) & (\d+) & ([\d,]+) / ([\d,]+) & "
                     r"([\d.]+) min & \\\$([\d.]+) & (.+?) & (.+?) \\\\$", t)
        if m:
            n = lambda x: int(x.replace(",", ""))
            out[m.group(1).replace("\\_", "_").replace("\\", "")] = (
                int(m.group(2)), n(m.group(3)), n(m.group(4)),
                float(m.group(5)), float(m.group(6)))
        elif t.startswith("Total &"):
            m2 = re.match(r"^Total & (\d+) & ([\d,]+) / ([\d,]+) & ([\d.]+) min & \\\$([\d.]+)", t)
            if m2:
                n = lambda x: int(x.replace(",", ""))
                out["Total"] = (int(m2.group(1)), n(m2.group(2)), n(m2.group(3)),
                                float(m2.group(4)), float(m2.group(5)))
    return out


def main():
    d = json.load(open(R / "data" / "llm_cost.json"))
    rate_in, rate_out = d["rate_in"], d["rate_out"]
    paper = paper_rows()
    alias = repo_to_paper()
    print(f"    parsed {len(paper)} rows from the tab:llm-cost tabular"
          f" ({len(d['rows'])} artifacts + Total in the data)")
    print(f"    rates ${rate_in:g} / ${rate_out:g} per 1M tokens"
          "   (caption: Gemini 3.1 Pro, $2 / $12)")

    # `bad` is internal inconsistency -- the repo contradicting itself, which is
    # a failure. A paper-vs-data difference is a finding, reported but not a
    # failure, the same way the other checkers treat known MISMATCHes.
    bad, paper_diff, logs_missing = [], [], []
    for r in d["rows"]:
        for f in r["files"]:
            if not (LOGS / (f + ".gz")).exists() and not (LOGS / f).exists():
                logs_missing.append(f)
        cost = round(r["tokens_in"] * rate_in / 1e6 + r["tokens_out"] * rate_out / 1e6, 2)
        if cost != r["cost_usd"]:
            bad.append(f"{r['artifact']} cost: rates give {cost:.2f}, JSON says {r['cost_usd']:.2f}")
        if len(r["files"]) != r["calls"]:
            bad.append(f"{r['artifact']} calls: {r['calls']} claimed, {len(r['files'])} logs listed")
    print(f"    generation logs on disk for all {sum(len(r['files']) for r in d['rows'])}"
          f" logged calls: {not logs_missing}"
          "   (each row's Calls equals its number of log files)")

    sums = {k: sum(r[k] for r in d["rows"]) for k in ("calls", "tokens_in", "tokens_out")}
    sums["minutes"] = round(sum(r["minutes"] for r in d["rows"]), 1)
    tot = d["total"]
    for k in ("calls", "tokens_in", "tokens_out", "minutes"):
        if abs(sums[k] - tot[k]) > 1e-9:
            bad.append(f"Total {k}: rows sum to {sums[k]}, JSON total says {tot[k]}")

    print("\n    artifact             calls  tokens in / out     min    cost   vs paper")
    for r in d["rows"]:
        name = alias.get(r["artifact"], r["artifact"])
        p = paper.get(name)
        note = f"absent from the paper (looked for {name!r})" if p is None else (
            ("match" + ("" if name == r["artifact"] else f", as {name}"))
            if p[:5] == (r["calls"], r["tokens_in"], r["tokens_out"],
                         r["minutes"], r["cost_usd"]) else f"DIFFERS {p}")
        print(f"    {r['artifact']:<20} {r['calls']:5d}  {r['tokens_in']:7,} /{r['tokens_out']:7,}"
              f"  {r['minutes']:5.1f}  ${r['cost_usd']:.2f}   {note}")
    pt = paper.get("Total")
    print(f"    {'Total (data)':<20} {tot['calls']:5d}  {tot['tokens_in']:7,} /{tot['tokens_out']:7,}"
          f"  {tot['minutes']:5.1f}  ${tot['cost_usd']:.2f}")
    if pt:
        print(f"    {'Total (paper)':<20} {pt[0]:5d}  {pt[1]:7,} /{pt[2]:7,}"
              f"  {pt[3]:5.1f}  ${pt[4]:.2f}")
        for i, k in enumerate(("calls", "tokens_in", "tokens_out", "minutes", "cost_usd")):
            if abs(pt[i] - tot[k]) > 1e-9:
                paper_diff.append(f"paper Total {k}: {pt[i]} vs data {tot[k]}"
                                  " (the rows sum to the data's figure)")

    print(f"\n    unsourced columns: {', '.join(UNSOURCED)}"
          " -- hardcoded in count_tokens.EXTRA, no committed measurement")
    print(f"    internal inconsistencies: {len(bad)}")
    for b in bad:
        print(f"      {b}")
    print(f"    paper-vs-data differences: {len(paper_diff)}")
    for b in paper_diff:
        print(f"      {b}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
