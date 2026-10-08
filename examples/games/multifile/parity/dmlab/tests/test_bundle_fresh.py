"""Committed bundles and generated sources are what a fresh build produces."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parents[4]
MANIFESTS = [HERE / 'manifest.json'] + sorted(HERE.glob('manifest_*.json'))


def test_bundles_are_fresh():
    for m in MANIFESTS:
        r = subprocess.run([sys.executable, str(REPO / 'tools' / 'bundle_multifile.py'), str(m), '--check'],
                           capture_output=True, text=True, cwd=REPO)
        assert r.returncode == 0, f'{m.name}: {r.stdout}{r.stderr}'
