_BUILD_FILE = '''

exports_files(["defs.bzl"])

cc_library(
    name = "python_headers",
    hdrs = glob(["python3/**/*.h", "numpy3/**/*.h"]),
    includes = ["python3", "numpy3"],
    visibility = ["//visibility:public"],
)
'''

_GET_PYTHON_INCLUDE_DIR = """
import sys
from distutils.sysconfig import get_python_inc
from numpy import get_include
sys.stdout.write("{}\\n{}\\n".format(get_python_inc(), get_include()))
""".strip()

def _python_repo_impl(repository_ctx):
    repository_ctx.file("BUILD", _BUILD_FILE)
    result = repository_ctx.execute(["python3", "-c", _GET_PYTHON_INCLUDE_DIR])
    if result.return_code:
        fail("Failed to run local Python3 interpreter: %s" % result.stderr)
    pypath, nppath = result.stdout.splitlines()
    repository_ctx.symlink(pypath, "python3")
    repository_ctx.symlink(nppath, "numpy3")

python_repo = repository_rule(
    implementation = _python_repo_impl,
    configure = True,
    local = True,
    attrs = {"py_version": attr.string(default = "PY3", values = ["PY3"])},
)
