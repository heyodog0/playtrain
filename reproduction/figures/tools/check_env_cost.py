"""fig:envcost: the numbers the appendix prose quotes, against the committed data.

Reads outputs/percmd.json (per-primitive prices and per-game binding counts) and
outputs/logic_probes.json (the logic-operation fits). Both come from job
44381429; see PROVENANCE.md.

Guard: percmd.json must be the adv, dirty-skip-OFF variant, which is what the
caption describes. percmd_preadv.json prices background 3.3x higher and would
redraw the whole figure plausibly but wrongly.

    python tools/check_env_cost.py
"""
from __future__ import annotations

import json
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "outputs"


def main():
    if not (D / "percmd.json").exists():
        print("    skipped: run 'bash reproduction/figures/fetch_data.sh' first")
        return 0
    pc = json.load(open(D / "percmd.json"))
    price, rows = pc["price_ns"], pc["rows"]

    nodirty = json.load(open(D / "percmd_adv_nodirty.json"))
    print(f"    variant check: percmd.json == percmd_adv_nodirty.json:"
          f" {pc == nodirty}   (caption: dirty-rectangle skipping off)")
    pre = json.load(open(D / "percmd_preadv.json"))
    print(f"      for contrast, percmd_preadv.json prices background at"
          f" {pre['price_ns']['background']:.0f} ns vs {price['background']:.0f}")

    priced = {k: v for k, v in price.items() if v > 0}
    dear = max(priced, key=priced.get)
    cheap = min(priced, key=priced.get)
    print(f"    most expensive primitive: {dear} at {priced[dear]:.0f} ns"
          "   (paper: background, 390 ns per call)")
    print(f"    cheapest primitive:       {cheap} at {priced[cheap]:.0f} ns"
          "   (paper: fill, only sets colour state)")
    print(f"    shapes priced per polygon at {pc['shape_unit_ns']:.0f} ns;"
          f" beginShape/vertex/endShape are 0   (caption: priced per polygon)")

    by_sps = sorted(rows, key=lambda r: -r["sps"])
    top = by_sps[0]
    ncmd = lambda r: sum(r["per_cmd"].values())
    print(f"    fastest game: {top['game']} at {top['sps']:,.0f} sps,"
          f" {ncmd(top):.0f} p5 commands/frame   (paper: pong, 11 commands)")
    fb = next(r for r in rows if r["game"] == "flappy_bird")
    print(f"    flappy_bird {ncmd(fb):.1f} commands/frame at {fb['sps']:,.0f} sps"
          f" -- fewer commands than {top['game']} yet slower:"
          f" {ncmd(fb) < ncmd(top) and fb['sps'] < top['sps']}   (paper: logic overturns it)")

    over = [r["game"] for r in rows if r["draw_us"] > r["us_per_step"]]
    print(f"    games whose priced operations exceed their step time: {over}"
          "   (caption: maze is the one)")
    mi = next(r for r in rows if r["game"] == "miner")
    print(f"    miner: {mi['draw_us']/mi['us_per_step']*100:.0f}% of the step drawing,"
          f" {ncmd(mi):.0f} commands   (main.tex L778: 75% on 787 commands)")

    fits = json.load(open(D / "logic_probes.json"))["fits"]
    print(f"    logic probes fitted: {len(fits)} -"
          f" {', '.join(v['label'] for v in fits.values())}")
    print("      (paper lists four: collision checks, allocations, entity updates,"
          " typed-array writes -- 'tile-grid cell scan' is not named)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
