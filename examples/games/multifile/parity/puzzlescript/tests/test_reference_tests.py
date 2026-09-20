"""G1: the reference's own 770 tests pass through the bundle's engine (shims + vendored files in the bundler's
order) under node. No checkout needed: the test data is vendored."""
from conftest import node


def test_770_reference_tests_pass_in_the_bundle():
    proc = node("tests/run_reference_tests.mjs")
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-3000:]
    assert "Failed:  0" in proc.stdout and "Errors:  0" in proc.stdout and "Total:   770 tests" in proc.stdout, proc.stdout[-2000:]
