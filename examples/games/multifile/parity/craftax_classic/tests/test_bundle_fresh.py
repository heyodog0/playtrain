"""Gate for task 7a: the committed bundle is the one the sources produce.

`dist/` is committed so the Play tab, the gates, the AOT cache and
`uvx playtrain games` can all glob flat files and learn nothing new. That
only works if the committed file is never stale, which is what this checks.

It also checks the bundle is a usable script rather than just the right
bytes: node has to be able to evaluate it, and the game it defines has to
step identically to the same code loaded as separate files. Concatenation
order is scope order, so a source listed out of dependency order produces a
bundle that is byte-correct and broken.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import GAME
from jsrun import COMMON, COMMON_SOURCES, have_node

REPO = GAME.parents[4]
BUNDLER = REPO / "tools" / "bundle_multifile.py"
MANIFEST = GAME / "manifest.json"
DIST = GAME / "dist"


def manifest():
    return json.loads(MANIFEST.read_text())


def test_bundle_is_not_stale():
    """The real gate: --check rebuilds in memory and compares."""
    proc = subprocess.run(
        ["uv", "run", "python", str(BUNDLER), "--all", "--check"],
        capture_output=True, text=True, cwd=REPO,
    )
    assert proc.returncode == 0, (
        "committed dist/ is stale — run `just bundle-all`\n" + proc.stdout + proc.stderr
    )


def test_dist_holds_exactly_one_js_and_one_json():
    """The multifile README's contract."""
    files = sorted(p.name for p in DIST.iterdir() if p.is_file())
    name = manifest()["name"]
    assert files == [f"{name}.js", f"{name}.json"]


def test_sidecar_is_the_manifest_minus_sources():
    m = manifest()
    sidecar = json.loads((DIST / f"{m['name']}.json").read_text())
    assert "sources" not in sidecar, "sources is a build-time key and must not ship"
    for key, value in m.items():
        if key == "sources":
            continue
        assert sidecar[key] == value, f"sidecar {key} differs from the manifest"
    assert len(sidecar["actions"]) == 17
    assert sidecar["reference"]["commit"].startswith("6ffa5b10")


def test_every_manifest_source_exists_and_is_listed_once():
    m = manifest()
    seen = set()
    for rel in m["sources"]:
        path = (GAME / rel).resolve()
        assert path.is_file(), f"{rel} does not exist"
        assert rel not in seen, f"{rel} listed twice"
        seen.add(rel)


def test_the_banner_warns_against_editing():
    js = (DIST / f"{manifest()['name']}.js").read_text()
    head = js[:1200]
    assert "GENERATED" in head and "DO NOT EDIT" in head
    assert "just bundle" in head


@pytest.mark.skipif(not have_node(), reason="node not on PATH")
def test_the_bundle_evaluates_and_steps_like_the_loose_sources():
    """Byte-equality does not prove the bundle runs. Step both the bundle and
    the same sources loaded separately, and compare the canonical dumps."""
    m = manifest()
    bundle = DIST / f"{m['name']}.js"

    drive = """
const st = createState();
newEpisode(st, 4242);
let h = 0;
for (let t = 0; t < 200; t++) {
  const res = stepGame(st, (t * 7) % 17);
  if (res.done) break;
}
process.stdout.write(Buffer.from(getParityState(st, 0)).toString('hex'));
"""

    def run_sources(parts):
        with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as fh:
            fh.write("\n".join(parts))
            temp = fh.name
        try:
            proc = subprocess.run(["node", temp], capture_output=True, text=True)
            assert proc.returncode == 0, proc.stderr
            return proc.stdout
        finally:
            Path(temp).unlink(missing_ok=True)

    from_bundle = run_sources([bundle.read_text(), drive])
    loose = run_sources([(GAME / rel).read_text() for rel in m["sources"]] + [drive])
    assert from_bundle == loose, "the bundle steps differently from its own sources"
    assert len(from_bundle) > 0
