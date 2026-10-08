"""U02: every DMLab-derived asset is provenanced, CC BY 4.0, hash-pinned, and
the generated atlas is up to date with them."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
ASSETS = HERE.parents[4] / 'games' / 'dmlab_assets'


def test_manifest_hashes_and_licence():
    man = json.loads((ASSETS / 'manifest.json').read_text())
    assert man['licence'] == 'CC BY 4.0' and man['commit']
    assert (ASSETS / 'ATTRIBUTION.md').exists()
    files = man['files']
    assert files
    on_disk = {str(p.relative_to(ASSETS)) for p in ASSETS.rglob('*') if p.suffix in ('.png', '.map')}
    assert on_disk == {e['file'] for e in files}, 'unlisted or missing asset files'
    for e in files:
        if e['file'].startswith('textures/synthetic__'):
            assert e['licence'].startswith('none') and not e['sources'], e['file']
        else:
            assert e['licence'] == 'CC BY 4.0', e['file']
            assert e['sources'] and all(len(s['sha256']) == 64 for s in e['sources']), e['file']
            assert all(s['path'].startswith(('textures/', 'models/', 'scripts/', 'maps/src/')) for s in e['sources']), e['file']
        assert e['modified'], e['file']
        got = hashlib.sha256((ASSETS / e['file']).read_bytes()).hexdigest()
        assert got == e['sha256'], e['file']


def test_atlas_is_fresh():
    r = subprocess.run([sys.executable, str(HERE / 'tools' / 'dmlab_atlas.py'), '--all', '--check'],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
