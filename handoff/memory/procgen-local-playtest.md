---
name: procgen-local-playtest
description: "How to play Procgen interactively on this Apple Silicon Mac (Rosetta x86_64 Python 3.10 at ~/.local/share/procgen-play, launcher `procgen-play`)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: aa8daadf-7359-49ab-af63-4df759e480df
  modified: 2026-08-07T20:34:29.538Z
---

Procgen 0.10.7 has no arm64 macOS wheels (x86_64 only, cp37–cp310), so a local install
lives at `~/.local/share/procgen-play`: a python-build-standalone **x86_64 CPython 3.10.15**
plus a venv with `procgen`, run under `arch -x86_64`. Launcher: `~/.local/bin/procgen-play`
(e.g. `procgen-play maze --level-seed 3`).

Critical fix: the `glfw==1.12.0` that gym3 pins fails on current macOS with
`GLFWError (65544) Cocoa: Failed to find service port for display`. Upgrading to
`glfw>=2.10` fixes it — ignore the gym3 pin-conflict warning from pip.

Related: [[playtrain-human-study-plan]], [[human-study-state]]
