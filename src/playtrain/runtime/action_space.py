"""Discrete action-space specs shared by every PlayTrain runtime.

The canonical spec lives in ``runtime/action_spaces.json`` (wheel-bundled, and
read directly by the Node runtime and the study-harness builder). An action is::

    { "name": "LEFT_D", "held": [37], "press": 32 }

``held`` keys are down for every frame of the step. ``press`` (optional) fires
the game's ``keyPressed()`` handler once before the first frame AND is down for
that frame — every runtime implements press as *held-for-the-frame plus event*,
so games polling ``keyIsDown(32)`` and games handling ``keyPressed()`` both see
it. Key codes are p5/browser keycodes (37/38/39/40 arrows, 32 space).

Index order is the Gymnasium ``Discrete(n)`` encoding. Indices 0-7 of
``default8`` are frozen — recorded trajectories, human-study sessions, and the
``native/gate_qjs.sh`` golden traces all depend on that exact mapping.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from playtrain._paths import asset as _asset

DEFAULT_SPACE = "default8"
SPEC_PATH = _asset("runtime/action_spaces.json")

_spec_cache: dict[str, list[dict]] | None = None


def _named_spaces() -> dict[str, list[dict]]:
    global _spec_cache
    if _spec_cache is None:
        with open(SPEC_PATH) as f:
            raw = json.load(f)
        _spec_cache = {k: v for k, v in raw.items() if not k.startswith("//")}
    return _spec_cache


def _validate(actions: list[dict], origin: str) -> list[dict]:
    if not actions:
        raise ValueError(f"action space {origin!r} is empty")
    out = []
    for i, a in enumerate(actions):
        held = list(a.get("held", []))
        press = a.get("press", None)
        name = a.get("name", f"A{i}")
        if not all(isinstance(k, int) and 0 < k < 256 for k in held):
            raise ValueError(f"{origin!r} action {i} ({name}): bad held keys {held}")
        if press is not None and not (isinstance(press, int) and 0 < press < 256):
            raise ValueError(f"{origin!r} action {i} ({name}): bad press key {press!r}")
        out.append({"name": str(name), "held": held, "press": press})
    return out


def load_action_space(spec: str | Sequence[dict] | None = None) -> list[dict]:
    """Resolve a space to a list of ``{name, held, press}`` dicts.

    ``spec`` may be None (default8), a name in ``action_spaces.json``, a path to
    a JSON file holding one action list, or the list itself.
    """
    if spec is None:
        spec = DEFAULT_SPACE
    if isinstance(spec, str):
        if spec.endswith(".json"):
            with open(spec) as f:
                return _validate(json.load(f), spec)
        named = _named_spaces()
        if spec not in named:
            raise ValueError(f"unknown action space {spec!r}; "
                             f"known: {sorted(named)} (or a .json path)")
        return _validate(named[spec], spec)
    return _validate(list(spec), "<inline>")


def action_names(actions: list[dict]) -> tuple[str, ...]:
    return tuple(a["name"] for a in actions)


def is_default(actions: list[dict]) -> bool:
    return actions == load_action_space(DEFAULT_SPACE)


def packed_tables(actions: list[dict]) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Flatten to the ``vec_set_actions`` C ABI arrays.

    Returns ``(held, press, n_actions, max_held)``: ``held`` is int32
    ``n_actions * max_held``, -1 padded; ``press`` is int32 ``n_actions`` with
    -1 for none. The host unions the press key into the frame's down-keys
    itself — pass the spec's ``held`` verbatim.
    """
    n = len(actions)
    max_held = max((len(a["held"]) for a in actions), default=0)
    max_held = max(max_held, 1)
    held = np.full((n, max_held), -1, dtype=np.int32)
    press = np.full(n, -1, dtype=np.int32)
    for i, a in enumerate(actions):
        for j, k in enumerate(a["held"]):
            held[i, j] = k
        if a["press"] is not None:
            press[i] = a["press"]
    return held.reshape(-1), press, n, max_held


def as_json(actions: list[dict]) -> str:
    """Compact JSON array form (what qjs_host's PLAYTRAIN_QJS_ACTIONS expects)."""
    return json.dumps(actions, separators=(",", ":"))
