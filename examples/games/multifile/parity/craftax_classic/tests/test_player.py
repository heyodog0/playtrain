"""Gate for task 6a: the player half of a step, in lockstep with the C.

`cc_ref player` runs only the first four calls of puf_step — do_crafting,
do_action, place_block, move_player — and dumps the full canonical state
after each. This file does the same in JS and compares every byte of every
step. No mobs move and nothing spawns, so any difference is in the four
functions 40_player.js delivers, which is what makes this useful before the
rest of the step exists.

The forager episodes are the ones with content here: they craft every tool
the corpus reaches, mine every ore it reaches, place tables, furnaces, stone
and saplings, and drink. Random episodes mostly walk.
"""

from __future__ import annotations

import json
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
    SRC / "40_player.js",
]

# The JS mirror of cc_step_player_only.
DRIVE_JS = """
const fs = require('fs');
const seed = Number(process.argv[2]);
const actions = fs.readFileSync(process.argv[3]);

const st = createState();
clearState(st);
pcgSeed(st.pcg, seed);
generateWorld(st);

const out = [];
for (let t = 0; t < actions.length; t++) {
  let action = actions[t];
  if (action < 0) action = 0;
  if (action >= NUM_ACTIONS) action = NUM_ACTIONS - 1;
  const eff = st.isSleeping[0] ? ACT_NOOP : action;
  doCrafting(st, eff);
  if (eff === ACT_DO) doAction(st);
  if (eff >= ACT_PLACE_STONE && eff <= ACT_PLACE_PLANT) placeBlock(st, eff);
  movePlayer(st, eff);
  out.push(Buffer.from(getParityState(st, 0)));
}
process.stdout.write(Buffer.concat(out));
"""


def js_player(seed: int, actions_path: Path) -> bytes:
    parts = [p.read_text() for p in SOURCES] + [DRIVE_JS]
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
        fh.write("\n".join(parts))
        temp = fh.name
    try:
        proc = subprocess.run(
            ["node", temp, str(seed), str(actions_path)], capture_output=True
        )
        assert proc.returncode == 0, proc.stderr.decode()
        return proc.stdout
    finally:
        Path(temp).unlink(missing_ok=True)


def forager_episodes():
    manifest = json.loads((TRACES / "corpus.json").read_text())
    return [ep for ep in manifest["episodes"] if ep["policy"] == "forager"]


def field_at(offset: int, rows):
    for off, size, typ, count, name in rows:
        if off <= offset < off + size:
            return name, offset - off, typ
    return "<past end>", offset, "?"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_player_half_matches_the_c_on_every_forager_episode():
    rows, total = layout()
    episodes = forager_episodes()
    assert episodes, "no forager episodes in the corpus"

    for ep in episodes:
        path = TRACES / ep["file"]
        c = parse_run(run("player", str(ep["seed"]), str(path)))
        js = js_player(ep["seed"], path)
        assert len(js) == len(c.steps) * total, (
            f"{ep['file']}: JS produced {len(js)} bytes for {len(c.steps)} steps"
        )
        for i, step in enumerate(c.steps):
            a = js[i * total : (i + 1) * total]
            if a != step.state:
                for b in range(total):
                    if a[b] != step.state[b]:
                        name, within, typ = field_at(b, rows)
                        extra = f" (r={within // 64}, c={within % 64})" if name == "map_packed" else ""
                        pytest.fail(
                            f"{ep['file']} seed {ep['seed']} step {i + 1}: "
                            f"field {name}[{within}]{extra} ({typ}): "
                            f"JS 0x{a[b]:02x} vs C 0x{step.state[b]:02x}"
                        )


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_rng_stays_in_step():
    """do_action draws exactly one cr_rf, and only when the facing block is
    grass. Getting that condition wrong leaves the map identical and the
    stream one draw out, which would not surface until much later."""
    rows, total = layout()
    off, size = next((r[0], r[1]) for r in rows if r[4] == "pcg")
    for ep in forager_episodes()[:10]:
        path = TRACES / ep["file"]
        c = parse_run(run("player", str(ep["seed"]), str(path)))
        js = js_player(ep["seed"], path)
        for i, step in enumerate(c.steps):
            a = js[i * total + off : i * total + off + size]
            b = step.state[off : off + size]
            assert a == b, (
                f"{ep['file']} step {i + 1}: PCG state diverged "
                f"(JS {a.hex()} vs C {b.hex()})"
            )
