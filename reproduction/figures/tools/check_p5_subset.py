"""tab:p5-subset: the published command list against the host's binding table.

The caption claims "40 p5.js commands the C++ later binds to". Two things are
checkable: how many commands the table actually lists, and what the QuickJS host
actually binds (the `BINDINGS[]` table in native/qjs/qjs_host.cpp, registered in
a loop with JS_NewCFunction).

Input state is a third category the caption's wording does not distinguish:
mouseX, mouseY, mouseIsPressed and gamepadAxes are globals the host WRITES each
step via JS_SetPropertyStr, and keyPressed is a callback the GAME defines and the
host calls. Only keyIsDown in that row is a bound C function.

    python tools/check_p5_subset.py
"""
from __future__ import annotations

import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_ref import repo_root, resolve  # noqa: E402
HOST = repo_root() / "native" / "qjs" / "qjs_host.cpp"
CAPTION_CLAIM = 40
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
    print(f"    table lists {len(listed)} commands   (caption claims {CAPTION_CLAIM})")
    print(f"    host BINDINGS[] registers {len(bound)} C functions")

    not_bound = sorted(set(listed) - bound)
    print(f"    listed but not a bound C function ({len(not_bound)}):"
          f" {', '.join(not_bound)}")
    print(f"      of those, host-written globals or game callbacks:"
          f" {', '.join(sorted(set(not_bound) & HOST_GLOBALS))}")
    extra = sorted(bound - set(listed))
    print(f"    bound but not listed ({len(extra)})")
    print(f"      the caption names three as no-ops: {', '.join(sorted(NAMED_NOOPS))}"
          f" -- all bound: {NAMED_NOOPS <= bound}")
    print(f"      {len(listed)} listed + those 3 = {len(listed) + 3}"
          f", which is where the caption's {CAPTION_CLAIM} most likely comes from")
    threed = sorted(c for c in extra if re.match(
        r"^(box|sphere|cone|cylinder|ellipsoid|rotate[XYZ]|voxel|.*Light|.*Material|shininess|noLights)", c))
    print(f"      {len(threed)} of the unlisted are 3D/voxel commands: {', '.join(threed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
