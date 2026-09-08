"""Action-space specs shared by every PlayTrain runtime.

The canonical spec lives in ``runtime/action_spaces.json`` (wheel-bundled, and
read directly by the Node runtime and the study-harness builder). Two kinds of
space exist:

**Discrete** — an array of actions::

    { "name": "LEFT_D", "held": [37], "press": 32,
      "pointer": [0.5, 0.5], "buttons": ["mouse"], "axes": [0.0, -1.0] }

``held`` keys are down for every frame of the step. ``press`` (optional) fires
the game's ``keyPressed()`` handler once before the first frame AND is down for
that frame. The optional analog fields set the input frame: ``pointer`` (x, y
in [0,1]^2, canvas-relative) is *latched* — it persists until another action
moves it; ``buttons`` and ``axes`` (up to 4 floats in [-1,1]) are *absolute*
per step — buttons release and axes snap back to center unless the action sets
them. A button 0->1 edge fires ``mousePressed()``.

**Box** — ``{"type": "box", "channels": [...]}`` where a channel is
``pointer_x`` / ``pointer_y`` / ``axis:0``..``axis:3`` / ``button:mouse`` /
``key:<code>``. The env exposes ``gym.spaces.Box`` over the channels and every
channel is absolute each step (button/key channels threshold at 0.5).

**Quantization (the wire contract).** Every analog value is quantized to
uint16 at the producer — ``q = floor(clamp(v01) * 65535 + 0.5)`` where
``v01`` is the value mapped into [0,1] (axes map via ``(v+1)/2``) — and
dequantized ``v01 = q / 65535`` identically in every engine. Continuous above
the wire, bit-exact below it: this is what keeps replay and the cross-engine
gate exact. Button/key channels are pressed iff ``q >= 32768``.

Index order is the Gymnasium ``Discrete(n)`` encoding. Indices 0-7 of
``default8`` are frozen — recorded trajectories, human-study sessions, and the
``native/gate_qjs.sh`` golden traces all depend on that exact mapping.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from playtrain._paths import asset as _asset

DEFAULT_SPACE = "default8"
SPEC_PATH = _asset("runtime/action_spaces.json")

# Input-frame button bits (bit0 = left mouse button).
BUTTON_BITS = {"mouse": 1}

# Box channel kinds, mirrored by the C hosts (action_table.hpp InputMap) and
# the Node runtime (game-env.mjs parseChannel).
CH_POINTER_X, CH_POINTER_Y, CH_BUTTON, CH_AXIS, CH_KEY = 0, 1, 2, 3, 4

_spec_cache: dict[str, Any] | None = None


def _named_spaces() -> dict[str, Any]:
    global _spec_cache
    if _spec_cache is None:
        with open(SPEC_PATH) as f:
            raw = json.load(f)
        _spec_cache = {k: v for k, v in raw.items() if not k.startswith("//")}
    return _spec_cache


def quantize(v01: float) -> int:
    """The wire quantization: v01 in [0,1] -> uint16. Producers only."""
    v = 0.0 if v01 < 0.0 else (1.0 if v01 > 1.0 else float(v01))
    return int(math.floor(v * 65535.0 + 0.5))


def _validate_discrete(actions: list[dict], origin: str) -> list[dict]:
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
        entry = {"name": str(name), "held": held, "press": press}
        pointer = a.get("pointer")
        if pointer is not None:
            if len(pointer) != 2 or not all(0.0 <= float(v) <= 1.0 for v in pointer):
                raise ValueError(f"{origin!r} action {i} ({name}): bad pointer {pointer}")
            entry["pointer"] = [float(pointer[0]), float(pointer[1])]
        buttons = a.get("buttons")
        if buttons:
            if not all(b in BUTTON_BITS for b in buttons):
                raise ValueError(f"{origin!r} action {i} ({name}): bad buttons {buttons}")
            entry["buttons"] = list(buttons)
        axes = a.get("axes")
        if axes:
            if len(axes) > 4 or not all(-1.0 <= float(v) <= 1.0 for v in axes):
                raise ValueError(f"{origin!r} action {i} ({name}): bad axes {axes}")
            entry["axes"] = [float(v) for v in axes]
        out.append(entry)
    return out


def parse_channel(ch: str) -> tuple[int, int]:
    """Channel string -> (kind, arg) as the C hosts encode it."""
    if ch == "pointer_x":
        return CH_POINTER_X, 0
    if ch == "pointer_y":
        return CH_POINTER_Y, 0
    if ch.startswith("button:"):
        name = ch.split(":", 1)[1]
        if name not in BUTTON_BITS:
            raise ValueError(f"unknown button {name!r} in channel {ch!r}")
        return CH_BUTTON, BUTTON_BITS[name]
    if ch.startswith("axis:"):
        idx = int(ch.split(":", 1)[1])
        if not 0 <= idx < 4:
            raise ValueError(f"axis index out of range in channel {ch!r}")
        return CH_AXIS, idx
    if ch.startswith("key:"):
        code = int(ch.split(":", 1)[1])
        if not 0 < code < 256:
            raise ValueError(f"bad key code in channel {ch!r}")
        return CH_KEY, code
    raise ValueError(f"unknown channel {ch!r}")


def _validate_box(spec: dict, origin: str) -> dict:
    channels = list(spec.get("channels", []))
    if not channels:
        raise ValueError(f"box space {origin!r} has no channels")
    for ch in channels:
        parse_channel(ch)  # raises on malformed channels
    return {"type": "box", "channels": channels}


def load_space_spec(spec: str | Sequence[dict] | dict | None = None) -> dict:
    """Resolve any space form to ``{"type": "discrete", "actions": [...]}`` or
    ``{"type": "box", "channels": [...]}``.

    ``spec`` may be None (default8), a name in ``action_spaces.json``, a path
    to a JSON file, a discrete action list, or a box dict.
    """
    if spec is None:
        spec = DEFAULT_SPACE
    origin = "<inline>"
    if isinstance(spec, str):
        origin = spec
        if spec.endswith(".json"):
            with open(spec) as f:
                spec = json.load(f)
        else:
            named = _named_spaces()
            if spec not in named:
                raise ValueError(f"unknown action space {spec!r}; "
                                 f"known: {sorted(named)} (or a .json path)")
            spec = named[spec]
    if isinstance(spec, dict):
        if spec.get("type") != "box":
            raise ValueError(f"{origin!r}: dict spaces must have type='box'")
        return _validate_box(spec, origin)
    return {"type": "discrete", "actions": _validate_discrete(list(spec), origin)}


def load_action_space(spec: str | Sequence[dict] | None = None) -> list[dict]:
    """Resolve a DISCRETE space to its action list (raises on a box space)."""
    resolved = load_space_spec(spec)
    if resolved["type"] != "discrete":
        raise ValueError("expected a discrete action space, got a box space")
    return resolved["actions"]


def action_names(actions: list[dict]) -> tuple[str, ...]:
    return tuple(a["name"] for a in actions)


def is_default(actions: list[dict]) -> bool:
    return actions == load_action_space(DEFAULT_SPACE)


def packed_tables(actions: list[dict]) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Flatten held/press to the ``vec_set_actions`` C ABI arrays.

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


def has_analog(actions: list[dict]) -> bool:
    return any("pointer" in a or "buttons" in a or "axes" in a for a in actions)


def packed_analog(actions: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Flatten the analog fields to the ``vec_set_action_analog`` C ABI arrays.

    Returns ``(qpointer[2n] uint16, has_pointer[n] uint8, buttons[n] uint32,
    qaxes[4n] uint16)``. Pointer/axes are pre-quantized here (the producer
    side of the wire contract); axes default to center (0 -> q=32768).
    """
    n = len(actions)
    qpointer = np.zeros(2 * n, dtype=np.uint16)
    has_pointer = np.zeros(n, dtype=np.uint8)
    buttons = np.zeros(n, dtype=np.uint32)
    qaxes = np.full(4 * n, quantize(0.5), dtype=np.uint16)
    for i, a in enumerate(actions):
        p = a.get("pointer")
        if p is not None:
            has_pointer[i] = 1
            qpointer[2 * i] = quantize(p[0])
            qpointer[2 * i + 1] = quantize(p[1])
        for b in a.get("buttons", []):
            buttons[i] |= BUTTON_BITS[b]
        for j, v in enumerate(a.get("axes", [])):
            qaxes[4 * i + j] = quantize((v + 1.0) / 2.0)
    return qpointer, has_pointer, buttons, qaxes


