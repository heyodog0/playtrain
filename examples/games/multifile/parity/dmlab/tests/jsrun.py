"""Run the game's JS the way the bundle does: concatenate sources in manifest
order and evaluate as ONE script under node (craftax_classic/tests/jsrun.py
explains why eval would lie)."""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
COMMON = GAME.parents[1] / 'common'

# Dynamics only: no atlas, no renderer, no host glue that draws.
CORE = [COMMON / 'f32.js', COMMON / 'rng_pcg32.js', GAME / 'src' / '00_header.js',
        GAME / 'src' / '10_constants.js', None, GAME / 'src' / '20_state.js',
        GAME / 'src' / '30_level.js', GAME / 'src' / '40_pmove.js',
        GAME / 'src' / '50_tasks' / 'explore.js', GAME / 'src' / '50_tasks' / 'rooms.js',
        GAME / 'src' / '50_tasks' / 'psychlab.js',
        GAME / 'src' / '90_playtrain.js']


def have_node() -> bool:
    try:
        subprocess.run(['node', '--version'], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def run_core(level: str, snippet: str):
    parts = []
    for p in CORE:
        if p is None:
            p = GAME / 'src' / 'levels' / f'{level}.js'
        parts.append(f'// ---- {p.name} ----\n{p.read_text()}')
    parts.append('// ---- snippet ----\n' + snippet)
    with tempfile.NamedTemporaryFile('w', suffix='.cjs', delete=False) as fh:
        fh.write('\n'.join(parts))
        tmp = fh.name
    try:
        proc = subprocess.run(['node', tmp], capture_output=True, text=True)
        if proc.returncode != 0:
            raise AssertionError(f'node exited {proc.returncode}:\n{proc.stderr}')
        return json.loads(proc.stdout)
    finally:
        Path(tmp).unlink(missing_ok=True)
