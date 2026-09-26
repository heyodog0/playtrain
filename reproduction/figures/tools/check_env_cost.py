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
        print("    skipped: its input under figures/outputs/ is missing")
        return 3
    pc = json.load(open(D / "percmd.json"))
    price, rows = pc["price_ns"], pc["rows"]

    nodirty = json.load(open(D / "percmd_adv_nodirty.json"))
    priced = {k: v for k, v in price.items() if v > 0}
    dear, cheap = max(priced, key=priced.get), min(priced, key=priced.get)
    ncmd = lambda r: sum(r["per_cmd"].values())
    top = max(rows, key=lambda r: r["sps"])
    fb = next(r for r in rows if r["game"] == "flappy_bird")
    over = [r["game"] for r in rows if r["draw_us"] > r["us_per_step"]]
    mi = next(r for r in rows if r["game"] == "miner")
    checks = [
        ("measured without dirty-rectangle skipping", pc == nodirty),
        (f"most expensive primitive: {dear}, {priced[dear]:.0f} ns (paper: background, 390 ns)",
         dear == "background" and round(priced[dear]) == 390),
        (f"cheapest primitive: {cheap}, {priced[cheap]:.0f} ns (paper: fill)", cheap == "fill"),
        (f"shapes priced per polygon ({pc['shape_unit_ns']:.0f} ns); beginShape/vertex/endShape free",
         all(price.get(k, 0) == 0 for k in ("beginShape", "vertex", "endShape"))),
        (f"fastest game: {top['game']}, {ncmd(top):.0f} commands/frame (paper: pong, 11)",
         top["game"] == "pong" and round(ncmd(top)) == 11),
        (f"flappy_bird: fewer commands than pong ({ncmd(fb):.1f}) yet slower", ncmd(fb) < ncmd(top) and fb["sps"] < top["sps"]),
        (f"only maze's priced operations exceed its step time ({over})", over == ["maze"]),
        (f"miner: {mi['draw_us']/mi['us_per_step']*100:.0f}% of the step on {ncmd(mi):.0f} commands (paper: 75% on 787)",
         round(mi["draw_us"] / mi["us_per_step"] * 100) == 75 and round(ncmd(mi)) == 787),
    ]
    for what, ok in checks:
        print(f"    {what:82s} {'match' if ok else 'DIFFERS'}")
    return 0 if all(ok for _, ok in checks) else 1

if __name__ == "__main__":
    raise SystemExit(main())
