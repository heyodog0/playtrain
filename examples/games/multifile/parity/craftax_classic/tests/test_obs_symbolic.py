"""13a: G2 extended to the 1345-float symbolic observation.

The dynamics gate (test_lockstep.py) compares canonical state. The
observation is a different function of that state, and PufferLib trains on
it, so it gets its own bit-exact comparison over the same corpus: all 1345
floats, compared as float32 bits, every step.

`cc_ref obs` runs full steps and calls compute_observations explicitly after
each — cc_step_no_reset stops before puf_step's own call to it.
"""

from __future__ import annotations

import json
import struct
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver
from ccref import run as crun
from jsrun import COMMON, COMMON_SOURCES, have_node

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

TRACES = GAME / "traces"
SRC = GAME / "src"
SOURCES = [COMMON / n for n in COMMON_SOURCES] + [
    SRC / "10_constants.js", SRC / "20_state.js", SRC / "30_worldgen.js",
    SRC / "40_player.js", SRC / "50_mobs.js", SRC / "60_world_tick.js",
    SRC / "70_step.js", SRC / "85_obs_symbolic.js",
]
OBS_DIM = 1345

DRIVE_JS = """
const fs = require('fs');
const seed = Number(process.argv[2]);
const actions = fs.readFileSync(process.argv[3]);
const st = createState();
newEpisode(st, seed);
const out = [];
for (let t = 0; t < actions.length; t++) {
  const res = stepGame(st, actions[t]);
  const obs = getObservation(st);
  const b = Buffer.alloc(1 + obs.length * 4);
  b[0] = res.done ? 1 : 0;
  Buffer.from(obs.buffer, obs.byteOffset, obs.length * 4).copy(b, 1);
  out.push(b);
  if (res.done) break;
}
process.stdout.write(Buffer.concat(out));
"""


