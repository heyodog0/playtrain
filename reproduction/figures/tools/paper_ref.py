"""Locate the paper source, or fall back to a committed snapshot of its values.

Several checkers compare the repo against what `main.tex` prints, which is the
right comparison to make -- but `main.tex` lives in a separate repo that a reader
cloning this one does not have. Without a fallback those steps fail in a fresh
clone, which is exactly what the first fresh-clone run showed.

So: prefer the live paper when it is checked out (the authors' case, and the only
way to catch the paper changing), otherwise read
`reproduction/expected/paper_values.json`, a snapshot generated from it by
`tools/snapshot_paper_values.py`.

    from paper_ref import repo_root, tex_lines, resolve
"""
from __future__ import annotations

import json
import os
from pathlib import Path

PAPER_DIR = "ICLR-PlayTrain-Fast-LLM-VGEs"


def repo_root() -> Path:
    """The playtrain repo root, found by marker rather than by depth."""
    for p in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        if (p / "reproduction").is_dir() and (
                (p / "pyproject.toml").is_file() or (p / "framework" / "pyproject.toml").is_file()):
            return p
    return Path(__file__).resolve().parents[3]


def src_root() -> Path:
    """Where the framework source lives: the repo root, or framework/ in the
    supplementary layout (games/ reproduction/ framework/)."""
    root = repo_root()
    return root / "framework" if (root / "framework" / "pyproject.toml").is_file() else root


def tex_path() -> Path | None:
    """main.tex if it can be found, else None. $PLAYTRAIN_PAPER_TEX overrides."""
    env = os.environ.get("PLAYTRAIN_PAPER_TEX")
    if env and Path(env).is_file():
        return Path(env)
    root = repo_root()
    for cand in (root.parent / PAPER_DIR / "main.tex",      # sibling checkout
                 root / PAPER_DIR / "main.tex",             # nested checkout
                 root / "paper" / "main.tex"):
        if cand.is_file():
            return cand
    return None


def tex_lines() -> list[str] | None:
    p = tex_path()
    return p.read_text().splitlines() if p else None


def snapshot() -> dict:
    f = repo_root() / "reproduction" / "expected" / "paper_values.json"
    return json.load(open(f)) if f.is_file() else {}


def resolve(key: str, parse):
    """parse(lines) against the live paper, or the snapshot's `key` without it.

    Returns (value, source) where source is "main.tex" or "snapshot".
    """
    lines = tex_lines()
    if lines is not None:
        got = parse(lines)
        # A parser that matches nothing must fail, not pass vacuously. When the
        # paper restructures a table the regex stops matching, and without this
        # the checker reports "0 cells, 0 mismatches" and counts as ok -- which
        # is how tab:eval went unverified after an Overleaf sync.
        if not got:
            raise SystemExit(
                f"{key}: parsed 0 rows out of main.tex. The table's shape has "
                f"probably changed; update the parser in the checker for {key} "
                f"and regenerate reproduction/expected/paper_values.json.")
        return got, "main.tex"
    snap = snapshot()
    if key not in snap:
        raise SystemExit(
            f"no paper source and no snapshot for {key!r}. Either check out the "
            f"paper repo beside this one, set $PLAYTRAIN_PAPER_TEX, or "
            f"regenerate reproduction/expected/paper_values.json.")
    return snap[key], "snapshot"
