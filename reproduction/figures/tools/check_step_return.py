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
from paper_ref import repo_root, resolve  # noqa: E402
RT = repo_root() / "src" / "playtrain" / "runtime"
NATIVE = repo_root() / "native"


def _parse(lines):
    end = next(i for i, l in enumerate(lines) if "\\label{tab:step-return}" in l)
    stop = next(i for i in range(end, len(lines)) if "\\end{tabular}" in lines[i])
    out = []
    for line in lines[end:stop]:
        t = re.sub(r"\s+", " ", line.strip())
        m = re.match(r"^(\S+) +& +(\S+) +& +(.+?) \\\\$", t)
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

    findings = []
    paper_gs = {"PLAYING", "WIN", "GAMEOVER"}
    if set(gs) - paper_gs:
        findings.append(f"gameState: the paper lists {sorted(paper_gs)} but the runtime"
                        f" defines {list(gs)} -- {sorted(set(gs) - paper_gs)} missing"
                        " (and it is a terminal state the validator checks)")
    missing_rows = [k for k in keys if f"info.{k}" not in fields]
    if missing_rows:
        findings.append(f"info keys returned but not in the table: {', '.join(missing_rows)}")
    print(f"    findings: {len(findings)}")
    for f in findings:
        print(f"      {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
