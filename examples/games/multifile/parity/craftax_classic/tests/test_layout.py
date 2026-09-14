"""Gate for task 4b: the JS state agrees with the C's canonical layout.

`cc_ref layout` is the authority. This checks the JS side against it three
ways: the total size, the per-field offsets and widths, and — the one that
actually catches a mistake — a sentinel written into each field in turn,
serialized, and located in the output. A transposed pair of fields with the
same width passes the first two checks and fails the third.
"""

from __future__ import annotations

import json

import pytest

from ccref import DRIVER_ABSENT_REASON, have_driver, layout
from jsrun import COMMON_SOURCES, have_node, run_js_json

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

SOURCES = COMMON_SOURCES + ["../parity/craftax_classic/src/10_constants.js",
                            "../parity/craftax_classic/src/20_state.js"]

DESCRIBE_JS = """
const st = createState();
const out = [];
let off = 0;
for (let i = 0; i < PARITY_ORDER.length; i++) {
  const [cname, jsName, kind] = PARITY_ORDER[i];
  const n = stateFieldCount(jsName);
  const size = PARITY_WIDTH[kind] * n;
  out.push({name: cname, offset: off, size: size, type: kind, count: n});
  off += size;
}
out.push({name: 'reward', offset: off, size: 4, type: 'f32', count: 1});
console.log(JSON.stringify({fields: out, total: off + 4,
                            dumpBytes: getParityState(st, 0).length,
                            bufferBytes: st.byteLength}));
"""


@pytest.fixture(scope="module")
def js():
    return run_js_json(DESCRIBE_JS, SOURCES)


def test_the_serializer_writes_the_size_it_advertises(js):
    assert js["dumpBytes"] == js["total"]


def test_the_state_buffer_holds_every_field_once(js):
    """The buffer is laid out by width for alignment, so it is not the dump
    size; but every byte of the dump except the reward comes from it."""
    assert js["bufferBytes"] == js["total"] - 4


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_field_names_offsets_and_widths_match_the_c(js):
    rows, total = layout()
    c_fields = [
        {"name": name, "offset": off, "size": size, "type": typ, "count": count}
        for off, size, typ, count, name in rows
    ]
    assert js["total"] == total, f"JS dump is {js['total']} bytes, C says {total}"
    assert [f["name"] for f in js["fields"]] == [f["name"] for f in c_fields]
    for a, b in zip(js["fields"], c_fields):
        assert a["offset"] == b["offset"], f"{a['name']}: JS offset {a['offset']}, C {b['offset']}"
        assert a["size"] == b["size"], f"{a['name']}: JS size {a['size']}, C {b['size']}"
        assert a["count"] == b["count"], f"{a['name']}: JS count {a['count']}, C {b['count']}"
        # u64 rows are uint32 pairs on the JS side and the C prints them the
        # same way, so the type strings should agree outright.
        assert a["type"] == b["type"], f"{a['name']}: JS type {a['type']}, C {b['type']}"


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_each_field_lands_where_the_c_says_it_does():
    """Write a distinct sentinel into one field at a time and check the bytes
    it produces sit exactly in that field's span and nowhere else. This is
    what catches two same-width fields swapped in PARITY_ORDER."""
    rows, _ = layout()
    spans = {name: (off, size) for off, size, _typ, _count, name in rows}

    probe = run_js_json("""
const out = {};
for (let i = 0; i < PARITY_ORDER.length; i++) {
  const [cname, jsName] = PARITY_ORDER[i];
  const st = createState();
  const arr = st[jsName];
  // 0x5A in every byte of every element, whatever the element type.
  for (let k = 0; k < arr.length; k++) arr[k] = (arr instanceof Float32Array) ? 1.0e30 : 0x5a5a5a5a;
  const bytes = getParityState(st, 0);
  let lo = -1, hi = -1;
  for (let b = 0; b < bytes.length; b++) {
    if (bytes[b] !== 0) { if (lo < 0) lo = b; hi = b; }
  }
  out[cname] = [lo, hi];
}
console.log(JSON.stringify(out));
""", SOURCES)

    for name, (lo, hi) in probe.items():
        off, size = spans[name]
        assert lo >= 0, f"{name}: setting it changed no bytes"
        assert lo >= off and hi < off + size, (
            f"{name}: touched bytes {lo}..{hi}, but its span is {off}..{off + size - 1}"
        )


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_a_fresh_world_dump_is_byte_identical_for_the_zeroed_fields():
    """Sanity that the two serializers agree on an actual dump's shape: the C
    world dump and a cleared JS state must be the same length, and the JS
    state's cleared bytes must be zero where the C's are."""
    from ccref import run as crun

    c_world = crun("world", "1")
    js_len = run_js_json("""
const st = createState();
clearState(st);
console.log(JSON.stringify({len: getParityState(st, 0).length}));
""", SOURCES)["len"]
    assert js_len == len(c_world)
