"""T1 (PuzzleScript): the reference's 470 runtime tests (tests/testdata.js) through the rule VM: the JS compiler's
state exported by parity/puzzlescript/tools/twin_state.mjs --tests, replayed by build/test_ps_reference exactly as
testingFrameWork.js runTest does (undo, restart, tick, again loop, seeds), level string and sound history compared.
The other 300 reference tests (errormessage_testdata.js) are compiler-error tests: they exercise the JS front end,
which the twin never replaces; they stay covered by the family's G1 (test_reference_tests.py). Also: twin/state is
fresh against games/*.txt."""
import subprocess

from conftest import BUILD, PARITY, ensure_built, node

FAM = PARITY / "puzzlescript"


def test_runtime_reference_tests_through_vm():
    ensure_built()
    out = BUILD / "ps_tests.json"
    proc = node(str(FAM / "tools" / "twin_state.mjs"), "--tests", str(out), cwd=FAM)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    assert "wrote 470 tests" in proc.stdout and "(0 compile errors)" in proc.stdout, proc.stdout
    run = subprocess.run([str(BUILD / "test_ps_reference"), str(out)], capture_output=True, text=True, timeout=1800)
    assert run.returncode == 0, run.stdout[-6000:] + run.stderr[-2000:]
    assert run.stdout.startswith("passed 470 / 470 (failed 0, skipped 0)"), run.stdout[:400]


def test_state_fresh():
    proc = node(str(FAM / "tools" / "twin_state.mjs"), "--check", cwd=FAM)
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-2000:]
    assert proc.stdout.strip().endswith("state fresh (17 games)")
