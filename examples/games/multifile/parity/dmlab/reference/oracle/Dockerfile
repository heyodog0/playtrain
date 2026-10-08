# DMLab oracle: DeepMind Lab built headless (OSMesa software renderer) as a pip
# package, following danijar's install-dmlab.sh for Ubuntu 22.04
# (https://gist.github.com/danijar/ca6ab917188d2e081a8253b3ca5c36d3).
# A TOOL, never shipped: the image links GPL-2 code; only the dumps it writes
# leave it. Build with build.sh (linux/amd64).
FROM ubuntu:22.04
ARG LAB_COMMIT=b1db91af5b4d2f3a24466f4632a3e5e1b0829cca
ENV DEBIAN_FRONTEND=noninteractive
# Bazel 8+ dropped the native sh_binary that lab's BUILD files use.
ENV USE_BAZEL_VERSION=7.4.1
RUN apt-get update && apt-get install -y \
      build-essential curl wget freeglut3-dev gettext git libffi-dev libglu1-mesa \
      libglu1-mesa-dev libjpeg-dev liblua5.1-0-dev libosmesa6-dev \
      libsdl2-dev lua5.1 pkg-config python3-dev python3-pip \
      software-properties-common unzip zip zlib1g-dev g++ \
    && apt-get clean
RUN pip install -U pip setuptools wheel && pip install numpy dm-env Pillow
RUN wget -q https://github.com/bazelbuild/bazelisk/releases/download/v1.17.0/bazelisk-linux-amd64 \
      -O /usr/local/bin/bazel && chmod +x /usr/local/bin/bazel
RUN git clone https://github.com/google-deepmind/lab.git /lab && cd /lab && git checkout ${LAB_COMMIT}
WORKDIR /lab
COPY python_system.bzl /lab/python_system.bzl
COPY pin_deps.sh /tmp/pin_deps.sh
RUN bash /tmp/pin_deps.sh
RUN printf 'build --enable_workspace\nbuild --python_version=PY3\nbuild --action_env=PYTHON_BIN_PATH=%s\n' "$(which python3)" > .bazelrc \
 && sed -i '/\[py_binary(/,/\]]/c\
py_binary(\
    name = "python_game_py3",\
    srcs = ["examples/game_main.py"],\
    data = ["//:deepmind_lab.so"],\
    main = "examples/game_main.py",\
    python_version = "PY3",\
    srcs_version = "PY3",\
    tags = ["manual"],\
    deps = ["@six_archive//:six"],\
)' BUILD
RUN bazel build -c opt //python/pip_package:build_pip_package --verbose_failures
RUN ./bazel-bin/python/pip_package/build_pip_package /tmp/dmlab_pkg \
 && pip install --force-reinstall /tmp/dmlab_pkg/deepmind_lab-*.whl \
 && DEST="$(python3 -c 'import site; print(site.getsitepackages()[0])')/deepmind_lab" \
 && if [ -d "${DEST}/_main" ]; then cp -r "${DEST}/_main/"* "${DEST}/" && rm -r "${DEST}/_main"; fi
RUN python3 -c "import deepmind_lab; deepmind_lab.Lab('contributed/dmlab30/explore_goal_locations_small', ['RGB_INTERLEAVED'], config={'width':'64','height':'64'}, renderer='software').reset(seed=0); print('DMLAB OK')"
WORKDIR /work
