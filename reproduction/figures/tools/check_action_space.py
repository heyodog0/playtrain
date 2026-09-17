"""tab:action-space: the published Discrete(8) table against the shipped spec.

The canonical spec is playtrain/runtime/action_spaces.json, which the Python
runtime, the Node runtime and the study-harness builder all read. This parses
the eight rows out of the tab:action-space tabular in main.tex and checks each
against that file: index, name, keycodes and delivery.

Delivery in the paper maps onto the spec's two fields: `held` keys are down for
every frame of the step, `press` fires the game's keyPressed() handler once
before the first frame and is down for that frame. So "held" means held is
non-empty and press is null, "press" means the reverse, and "held + press"
means both.

    python tools/check_action_space.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
TEX = ROOT / "ICLR-PlayTrain-Fast-LLM-VGEs" / "main.tex"
SPEC = ROOT / "playtrain" / "runtime" / "action_spaces.json"


def paper_rows():
    lines = TEX.read_text().splitlines()
    end = next(i for i, l in enumerate(lines) if "\\label{tab:action-space}" in l)
    stop = next(i for i in range(end, len(lines)) if "\\end{tabular}" in lines[i])
    rows = []
    for line in lines[end:stop]:
        t = re.sub(r"\s+", " ", line.strip())
        m = re.match(r"^(\d+) & (\S+) & (.+?) & (.+?) \\\\$", t)
        if m:
            keys = m.group(3).strip()
            rows.append((int(m.group(1)), m.group(2),
                         [] if keys == "---" else [int(x) for x in keys.split(",")],
                         m.group(4).strip()))
    return rows


def delivery(entry):
    held, press = entry.get("held") or [], entry.get("press")
    if held and press is not None:
        return "held + press"
    if press is not None:
        return "press"
    if held:
        return "held"
    return "---"


def main():
    spec = json.load(open(SPEC))["default8"]
    rows = paper_rows()
    print(f"    parsed {len(rows)} rows from the tab:action-space tabular"
          f"; the spec's default8 has {len(spec)} actions")
    bad = []
    for idx, name, keys, deliv in rows:
        if idx >= len(spec):
            bad.append(f"index {idx} is past the end of the spec")
            continue
        e = spec[idx]
        want_keys = list(e.get("held") or [])
        if e.get("press") is not None:
            want_keys.append(e["press"])
        if keys != want_keys:
            bad.append(f"{name}: paper keycodes {keys}, spec {want_keys}")
        if deliv != delivery(e):
            bad.append(f"{name}: paper delivery {deliv!r}, spec implies {delivery(e)!r}")
        if name.replace("+", "_") != e["name"]:
            bad.append(f"index {idx}: paper name {name!r}, spec {e['name']!r}"
                       " (underscore vs plus is cosmetic)")
        print(f"    {idx}  {name:<8} keys {str(keys):<10} {deliv:<12}"
              f" spec: held={e.get('held')} press={e.get('press')}")
    print(f"    mismatches: {len(bad)}")
    for b in bad:
        print(f"      {b}")
    named = [k for k in json.load(open(SPEC)) if not k.startswith("//")]
    print(f"    action spaces shipped in the file: {', '.join(named)}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
