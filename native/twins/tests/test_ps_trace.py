"""T4 (PuzzleScript): `twin_host trace` is byte-identical to native/reference_trace.mjs (V8 + wasm rasterizer, what the
models were trained on), observation hashes included, for every bundle, 300 steps, seeds 1 and 42, in rgb mode and in
symbolic mode (PLAYTRAIN_OBS_MODE=symbolic vs TWIN_OBS_MODE=symbolic: the multihot getObservation bytes)."""
import json
import os
import subprocess

import pytest
from conftest import HOST, PARITY, REPO, ensure_built

DIST = PARITY / "puzzlescript" / "dist"
GAMES = sorted(p.stem for p in DIST.glob("ps_*.js"))


def test_corpus_size():
    assert len(GAMES) == 17


@pytest.mark.parametrize("game", GAMES)
def test_trace_matches_v8_reference(game):
    ensure_built()
    env = {**os.environ, "PLAYTRAIN_GAMES_DIR": str(DIST)}
    env.pop("PLAYTRAIN_ACTION_SPACE", None)
    for seed in ("1", "42"):
        ref = subprocess.run(["node", str(REPO / "native" / "reference_trace.mjs"), game, seed, "300"], cwd=REPO / "native", capture_output=True, text=True, env=env)
        tw = subprocess.run([str(HOST), str(DIST / f"{game}.js"), "trace", seed, "300"], capture_output=True, text=True)
        assert ref.returncode == 0 and tw.returncode == 0, ref.stderr[-1000:] + tw.stderr[-1000:]
        assert ref.stdout == tw.stdout, f"{game} seed {seed}: first difference:\n" + next((f"ref: {a}\ntwin: {b}" for a, b in zip(ref.stdout.split("\n"), tw.stdout.split("\n")) if a != b), "(length)")


@pytest.mark.parametrize("game", GAMES)
def test_symbolic_trace_matches_v8_reference(game):
    ensure_built()
    dim = json.loads((DIST / f"{game}.json").read_text())["obs"]["symbolic"]
    env = {**os.environ, "PLAYTRAIN_GAMES_DIR": str(DIST), "PLAYTRAIN_OBS_MODE": "symbolic"}
    env.pop("PLAYTRAIN_ACTION_SPACE", None)
    tenv = {**os.environ, "TWIN_OBS_MODE": "symbolic", "TWIN_SYMBOLIC_DIM": str(dim)}
    for seed in ("1", "42"):
        ref = subprocess.run(["node", str(REPO / "native" / "reference_trace.mjs"), game, seed, "300"], cwd=REPO / "native", capture_output=True, text=True, env=env)
        tw = subprocess.run([str(HOST), str(DIST / f"{game}.js"), "trace", seed, "300"], capture_output=True, text=True, env=tenv)
        assert ref.returncode == 0 and tw.returncode == 0, ref.stderr[-1000:] + tw.stderr[-1000:]
        assert ref.stdout == tw.stdout, f"{game} seed {seed} (symbolic): first difference:\n" + next((f"ref: {a}\ntwin: {b}" for a, b in zip(ref.stdout.split("\n"), tw.stdout.split("\n")) if a != b), "(length)")
