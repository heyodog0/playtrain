"""G2: the parity claim.

Full canonical state equal to the C on every step of every corpus episode,
plus the per-step reward compared as float32 bits and the done flag. This is
the gate that earns the `parity/` directory; everything else in this suite
exists to make a failure here point somewhere.

This file carries the one documented skip in the suite: when the reference
driver has not been built, there is nothing to step against. CI runs
test_golden.py instead, which checks the same trajectories against committed
hashes and needs no compiler.
"""

from __future__ import annotations

import json
import struct
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver, layout, parse_run, run
from jsrun import COMMON, COMMON_SOURCES, have_node

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

TRACES = GAME / "traces"
SRC = GAME / "src"
SOURCES = [COMMON / n for n in COMMON_SOURCES] + [
    SRC / "10_constants.js", SRC / "20_state.js", SRC / "30_worldgen.js",
    SRC / "40_player.js", SRC / "50_mobs.js", SRC / "60_world_tick.js",
    SRC / "70_step.js",
]

DRIVE_JS = """
const fs = require('fs');
const seed = Number(process.argv[2]);
const actions = fs.readFileSync(process.argv[3]);

const st = createState();
newEpisode(st, seed);

const out = [];
for (let t = 0; t < actions.length; t++) {
  const res = stepGame(st, actions[t]);
  const dump = getParityState(st, res.reward);
  const tail = Buffer.alloc(1);
  tail[0] = res.done ? 1 : 0;
  out.push(Buffer.from(dump), tail);
  if (res.done) break;
}
process.stdout.write(Buffer.concat(out));
"""


def js_episode(seed: int, actions_path: Path, state_bytes: int):
    parts = [p.read_text() for p in SOURCES] + [DRIVE_JS]
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(
            ["node", temp, str(seed), str(actions_path)], capture_output=True
        )
        assert proc.returncode == 0, proc.stderr.decode()
        blob = proc.stdout
    finally:
        Path(temp).unlink(missing_ok=True)
    rec = state_bytes + 1
    assert len(blob) % rec == 0, f"JS emitted {len(blob)} bytes, not a multiple of {rec}"
    return [(blob[i * rec : i * rec + state_bytes], blob[i * rec + state_bytes])
            for i in range(len(blob) // rec)]


def corpus():
    return json.loads((TRACES / "corpus.json").read_text())["episodes"]


def field_at(offset: int, rows):
    for off, size, typ, count, name in rows:
        if off <= offset < off + size:
            return name, offset - off, typ
    return "<past end>", offset, "?"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_full_state_matches_the_c_every_step_of_every_episode():
    rows, total = layout()
    episodes = corpus()
    assert len(episodes) == 210, f"corpus has {len(episodes)} episodes"

    steps_compared = 0
    for ep in episodes:
        path = TRACES / ep["file"]
        c = parse_run(run("run", str(ep["seed"]), str(path), "--dump-every", "1"))
        js = js_episode(ep["seed"], path, total)

        assert len(js) == len(c.steps), (
            f"{ep['file']} seed {ep['seed']}: JS ran {len(js)} steps, C ran {len(c.steps)}"
        )
        for i, (c_step, (js_state, js_done)) in enumerate(zip(c.steps, js)):
            # reward, as bits
            js_reward_bits = struct.unpack_from("<I", js_state, total - 4)[0]
            if js_reward_bits != c_step.reward_bits:
                a = struct.unpack("<f", struct.pack("<I", js_reward_bits))[0]
                b = struct.unpack("<f", struct.pack("<I", c_step.reward_bits))[0]
                pytest.fail(
                    f"{ep['file']} seed {ep['seed']} step {i + 1}: reward "
                    f"JS {a!r} (0x{js_reward_bits:08x}) vs C {b!r} (0x{c_step.reward_bits:08x})"
                )
            # done
            assert bool(js_done) == c_step.done, (
                f"{ep['file']} seed {ep['seed']} step {i + 1}: "
                f"done JS {bool(js_done)} vs C {c_step.done}"
            )
            # full state
            if js_state != c_step.state:
                for b in range(total):
                    if js_state[b] != c_step.state[b]:
                        name, within, typ = field_at(b, rows)
                        extra = f" (r={within // 64}, c={within % 64})" if name == "map_packed" else ""
                        pytest.fail(
                            f"{ep['file']} seed {ep['seed']} step {i + 1}: "
                            f"field {name}[{within}]{extra} ({typ}): "
                            f"JS 0x{js_state[b]:02x} vs C 0x{c_step.state[b]:02x}"
                        )
            steps_compared += 1

    assert steps_compared > 45000, f"only {steps_compared} steps compared"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_light_level_actually_varies_in_this_corpus():
    """6b's probe froze light_level at 1.0, which hid the (1-light)^2 term in
    the zombie spawn chance. Confirm the full step really does move it, so
    this gate covers what that one could not."""
    rows, total = layout()
    off = next(r[0] for r in rows if r[4] == "light_level")
    seen = set()
    for ep in corpus()[:20]:
        c = parse_run(run("run", str(ep["seed"]), str(TRACES / ep["file"]), "--dump-every", "1"))
        for step in c.steps:
            seen.add(struct.unpack_from("<f", step.state, off)[0])
    assert len(seen) > 50, f"light_level took only {len(seen)} distinct values"
    assert min(seen) < 0.95, f"light never dropped below {min(seen)}"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_score_is_the_float32_running_sum_the_c_keeps():
    """PLAN 3.5: score must equal the C's episode_return_accum bit for bit,
    which means summing in float32 and rounding after each add. Summing in
    double and rounding once at the end gives a different answer on long
    episodes, so the JS value is compared against a float32 accumulation of
    the C's own per-step rewards."""
    rows, total = layout()
    for ep in corpus()[:30]:
        path = TRACES / ep["file"]
        c = parse_run(run("run", str(ep["seed"]), str(path), "--dump-every", "1"))

        acc = numpy_free_f32_sum(step.reward_bits for step in c.steps)
        js_score = js_final_score(ep["seed"], path)
        assert js_score == acc, (
            f"{ep['file']} seed {ep['seed']}: JS score {js_score!r} "
            f"vs float32 sum of the C's rewards {acc!r}"
        )


def numpy_free_f32_sum(reward_bit_stream) -> float:
    """Sum float32 rewards, rounding to float32 after every add."""
    acc = 0.0
    for bits in reward_bit_stream:
        r = struct.unpack("<f", struct.pack("<I", bits))[0]
        acc = struct.unpack("<f", struct.pack("<f", acc + r))[0]
    return acc


SCORE_JS = """
const fs = require('fs');
const st = createState();
newEpisode(st, Number(process.argv[2]));
const actions = fs.readFileSync(process.argv[3]);
for (let t = 0; t < actions.length; t++) {
  if (stepGame(st, actions[t]).done) break;
}
process.stdout.write(String(st.score[0]));
"""


def js_final_score(seed: int, actions_path: Path) -> float:
    parts = [p.read_text() for p in SOURCES] + [SCORE_JS]
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(
            ["node", temp, str(seed), str(actions_path)], capture_output=True, text=True
        )
        assert proc.returncode == 0, proc.stderr
        return float(proc.stdout)
    finally:
        Path(temp).unlink(missing_ok=True)
