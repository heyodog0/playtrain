"""tab:p5-subset: the published command list against the host's binding table.

Checks the caption's count (37) and that every listed command is provided by
the QuickJS host: a C function in `BINDINGS[]` (native/qjs/qjs_host.cpp), or,
for input state, a global the host writes each step (mouseX, mouseY,
mouseIsPressed, gamepadAxes) or the keyPressed callback it calls. Also checks
the no-ops the caption names are bound.

    python tools/check_p5_subset.py
"""
from __future__ import annotations

import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_ref import src_root, resolve  # noqa: E402
HOST = src_root() / "native" / "qjs" / "qjs_host.cpp"
CAPTION_CLAIM = 37
NAMED_NOOPS = {"noLoop", "frameRate", "cursor"}
HOST_GLOBALS = {"mouseX", "mouseY", "mouseIsPressed", "gamepadAxes", "keyPressed"}


def _parse(lines):
    end = next(i for i, l in enumerate(lines) if "\\label{tab:p5-subset}" in l)
    start = next(i for i in range(end, 0, -1) if "\\begin{tabular}" in lines[i])
    groups = {}
    for line in lines[start:end]:
        t = line.strip()
        if "&" not in t or t.startswith("Group") or t.startswith("\\"):
            continue
        g, cmds = t.split("&", 1)
        names = re.findall(r"\\texttt\{([A-Za-z0-9]+)\}", cmds)
        if names:
            groups[g.strip().replace("\\&", "&")] = names
    return groups


def bindings():
    src = HOST.read_text()
    i = src.index("BINDINGS[] = {")
    block = src[i:src.index("};", i)]
    return set(re.findall(r'"([a-zA-Z][a-zA-Z0-9]*)"', block))


def main():
    groups, src = resolve("tab:p5-subset", _parse)
    listed = [c for v in groups.values() for c in v]
    bound = bindings()
    for g, v in groups.items():
        print(f"    {g:<16} {len(v):2d}  {', '.join(v)}")
    print(f"    paper values from {src}")
    ok_n = len(listed) == CAPTION_CLAIM
    print(f"    table lists {len(listed)} commands   (caption: {CAPTION_CLAIM})   {'match' if ok_n else 'DIFFERS'}")
    missing = sorted(set(listed) - bound - HOST_GLOBALS)
    print(f"    every listed command provided by the host: {'yes' if not missing else 'NO, ' + ', '.join(missing)}")
    ok_noop = NAMED_NOOPS <= bound
    print(f"    caption's no-ops ({', '.join(sorted(NAMED_NOOPS))}) bound: {'yes' if ok_noop else 'NO'}")
    return 0 if ok_n and not missing and ok_noop else 1

if __name__ == "__main__":
    raise SystemExit(main())
