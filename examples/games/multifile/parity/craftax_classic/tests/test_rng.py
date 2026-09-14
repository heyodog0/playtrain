"""G0: the JS RNG is the C RNG, bit for bit.

Everything downstream rides on this. The world, every mob move, every spawn
roll and the sapling chance all come out of one PCG stream, so a single
wrong bit here is a divergence in every later gate with no useful message.

PLAN 5 sets the size of the check: 10^6 outputs, rf as bits, ri for n in
{4, 8, 64}, and the seeding plus its eight warm-up draws over 1000 seeds.
"""

from __future__ import annotations

import pytest

from ccref import DRIVER_ABSENT_REASON, have_driver, run
from jsrun import have_node, run_js

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

N_BULK = 1_000_000
N_SEEDS = 1000
N_PER_SEED = 16


JS_STREAM = """
// Print the same five columns as `cc_ref rng`, from the same single draw.
const seed = Number(process.argv[2]);
const n = Number(process.argv[3]);
const s = pcgState();
pcgSeed(s, seed);
const out = [];
for (let i = 0; i < n; i++) {
  const a = {hi: s.hi, lo: s.lo};
  const b = {hi: s.hi, lo: s.lo};
  const c4 = {hi: s.hi, lo: s.lo};
  const c8 = {hi: s.hi, lo: s.lo};
  const c64 = {hi: s.hi, lo: s.lo};
  const v = crPcg(a);
  const rf = f32Bits(crRf(b)).toString(16).padStart(8, '0');
  out.push(v + ' ' + rf + ' ' + crRi(c4, 4) + ' ' + crRi(c8, 8) + ' ' + crRi(c64, 64));
  s.hi = a.hi; s.lo = a.lo;
}
process.stdout.write(out.join('\\n') + '\\n');
"""


def js_stream(seed: int, n: int) -> list[str]:
    import subprocess, tempfile
    from pathlib import Path

    from jsrun import COMMON, COMMON_SOURCES

    parts = [(COMMON / name).read_text() for name in COMMON_SOURCES]
    parts.append(JS_STREAM)
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(
            ["node", temp, str(seed), str(n)], capture_output=True, text=True
        )
        assert proc.returncode == 0, proc.stderr
        return proc.stdout.splitlines()
    finally:
        Path(temp).unlink(missing_ok=True)


def c_stream(seed: int, n: int) -> list[str]:
    return run("rng", str(seed), str(n)).decode().splitlines()


def assert_streams_equal(seed: int, js: list[str], c: list[str]):
    assert len(js) == len(c), f"seed {seed}: {len(js)} JS lines vs {len(c)} C lines"
    for i, (a, b) in enumerate(zip(js, c)):
        if a != b:
            ja = a.split()
            jb = b.split()
            fields = ["pcg", "rf_bits", "ri4", "ri8", "ri64"]
            bad = [f"{f}: JS {x} vs C {y}" for f, x, y in zip(fields, ja, jb) if x != y]
            pytest.fail(f"seed {seed}, draw {i}: " + "; ".join(bad))


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_one_million_draws_match_the_c():
    assert_streams_equal(12345, js_stream(12345, N_BULK), c_stream(12345, N_BULK))


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_seeding_and_warmup_match_over_a_thousand_seeds():
    """c_init multiplies the seed by a constant and then burns eight draws.
    Getting the warm-up count wrong shifts every stream by a fixed offset,
    which the bulk test above would not catch because it uses one seed."""
    for seed in range(N_SEEDS):
        assert_streams_equal(seed, js_stream(seed, N_PER_SEED), c_stream(seed, N_PER_SEED))


def _strip_line_comments(src: str) -> str:
    return "\n".join(line.split("//")[0] for line in src.splitlines())


def test_no_bigint_in_the_shared_modules():
    """PLAN's rule, and a performance one: BigInt in the step loop is about an
    order of magnitude slower in QuickJS, and this runs roughly twenty times a
    step. Source-level because a correct BigInt implementation would pass
    every numeric test in this file.

    Comments are stripped first — the modules explain *why* they avoid BigInt,
    and an earlier version of this test failed on its own documentation."""
    import re

    from jsrun import COMMON, COMMON_SOURCES

    for name in COMMON_SOURCES:
        code = _strip_line_comments((COMMON / name).read_text())
        assert "BigInt" not in code, f"{name} uses BigInt"
        assert not re.search(r"\b\d+n\b", code), f"{name} has a BigInt literal"


def test_rf_is_in_range_and_exact():
    out = run_js("""
const s = pcgState();
pcgSeed(s, 7);
let bad = 0;
for (let i = 0; i < 100000; i++) {
  const c = {hi: s.hi, lo: s.lo};
  const v = crPcg(c);
  const f = crRf(s);
  if (f < 0 || f >= 1) bad++;
  if (f !== (v >>> 8) * (1 / 16777216)) bad++;
  if (Math.fround(f) !== f) bad++;   // must be exactly representable in float32
}
console.log(bad);
""")
    assert out.strip() == "0"
