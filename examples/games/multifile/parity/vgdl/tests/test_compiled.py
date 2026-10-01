"""The compile pass (tools/compile_vgdl.mjs) is a partial evaluation of the interpreter:
interpreted and compiled bundles must agree on every step of every run."""
from conftest import node


def test_interpreter_equals_compiled():
    proc = node("tests/compare_interp_compiled.mjs", "300")
    assert proc.returncode == 0, proc.stdout + proc.stderr
