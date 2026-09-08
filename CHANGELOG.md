# Changelog

Versions are `0.x`: the Python API may change between minor releases.

**Environment changes are tracked separately in each release.** A game's behavior is
fixed within a minor release, so a result cites a version and stays comparable. Anything
that alters dynamics — not rendering, not performance — appears under that heading and
forces a minor bump.

## Unreleased

### Added
- Wheels bundling the native backend, so `pip install playtrain` needs no toolchain.
- `uvx playtrain` — `games` and `bench` subcommands, no install required.
- `examples/quickstart.py`, runnable straight from its URL with `uv run`.
- `playtrain[gen]` extra for the LLM generation pipeline.

### Changed
- `google-genai` and `httpx` moved out of the base dependencies into `[gen]`; stepping
  an environment no longer pulls a model SDK.
- The native backend in wheels is built for `x86-64-v2` rather than `x86-64-v3`: ~6%
  slower, but it does not fault on pre-Haswell CPUs. Building from a checkout still
  defaults to `v3`.

### Fixed
- The tester server bound to all interfaces while printing `localhost`, exposing
  unauthenticated endpoints that spend the machine's Gemini API key. Now loopback-only,
  with `--host` to widen deliberately.

### Environment changes
- None. The catalog is unchanged.
