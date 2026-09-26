"""Gate for task 6b: the mob half of a step, in lockstep with the C.

`cc_ref mobs` runs the player probe plus update_mobs and spawn_mobs — the
first six calls of puf_step — and dumps the full canonical state after each.

This is the hardest part of the port to get right, because the number of RNG
draws per step varies with geometry: a zombie's tie-break draw only happens
when its row and column distances are equal, a skeleton's movement branch
depends on range bands, and try_spawn takes up to 20 attempts at two draws
each and stops at the first acceptable cell. So the PCG state is checked
alongside the rest, on every step.

The uniform and sticky episodes are the right corpus here. They walk far,
which is what makes mobs despawn at distance 14, and they survive long
enough at night for zombies to spawn and fight.

TWO THINGS THIS PROBE CANNOT REACH, both by construction:

  light_level stays at the 1.0 generate_world set, because the probe stops
  before the step recomputes it. The zombie spawn chance is
  0.02 + 0.1*(1-light)^2, so at light 1.0 the second term is multiplied by
  zero and the 0.1 coefficient is invisible here — mutating it to 0.11 passes
  this gate. 6c's full lockstep is what covers it.

  Arrows never appear; see the coverage test at the bottom.
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
    SRC / "40_player.js", SRC / "50_mobs.js",
]

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
  updateMobs(st);
  spawnMobs(st);
  out.push(Buffer.from(getParityState(st, 0)));
}
process.stdout.write(Buffer.concat(out));
"""


def js_mobs(seed: int, actions_path: Path) -> bytes:
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


def episodes_for(policies):
    manifest = json.loads((TRACES / "corpus.json").read_text())
    return [ep for ep in manifest["episodes"] if ep["policy"] in policies]


def field_at(offset: int, rows):
    for off, size, typ, count, name in rows:
        if off <= offset < off + size:
            return name, offset - off, typ
    return "<past end>", offset, "?"


def compare(episodes):
    rows, total = layout()
    assert episodes, "no episodes selected"
    for ep in episodes:
        path = TRACES / ep["file"]
        c = parse_run(run("mobs", str(ep["seed"]), str(path)))
        js = js_mobs(ep["seed"], path)
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
def test_mobs_match_the_c_on_the_uniform_episodes():
    compare(episodes_for({"uniform"}))


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_mobs_match_the_c_on_the_sticky_episodes():
    """Sticky walks are ballistic rather than a random walk, so they actually
    leave the starting neighbourhood — which is what exercises despawn at
    MOB_DESPAWN_DIST and the map edges."""
    compare(episodes_for({"sticky"}))


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_mobs_match_the_c_on_the_rest_of_the_corpus():
    """PLAN's table asks for random and sticky here. The other three policies
    cost little extra and are the only ones that ever produce a skeleton, so
    they are included rather than left for 6c."""
    compare(episodes_for({"forager", "adversarial", "lava"}))


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_corpus_actually_contains_the_mobs_this_gate_claims_to_check():
    """A lockstep gate over episodes with no mobs would pass trivially.

    Measured over all 210 episodes under this probe: zombies and cows are
    plentiful, skeletons appear only in forager episodes and only briefly (7
    mob-steps in the whole corpus), and ARROWS NEVER APPEAR AT ALL — an arrow
    needs a live skeleton at L1 distance 4 or 5 with its cooldown expired.

    So the arrow block of update_mobs is ported but unexercised. That is the
    same corpus gap as the 3b-ii blocker, and it is recorded there; do not
    read this gate as evidence about arrows.
    """
    rows, _ = layout()
    idx = {r[4]: (r[0], r[1]) for r in rows}
    seen = {"zombie_mask": 0, "cow_mask": 0, "skel_mask": 0, "arrow_mask": 0}
    for ep in episodes_for({"uniform", "sticky", "forager", "adversarial", "lava"}):
        c = parse_run(run("mobs", str(ep["seed"]), str(TRACES / ep["file"])))
        for step in c.steps:
            for name in seen:
                off, size = idx[name]
                seen[name] += sum(step.state[off : off + size])
    for name in ("zombie_mask", "cow_mask", "skel_mask"):
        assert seen[name] > 0, f"no {name} ever set; this gate proves nothing about it"
    assert seen["arrow_mask"] == 0, (
        "an arrow appeared in the corpus — good news, but this test's premise "
        "changed: update the note here and in the 3b-ii blocker"
    )