def js_obs(seed: int, actions_path: Path):
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
    rec = 1 + OBS_DIM * 4
    assert len(blob) % rec == 0
    return [(blob[i * rec], blob[i * rec + 1 : (i + 1) * rec])
            for i in range(len(blob) // rec)]


def c_obs(seed: int, actions_path: Path):
    blob = crun("obs", str(seed), str(actions_path))
    assert blob[:4] == b"CCO1", blob[:8]
    dim, _ = struct.unpack("<II", blob[4:12])
    assert dim == OBS_DIM, f"C says the observation is {dim} floats"
    rec = 1 + dim * 4
    body = blob[12:]
    assert len(body) % rec == 0
    return [(body[i * rec], body[i * rec + 1 : (i + 1) * rec])
            for i in range(len(body) // rec)]


def corpus():
    return json.loads((TRACES / "corpus.json").read_text())["episodes"]


def describe(i: int) -> str:
    """Which part of the observation float i belongs to."""
    if i < 63 * 21:
        tile, chan = divmod(i, 21)
        dr, dc = divmod(tile, 9)
        where = f"tile (dr={dr - 3}, dc={dc - 4})"
        if chan < 17:
            return f"{where} block one-hot channel {chan}"
        return f"{where} mob flag {['zombie', 'cow', 'skeleton', 'arrow'][chan - 17]}"
    j = i - 63 * 21
    if j < 12:
        return f"inventory[{j}]/10"
    j -= 12
    if j < 4:
        return f"{['health', 'food', 'drink', 'energy'][j]}/10"
    j -= 4
    if j < 4:
        return f"direction one-hot (dir {j + 1})"
    j -= 4
    return "light_level" if j == 0 else "is_sleeping"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_observation_matches_the_c_every_step_of_every_episode():
    episodes = corpus()
    assert len(episodes) == 210
    steps = 0
    for ep in episodes:
        path = TRACES / ep["file"]
        c = c_obs(ep["seed"], path)
        js = js_obs(ep["seed"], path)
        assert len(js) == len(c), (
            f"{ep['file']}: JS ran {len(js)} steps, C ran {len(c)}"
        )
        for i, ((c_done, c_vec), (js_done, js_vec)) in enumerate(zip(c, js)):
            assert c_done == js_done, f"{ep['file']} step {i + 1}: done differs"
            if c_vec != js_vec:
                for k in range(OBS_DIM):
                    a = c_vec[k * 4 : k * 4 + 4]
                    b = js_vec[k * 4 : k * 4 + 4]
                    if a != b:
                        av = struct.unpack("<f", a)[0]
                        bv = struct.unpack("<f", b)[0]
                        pytest.fail(
                            f"{ep['file']} seed {ep['seed']} step {i + 1}: "
                            f"obs[{k}] ({describe(k)}): C {av!r} (0x{a.hex()}) "
                            f"vs JS {bv!r} (0x{b.hex()})"
                        )
            steps += 1
    assert steps > 45000, f"only {steps} steps compared"


TAIL_NAMES = [
    "inv_wood", "inv_stone", "inv_coal", "inv_iron", "inv_diamond", "inv_sapling",
    "inv_wpick", "inv_spick", "inv_ipick", "inv_wsword", "inv_ssword", "inv_isword",
    "health", "food", "drink", "energy",
    "dir1", "dir2", "dir3", "dir4", "light", "sleeping",
]
TAIL_START = 63 * 21

# The inventory slots the corpus cannot fill, from the 3b-ii gap: no episode
# reaches iron or diamond, so those channels and the iron tools never move.
# The assertion below is a SUBSET check, so closing 3b-ii shrinks this set and
# does not fail the test.
KNOWN_CONSTANT_TAIL = {
    "inv_coal", "inv_diamond", "inv_ipick", "inv_iron", "inv_isword",
}


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_corpus_moves_enough_of_the_observation_to_be_evidence():
    """1323 of the 1345 floats are one-hot channels, most of which stay zero
    in any given episode — a block type that never appears near the player
    never lights up. So "the vectors matched" is only evidence about the
    floats that actually move, and it is worth measuring how many do.

    Measured over every 5th episode (42 of 210, spanning all five policies):
    an episode moves 67 to ~143 floats and the union is 785 of 1345. The
    thresholds are those measurements with room to spare.

    Sampling matters here. An earlier version of this test took the FIRST 40
    episodes, which are all `uniform` — the union was 357 and eight tail
    floats looked permanently dead. Spreading the sample across policies
    brought five of those back.
    """
    sample = corpus()[::5]
    assert len(sample) >= 40
    union = set()
    per_episode = []
    for ep in sample:
        vecs = [v for _, v in c_obs(ep["seed"], TRACES / ep["file"])]
        assert len(vecs) > 10
        varying = {
            k for k in range(OBS_DIM)
            if len({v[k * 4 : k * 4 + 4] for v in vecs}) > 1
        }
        per_episode.append(len(varying))
        union |= varying

    assert min(per_episode) >= 40, f"an episode moved only {min(per_episode)} floats"
    assert len(union) >= 700, f"only {len(union)} of {OBS_DIM} floats move corpus-wide"

    constant_tail = {
        TAIL_NAMES[k - TAIL_START]
        for k in range(TAIL_START, OBS_DIM) if k not in union
    }
    assert constant_tail <= KNOWN_CONSTANT_TAIL, (
        "a tail float stopped moving that used to: "
        f"{sorted(constant_tail - KNOWN_CONSTANT_TAIL)}"
    )


def test_the_layout_is_the_documented_1345():
    assert 63 * 21 + 12 + 4 + 4 + 1 + 1 == OBS_DIM
    sidecar = json.loads((GAME / "dist" / "craftax_classic.json").read_text())
    assert sidecar["obs"]["symbolic"] == OBS_DIM


def test_out_of_bounds_tiles_are_a_real_one_hot_channel():
    """Off-map cells encode BLK_OUT_OF_BOUNDS, not a zero vector. Standing in
    a corner is the cheap way to see it."""
    from jsrun import run_js_json

    got = run_js_json("""
const st = createState();
newEpisode(st, 1);
st.playerR[0] = 0; st.playerC[0] = 0;
const obs = getObservation(st);
// tile (dr=-3, dc=-4) is entirely off-map for a player at (0, 0)
const base = 0;
const out = [];
for (let b = 0; b < 17; b++) out.push(obs[base + b]);
console.log(JSON.stringify({oob: out, sum: out.reduce((a, b) => a + b, 0)}));
""", [str(p) for p in SOURCES])
    assert got["sum"] == 1.0, "an off-map tile encoded no block at all"
    assert got["oob"][1] == 1.0, "off-map tile is not BLK_OUT_OF_BOUNDS"
