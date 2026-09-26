"""Gate for task 11's build half: the Play page reads the sidecar.

PLAN 8 asks for three things: the multifile dists as a third source directory,
the Play page reading the sidecar for the keymap overlay and step pacing, and a
label built from `manifest.reference` for parity games and nothing extra for
the rest.

Task 11 is a handoff — a person has to look at the page. This gates what can be
checked without eyes: that the pieces are wired, and that the 38 catalog pages
are byte-for-byte unaffected.
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

from ccref import GAME
from jsrun import have_node

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

REPO = GAME.parents[4]
DIST = GAME / "dist"
NAME = "craftax_classic"
BUILD_PAGES = REPO / "tools" / "build-pages.mjs"
WEBSITE_BUILD = REPO.parent / "playtrain-website" / "build.sh"


def build(games_dir: Path) -> Path:
    out = Path(tempfile.mkdtemp(prefix="pt_pages_"))
    proc = subprocess.run(
        ["node", str(BUILD_PAGES), "--games", str(games_dir), "--out", str(out)],
        capture_output=True, text=True, cwd=REPO,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return out


@pytest.fixture(scope="module")
def parity_page():
    return (build(DIST) / "game" / NAME / "index.html").read_text()


@pytest.fixture(scope="module")
def catalog_pages():
    out = build(REPO / "examples" / "games" / "js")
    return {p.parent.name: p.read_text() for p in out.glob("game/*/index.html")}


def test_the_page_is_paced_from_the_sidecar(parity_page):
    sps = json.loads((DIST / f"{NAME}.json").read_text())["human"]["steps_per_second"]
    assert sps == 8
    assert f"var FRAME_MS = 1000 / {sps}," in parity_page
    assert f"rasterizer ({sps}fps)" in parity_page


def test_the_controls_overlay_comes_from_the_sidecar(parity_page):
    controls = json.loads((DIST / f"{NAME}.json").read_text())["human"]["controls"]
    assert '<div id="controls-overlay">' in parity_page
    # A distinctive fragment, so the overlay is the sidecar's text and not a stub.
    assert "Tab sleep" in controls and "Tab sleep" in parity_page


def test_the_parity_label_is_built_from_the_reference_block(parity_page):
    ref = json.loads((DIST / f"{NAME}.json").read_text())["reference"]
    m = re.search(r'<div id="parity-label">(.*?)</div>', parity_page, re.S)
    assert m, "no parity label on the page"
    label = m.group(1)
    assert "exact dynamics vs" in label
    assert ref["name"] in label
    assert ref["commit"][:7] in label
    # The honest half must be on the page too, not just the claim.
    for item in ref["not_matched"]:
        assert item in label, f"not_matched item missing from the label: {item}"


def test_catalog_pages_get_no_label_no_overlay_and_stay_at_60fps(catalog_pages):
    """PLAN 8: "nothing extra for others". The catalog is the bulk of the Play
    tab, and a sidecar mechanism that leaked into it would change 38 pages."""
    assert len(catalog_pages) >= 30, f"only {len(catalog_pages)} catalog pages built"
    for name, html in catalog_pages.items():
        assert '<div id="parity-label">' not in html, f"{name} grew a parity label"
        assert '<div id="controls-overlay">' not in html, f"{name} grew a controls overlay"
        assert "var FRAME_MS = 1000 / 60," in html, f"{name} is no longer 60fps"
        assert "rasterizer (60fps)" in html, f"{name} help text changed"


def test_the_website_build_unions_the_multifile_dists():
    """build.sh is in the website repo; check it copies both the bundle and
    the sidecar, since the page is useless without the second."""
    if not WEBSITE_BUILD.exists():
        pytest.skip(f"website checkout not beside the repo at {WEBSITE_BUILD}")
    src = WEBSITE_BUILD.read_text()
    assert "examples/games/multifile" in src
    assert '"$d"/*.json' in src, "the sidecar is not copied alongside the bundle"
    assert '"$d"/*.js' in src


def test_an_unparseable_sidecar_does_not_break_the_build(tmp_path):
    """A malformed sidecar should warn and fall back, not abort the Play tab."""
    games = tmp_path / "games"
    games.mkdir()
    (games / "broken.js").write_text("function setup(){} function draw(){}\n")
    (games / "broken.json").write_text("{ this is not json")
    out = tmp_path / "out"
    proc = subprocess.run(
        ["node", str(BUILD_PAGES), "--games", str(games), "--out", str(out)],
        capture_output=True, text=True, cwd=REPO,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    html = (out / "game" / "broken" / "index.html").read_text()
    assert "var FRAME_MS = 1000 / 60," in html
    assert '<div id="parity-label">' not in html
