# Contributing

## Development setup

You need Python ≥3.11, a C/C++ toolchain (clang), the Rust toolchain (cargo),
[`uv`](https://docs.astral.sh/uv/) and [`just`](https://just.systems). `./bootstrap.sh`
installs whichever of uv/just are missing.

```bash
just install      # uv sync + build the native QuickJS backend
just test         # the runtime test suite
just --list       # everything else
```

`just install` builds the native backend with `native/build_qjs.sh` and
`build_qjs_vec.sh`. That backend is the default runtime engine, not an optional add-on.
The build takes about a minute from cold and fetches quickjs-ng and openlibm.

Node is not required for the runtime. `just install-web` adds it. It is only needed for
the playable-page builders and `just play`.

`just wheel` builds the distributable wheel exactly as CI does, native backend bundled.

## Adding a game

[`GAME_TEMPLATE.md`](GAME_TEMPLATE.md) is the contract. It covers the p5 lifecycle
(`setup` and `draw`), the RL interface (`getGameState` and `resetGame(seed)`), the
`default8` action space, and the 64x64x3 observation.

New games go in `examples/games/js/`. That is the shipped catalog, what `GameEnv("name")`
loads, and what every experiment in the paper used. `games/js/` is the generation
workspace.

Validate before opening a PR:

```bash
just validate-one <game>    # the 5-check suite
just bench-one <game>       # throughput
```

## Changing an environment's behavior

Games are versioned with the package. Behavior is fixed within a minor release so
published results stay comparable. A change that alters dynamics, rather than only
rendering, needs a note in the Environment changes section of
[CHANGELOG.md](CHANGELOG.md) and a minor version bump. Silent dynamics changes are the
one thing that makes the catalog untrustworthy as a benchmark.

## Changing the native backend

Two gates must pass, and both are cheap:

```bash
bash native/gate_qjs.sh                      # determinism across engine paths
python native/aotfork/gate_async.py          # the async/double-buffered path
```

`gate_async.py` exists because an ownership bug once made double-buffering about 6x
slower on every game while every sync-path gate stayed green. Any change that lets work
migrate between threads needs it.

## Benchmarks

[BENCHMARKS.md](BENCHMARKS.md) states the methodology. It says which of the three access
paths is being measured, how aggregation works, and why a number is or is not
comparable. Read it before quoting a throughput figure. The easiest mistake is measuring
the pipe path and reporting it as the engine's cost.

## Style

Match the surrounding code. Comments explain why, not what. The existing ones are the
reference for the expected density and register.
