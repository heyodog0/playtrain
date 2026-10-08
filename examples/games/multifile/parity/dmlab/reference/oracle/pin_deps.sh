#!/bin/bash
# lab's WORKSPACE fetches seven dependencies at their moving default branch.
# Pin each to its commit as of lab's own last commit (2023-01-04T15:19:06Z),
# so the oracle builds the way it did then and keeps building.
set -euo pipefail
pin() {  # repo-name branch sha
  sed -i "s|\"$1-$2\"|\"$1-$3\"|; s|/$1/archive/$2.zip|/$1/archive/$3.zip|" WORKSPACE
}
pin googletest main 3a99ab6d8326c845af0672a0cd64dd05ad7734fe
pin bazel-skylib main 5bfcb1a684550626ce138fe0fe8f5f702b3764c3
pin abseil-cpp master 74d8b4d9bd5f8cf7b949b01e106c33cd0f0eba0a
pin abseil-py main fd32fea9dac2f3faa3516d4f9dca91625d886e90
pin dm_env master 91b46797fea731f80eab8cd2c8352a0674141d89
pin tree master cb13178e3ca9fec44352ea519c69147bc5e486e6
pin pybind11 master a34596bfe1947b4a6b0bcc4218e1f72d0c2e9b4c
if grep -nE 'archive/(main|master)\.zip' WORKSPACE; then echo 'unpinned dependency left' >&2; exit 1; fi
