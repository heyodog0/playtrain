"""tab:step-return: the published step contract against the runtime source.

Everything in the table is fixed by playtrain/src/playtrain/runtime/env.py and
the native hosts, so this checks the table's claims against those rather than
against any measurement:

  observation dtype/shape   env.py's observation_space
  reward = score delta      native/*/qjs*host*.cpp: `reward = score - lastScore`
  truncated default 2000    env.py's DEFAULT_MAX_STEPS
  gameState values          env.py's _GS_NAMES, validate.py's TERMINAL_STATES
  the info keys             env.py's _build_step_message

    python tools/check_step_return.py
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_ref import src_root, resolve  # noqa: E402
RT = src_root() / "src" / "playtrain" / "runtime"
NATIVE = src_root() / "native"


def _parse(lines):
    end = next(i for i, l in enumerate(lines) if "\\label{tab:step-return}" in l)
    stop = next(i for i in range(end, len(lines)) if "\\end{tabular}" in lines[i])
    out = []
    for line in lines[end:stop]:
        t = re.sub(r"\s+", " ", line.strip())
        m = re.match(r"^(\S+) +& +(\S+) +& +(.+?) ?\\\\$", t)   # the trailing space is optional
        if m and m.group(1) not in ("Field", "\\toprule", "\\midrule"):
            name = m.group(1).replace("\\texttt{", "").replace("}", "").replace("\\_", "_")
            out.append(name)
    return out


def main():
    env = (RT / "env.py").read_text()
    fields, src = resolve("tab:step-return", _parse)
    print(f"    paper ({src}) lists {len(fields)} fields: {', '.join(fields)}")

    dmax = int(re.search(r"DEFAULT_MAX_STEPS = (\d+)", env).group(1))
    print(f"    DEFAULT_MAX_STEPS = {dmax}   (paper: truncated at max_steps, default 2000)")

    obs = re.search(r"low=0,\s*high=255,\s*shape=\((\w+), \1, self\._channels\),\s*dtype=np\.(\w+)", env)
    size = int(re.search(r"obs_size: int = (\d+)", env).group(1))
    print(f"    observation_space: Box(0, 255, ({size}, {size}, channels), {obs.group(2) if obs else '?'})"
          "   (paper: uint8[64,64,3])")

    delta = [p.name for p in NATIVE.rglob("*.cpp")
             if "reward = score - lastScore" in p.read_text()]
    print(f"    `reward = score - lastScore` in {len(delta)} native hosts:"
          f" {', '.join(sorted(delta))}   (paper: change in the game's score)")

    gs = ast.literal_eval(re.search(r"_GS_NAMES = (\([^)]*\))", env).group(1))
    terminal = re.search(r"TERMINAL_STATES = \{([^}]*)\}", (RT / "validate.py").read_text()).group(1)
    print(f"    _GS_NAMES = {gs}")
    print(f"    validate.py TERMINAL_STATES = {{{terminal}}}")

    info = re.search(r'"info": \{(.*?)\n            \}', env, re.S).group(1)
    keys = re.findall(r'"(\w+)":', info)
    print(f"    _build_step_message info keys: {', '.join(keys)}")

    bad = []
    paper_gs = {"PLAYING", "WIN", "GAMEOVER", "EXIT"}      # the info.gameState row as printed
    ok_gs = set(gs) == paper_gs
    print(f"    gameState values: runtime {sorted(gs)}   paper {sorted(paper_gs)}   {'match' if ok_gs else 'DIFFERS'}")
    if not ok_gs:
        bad.append("gameState")
    listed = [f.split(".", 1)[1] for f in fields if f.startswith("info.")]
    absent = [k for k in listed if k not in keys]
    print(f"    info fields the table lists, all returned by the runtime: {'yes' if not absent else 'NO, missing ' + str(absent)}")
    bad += absent
    for cond, what in ((dmax == 2000, "max_steps"), (size == 64 and obs and obs.group(2) == "uint8", "observation"),
                       (len(delta) > 0, "reward")):
        if not cond:
            bad.append(what)
    print(f"    mismatches: {len(bad)}")
    return 1 if bad else 0

if __name__ == "__main__":
    raise SystemExit(main())
