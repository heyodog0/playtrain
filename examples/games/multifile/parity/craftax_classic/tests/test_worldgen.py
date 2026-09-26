"""G1: generate_world, for 1000 seeds, byte for byte.

The world is the first thing the RNG produces and everything else is
conditioned on it, so a divergence here makes every later gate fail with no
useful message. It is also the only float-heavy code in the game: about
twenty float32 operations per cell per layer, plus 400 cosf/sinf calls, so
this is the real test of the Math.fround discipline and of binding the C's
transcendentals to V8's ieee754.

Comparison is the full canonical dump, which for a fresh world is the map,
the player block, the intrinsics, the cleared mobs and the RNG state. The
RNG state matters as much as the map: two implementations can agree on every
tile and still have consumed a different number of draws, and that would only
surface a thousand steps into G2.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import DRIVER_ABSENT_REASON, have_driver, layout
from ccref import run as crun
from jsrun import COMMON, COMMON_SOURCES, have_node

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

N_SEEDS = 1000
SRC = Path(__file__).resolve().parent.parent / "src"
SOURCES = [COMMON / n for n in COMMON_SOURCES] + [
    SRC / "10_constants.js", SRC / "20_state.js", SRC / "30_worldgen.js"
]

EMIT_JS = """
// Write <n> consecutive worlds' canonical dumps to stdout as raw bytes.
const first = Number(process.argv[2]);
const n = Number(process.argv[3]);
const chunks = [];
for (let seed = first; seed < first + n; seed++) {
  const st = createState();
  clearState(st);
  pcgSeed(st.pcg, seed);
  generateWorld(st);
  chunks.push(Buffer.from(getParityState(st, 0)));
}
process.stdout.write(Buffer.concat(chunks));
"""


def js_worlds(first: int, n: int) -> bytes:
    parts = [p.read_text() for p in SOURCES] + [EMIT_JS]
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(
            ["node", temp, str(first), str(n)], capture_output=True
        )
        assert proc.returncode == 0, proc.stderr.decode()
        return proc.stdout
    finally:
        Path(temp).unlink(missing_ok=True)


def field_at(offset: int, rows):
    """Which canonical field covers this byte offset."""
    for off, size, typ, count, name in rows:
        if off <= offset < off + size:
            return name, offset - off, typ, count
    return "<past end>", offset, "?", 0


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_a_thousand_worlds_match_the_c():
    rows, total = layout()
    blob = js_worlds(0, N_SEEDS)
    assert len(blob) == N_SEEDS * total, f"JS produced {len(blob)} bytes for {N_SEEDS} worlds"

    for seed in range(N_SEEDS):
        js = blob[seed * total : (seed + 1) * total]
        c = crun("world", str(seed))
        if js != c:
            for i in range(total):
                if js[i] != c[i]:
                    name, within, typ, count = field_at(i, rows)
                    extra = ""
                    if name == "map_packed":
                        extra = f" (map cell r={within // 64}, c={within % 64})"
                    pytest.fail(
                        f"seed {seed}: first difference at canonical byte {i}, "
                        f"field {name}[{within}]{extra} ({typ} x{count}): "
                        f"JS 0x{js[i]:02x} vs C 0x{c[i]:02x}"
                    )


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_rng_is_left_in_the_same_place():
    """Called out separately because it is the failure that hides: the map
    can match while the two sides have drawn a different number of values,
    and that only shows up much later in G2."""
    rows, total = layout()
    off, size = next((r[0], r[1]) for r in rows if r[4] == "pcg")
    blob = js_worlds(0, 200)
    for seed in range(200):
        js = blob[seed * total : (seed + 1) * total]
        c = crun("world", str(seed))
        assert js[off : off + size] == c[off : off + size], (
            f"seed {seed}: PCG state differs after worldgen "
            f"(JS {js[off:off + size].hex()} vs C {c[off:off + size].hex()})"
        )


def test_worldgen_rounds_after_every_float_op():
    """Source-level: in worldgen an unrounded intermediate is a different
    world, not a last-bit difference, and it can hide for hundreds of seeds.
    Every line doing float arithmetic must be wrapped."""
    import re

    src = (SRC / "30_worldgen.js").read_text()
    code = "\n".join(line.split("//")[0] for line in src.splitlines())
    offenders = []
    for lineno, line in enumerate(code.splitlines(), start=1):
        if "const " not in line and "=" not in line:
            continue
        # float-producing operators, ignoring array indexing and integer work
        rhs = line.split("=", 1)[1] if "=" in line else ""
        if re.search(r"[\d.]\s*[*/]\s*[A-Za-z0-9_.]", rhs) and "F(" not in rhs:
            if "MAP_SIZE" in rhs or "4096" in rhs or "GRID" in rhs or "| 0" in rhs:
                continue      # integer index arithmetic
            offenders.append(f"{lineno}: {line.strip()}")
    assert not offenders, "unrounded float arithmetic:\n" + "\n".join(offenders)