def packed_channels(channels: list[str]) -> tuple[np.ndarray, np.ndarray, int]:
    """Box channels -> ``vec_set_input_map`` arrays (kinds, args, n)."""
    kinds = np.empty(len(channels), dtype=np.int32)
    args = np.empty(len(channels), dtype=np.int32)
    for i, ch in enumerate(channels):
        kinds[i], args[i] = parse_channel(ch)
    return kinds, args, len(channels)


def quantize_box_actions(values: np.ndarray, channels: list[str]) -> np.ndarray:
    """Float actions (..., k) -> uint16 wire values, per the channel ranges.

    Pointer channels expect [0,1]; every other channel expects [-1,1] and maps
    via (v+1)/2 (button/key channels: pressed iff the wire value >= 32768,
    i.e. v > 0). Values are clamped to their range before quantizing.
    """
    v = np.asarray(values, dtype=np.float64)
    if v.shape[-1] != len(channels):
        raise ValueError(f"expected {len(channels)} channels, got shape {v.shape}")
    v01 = np.empty_like(v)
    for i, ch in enumerate(channels):
        kind, _ = parse_channel(ch)
        if kind in (CH_POINTER_X, CH_POINTER_Y):
            v01[..., i] = np.clip(v[..., i], 0.0, 1.0)
        else:
            v01[..., i] = (np.clip(v[..., i], -1.0, 1.0) + 1.0) / 2.0
    return np.floor(v01 * 65535.0 + 0.5).astype(np.uint16)


def as_json(actions: list[dict]) -> str:
    """Compact JSON array form (what qjs_host's PLAYTRAIN_QJS_ACTIONS expects)."""
    return json.dumps(actions, separators=(",", ":"))
