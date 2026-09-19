"""dist/ is committed; it must be exactly what tools/bundle_all.mjs produces."""
from conftest import node


def test_dist_is_fresh():
    proc = node("tools/bundle_all.mjs", "--check")
    assert proc.returncode == 0, proc.stdout + proc.stderr
