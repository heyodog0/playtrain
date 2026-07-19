# Pre-publish checklist

Open work items to address **before** publishing `node-gym` to npm and PyPI. None of these block local / repo-clone usage today; they only matter once researchers install via `pnpm add node-gym` + `pip install node-gym` from arbitrary projects.

## 1. Runtime resolution for installed packages

**Problem.** `python/node_gym/env.py` currently resolves the JS runtime via:

```python
DEFAULT_RUNTIME_DIR = Path(__file__).resolve().parents[2] / "runtime"
```

That finds `<repo>/runtime/` when developing against a clone, but a `pip install node-gym` lands `env.py` inside `site-packages/`, where no `runtime/` exists. The JS half lives separately under `node_modules/node-gym/runtime/`.

**Fix — try in this order:**

1. `runtime_dir=` constructor arg (already supported).
2. `NODE_GYM_RUNTIME` env var (already supported).
3. `<repo>/runtime/` for dev clones (already supported).
4. Walk up from `cwd` looking for `node_modules/node-gym/runtime/`.
5. Bulletproof fallback: shell out to `node -e "console.log(require.resolve('node-gym/package.json'))"` and resolve `runtime/` next to it. This handles pnpm hoisting, monorepos, Yarn PnP, and arbitrary `node_modules` layouts. Cost: one ~50ms `node` subprocess at env startup, once.

Implement step 5 last; steps 1–4 cover the common cases without paying the subprocess cost.

## 2. Two registries → version drift

**Problem.** Once published, the JS runtime ships via npm and the Python wrapper ships via PyPI. A user who upgrades one but not the other can land on mismatched versions. The binary IPC frame format is the silent fail mode: if the wire protocol changes between versions, things break in confusing ways instead of erroring cleanly.

**Mitigations:**

- **Co-version.** Always bump `version` in both `package.json` and `pyproject.toml` together. Single tag per release.
- **Handshake on startup.** Add a protocol version field to the `ping` response and have `NodeGymEnv.__init__` compare it against an expected value. Mismatch → clear error message naming both versions.
- **CI guard.** Add a check that fails the build if the two `version` fields disagree.

```python
# Sketch:
EXPECTED_PROTOCOL = 1
response, _ = self._request({"cmd": "ping"})
if response.get("protocol") != EXPECTED_PROTOCOL:
    raise RuntimeError(
        f"node-gym version mismatch: Python wrapper expects protocol "
        f"{EXPECTED_PROTOCOL}, JS runtime reports {response.get('protocol')}. "
        f"Reinstall both halves to matching versions."
    )
```

## 3. Bundled-games duplication

**Problem.** `examples/games/` (~8K LOC, 30 games) currently ships in **both** distributions:
- npm tarball via `package.json` `files`
- Python sdist via `pyproject.toml` `tool.hatch.build.targets.sdist.include`

Users installing from both registries get two copies on disk.

**Options:**

- **(a) Accept the duplication.** Simplest. ~8K LOC isn't huge. Ship for v0.1.0, revisit if anyone complains.
- **(b) Games only in npm.** Strip `examples/games` from the Python sdist; have the Python wrapper resolve the games dir relative to the JS runtime location. Clean, but couples discovery logic harder to runtime resolution (issue #1).
- **(c) Third package.** Split `node-gym-games` as its own npm + PyPI package. Justifiable if/when games grow significantly or third-party game contributions start landing.

Recommend **(a)** for v0.1.0, **(c)** if and when the v2 3D-environment expansion ships.

## 4. CI

No CI today. Before publishing, add a GitHub Actions workflow that:

- Runs on push + PR to `main`
- Sets up Node 18+ and Python 3.11+
- Runs `./bootstrap.sh` (or installs the three tools directly)
- Runs `just install && just test`
- (Optional) Runs `just smoke` on a couple of games to catch regressions in specific game files

## 5. Publish flow

Documented for future-me:

```bash
# 1. Bump version in BOTH files (must match):
#    package.json     "version": "0.2.0"
#    pyproject.toml   version = "0.2.0"

# 2. Tag and push
git tag v0.2.0 && git push --tags

# 3. JS half
pnpm publish --access public

# 4. Python half
uv build
uv publish    # or: twine upload dist/*

# 5. Smoke test from a fresh project dir
mkdir /tmp/ng-test && cd /tmp/ng-test
pnpm add node-gym
uv venv && uv pip install node-gym
uv run python -c "from node_gym import NodeGymEnv; e = NodeGymEnv(game='flappy_bird'); e.reset(seed=0); print('ok')"
```

## 6. Repo-name / package-name considerations

- **GitHub URL.** Currently private at `github.com/heyodog0/node-gym`. Make public before announcing.
- **Naming clash.** `bobiblazeski/js-gym` (2019, dormant, 53★) is *not* the same project, but Google searches for "js gym" still surface it. README should explicitly state the differentiator: *"node-gym wraps headless JS games as Python Gymnasium envs. (Not to be confused with the unrelated 2019 `js-gym` project, which implements RL algorithms in TensorFlow.js.)"*
- **PyPI/npm reservation.** Both names are free as of 2026-04-25 — consider reserving an empty 0.0.1 placeholder soon to prevent squatting, even if the real release is months out.

## 7. v2: 3D environments

Future expansion adds Three.js + Dawn (WebGPU) games alongside the current p5.js + Matter.js stack. Implications:

- The `runtime/` boundary holds — Three.js and Dawn both run in Node, so the protocol and worker stay the same.
- New shim parallel to `runtime/p5/`: `runtime/three/` (and possibly `runtime/dawn/`).
- Game-author contract grows: a game declares which engine it needs (`p5` / `three` / `matter`) in a header comment or sidecar, and the worker loads the right shim. Auto-detection (current `"Matter." in source` check) won't scale to three engines cleanly.
- `package.json` will gain `three` and `webgpu` deps. Consider making them optional via npm `peerDependencies` or per-game lazy import to keep the core install light.

Worth scoping out before the v2 work starts so the protocol changes (if any) can be batched with a major version bump.

## 8. Tracking upstream `fast-llm-games`

This repo was extracted from `heyodog0/browserless-game-rl` (a.k.a. `fast-llm-games`) on 2026-04-25. The runtime files (`runtime/game-env.mjs`, `runtime/game-worker.mjs`, `runtime/p5/*`, `python/node_gym/env.py`) are the canonical copy here now. If you keep iterating in the parent repo on training/eval but also fix runtime bugs there, those fixes need to be ported here. Decide which repo is the source of truth for runtime code — probably this one — and either:

- Have the parent repo `pip install -e ./node-gym` (sibling clone) and stop touching the runtime files there, or
- Set up a one-way merge process (cherry-pick runtime commits from parent → here).
