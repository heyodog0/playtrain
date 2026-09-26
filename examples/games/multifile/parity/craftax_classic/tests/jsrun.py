"""Run JS from the gates the way the bundle runs it.

`tools/bundle_multifile.py` produces one flat script by concatenating sources,
and QuickJS, the AOT tier, node and the browser all evaluate that as a single
global script. So the gates must do the same: concatenate the files and run
the result as one file.

Do NOT switch this to `node -e` with eval. Under eval, a top-level `const` or
`class` is scoped to the eval and later snippets cannot see it, while a
`function` leaks to the global object — so half the modules would appear to
work and half would not, for reasons that have nothing to do with the game.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
COMMON = GAME.parents[1] / "common"

# The shared modules, in the order a manifest lists them.
COMMON_SOURCES = ["f32.js", "rng_pcg32.js", "u64bits.js", "parity.js"]


def have_node() -> bool:
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def run_js(snippet: str, sources: list[str] | None = None) -> str:
    """Concatenate the common sources plus `snippet`, run it, return stdout."""
    names = COMMON_SOURCES if sources is None else sources
    parts = []
    for name in names:
        path = (COMMON / name).resolve()
        parts.append(f"// ---- {name} ----\n{path.read_text()}")
    parts.append("// ---- test snippet ----\n" + snippet)
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(["node", temp], capture_output=True, text=True)
        if proc.returncode != 0:
            raise AssertionError(f"node exited {proc.returncode}:\n{proc.stderr}")
        return proc.stdout
    finally:
        Path(temp).unlink(missing_ok=True)


def run_js_json(snippet: str, sources: list[str] | None = None):
    return json.loads(run_js(snippet, sources))
