# Plan: configurable discrete action spaces

Handoff document. Everything below was verified by reading the tree at `e0f26bd`
(clean `main`, no worktrees, `native/build/` empty).

## Goal

Let a PlayTrain env declare its own discrete action space — any N actions, each a
combination of held keys plus an optional press key — instead of the fixed
`Discrete(8)` that is currently compiled into four separate places.

**Non-goals.** Mouse, gamepad, and any continuous/`Box` action space. Those need
input plumbing that does not exist in any runtime (see "Out of scope" below) and
a continuous policy head in the trainer. Do not start them here.

## Why this is worth doing

The paper (§2, Interface) claims the action space "can be expanded easily and go
beyond the current keyboard setup", and cites an appendix that is currently an
empty stub (`\label{app:pt_act_obs}`). Today that claim is not demonstrable: the
mapping is a `static const` array in C++, duplicated three more times. This work
makes the discrete half of the claim true and documentable.

There is also a known modelling casualty: `Discrete(8)` cannot express
rotate-and-thrust (no `UP+D`), which is a plausible cause of weak agent scores on
some games. The human-study harness already logs `foldedRate` — the fraction of
delivered frames whose held keys were not expressible in `Discrete(8)`
(`api/session.js:55`) — so the cost of the fixed space is already measurable.

## Current state

### The action table exists in four independent copies

They agree only by convention. Any change must update all four or the paths
diverge silently.

| # | File | What |
|---|---|---|
| 1 | `native/qjs/qjs_vec_host.cpp:161,165` | `static const int HELD[8][2]`, `PRESS[8]` — the training fast path |
| 2 | `native/qjs/qjs_host.cpp:199,206` | byte-identical duplicate, single-env host |
| 3 | `runtime/p5/game-env.mjs:41-51` | `ACTIONS` array, Node.js path |
| 4 | `tools/study-templates.mjs:136-143` | the browser harness humans play in |

The canonical mapping is:

```
0 NOOP, 1 LEFT, 2 RIGHT, 3 UP, 4 DOWN, 5 D, 6 LEFT+D, 7 RIGHT+D
```

Keys are p5 keycodes: `LEFT_ARROW 37`, `UP_ARROW 38`, `RIGHT_ARROW 39`,
`DOWN_ARROW 40`, and `32` (space) as the press-event action button. The D-family
actions are *press* events, not held: the host sets the `keyCode` global and
invokes `keyPressed()` before the tick (`qjs_vec_host.cpp:452-455`).

### Other hardcoded points

- `src/playtrain/runtime/env.py:131` — `self.action_space = spaces.Discrete(8)`
- `src/playtrain/runtime/native_vec_env.py:50`, `qjs_env.py:29` — `_ACTIONS` name tuples
- `GAME_TEMPLATE.md` and `src/playtrain/gen/refine.py:71` — the generation contract
  tells the LLM "Discrete(8) controls ... must stay intact"

### Already generic — leave alone

- `src/playtrain/runtime/native_vector_env.py:60` and `vec_env.py:294` already take
  `n_actions` as a parameter; `8` is only the default.
- The trainer already infers the count: `impala/train.py:584` calls
  `_infer_action_space(env_fn)`, `ImpalaNet` and `policy.py` take `num_actions` as a
  constructor arg, and PPO reads `venv.single_action_space`. **No trainer changes
  should be needed.** If you find yourself editing `playtrain-trainers`, stop and
  re-check the assumption.

## Design

One declarative spec, four consumers.

```jsonc
// e.g. src/playtrain/runtime/action_spaces.json
{
  "default8": [
    { "name": "NOOP",    "held": [],   "press": null },
    { "name": "LEFT",    "held": [37], "press": null },
    { "name": "RIGHT",   "held": [39], "press": null },
    { "name": "UP",      "held": [38], "press": null },
    { "name": "DOWN",    "held": [40], "press": null },
    { "name": "D",       "held": [],   "press": 32 },
    { "name": "LEFT_D",  "held": [37], "press": 32 },
    { "name": "RIGHT_D", "held": [39], "press": 32 }
  ]
}
```

**Hard requirement: indices 0–7 of `default8` must stay byte-identical to today's
mapping.** Every existing game, every recorded human session, every replay trace,
and the golden checks in `native/gate_qjs.sh` depend on it.

### C ABI

Add one call; do not change `vec_step`'s signature (`const int32_t* actions` stays
one int per env — that is all a discrete space needs).

```c
void vec_set_actions(void* h, const int32_t* held, const int32_t* press,
                     int n_actions, int max_held);
```

- `held` is a flat `n_actions * max_held` array, `-1` padded.
- Replace the `static const` arrays with per-`VecHost` vectors, defaulting to
  `default8` so an unset host behaves exactly as today.
- Call it between batches, like `vec_set_frame_skip` (`qjs_vec_host.cpp:673`).

### Bounds check

`env_step` currently does `HELD[action][i]` with **no validation**
(`qjs_vec_host.cpp:450`). An out-of-range action reads out of bounds today. Add a
check as part of this work regardless of the rest.

### Widening `HELD`

`HELD` is `[8][2]`, so at most two simultaneous keys. Three-key combinations
(e.g. `LEFT+UP+D`) need `max_held` to be a real parameter, not 2. Decide early —
it changes the ABI array shape.

## Tasks, in order

1. Branch off `main`. Plain branch, not a worktree — nothing is built locally, so
   there is no parallel state to protect.
2. Build the native lib first and confirm the baseline passes *before* changing
   anything: `native/build_qjs.sh`, then `native/build_qjs_vec.sh`, then
   `native/gate_qjs.sh`. On macOS the target is `libqjs_vec.dylib`
   (`native_vec_env.py:47`). **If this does not build locally, stop and say so** —
   the change is then only verifiable on FASRC and should be kept to one small
   landable piece.
3. Add the spec file and a loader on the Python side.
4. `qjs_vec_host.cpp`: per-host vectors, `vec_set_actions`, bounds check.
5. `qjs_host.cpp`: same, so the two hosts cannot drift.
6. `game-env.mjs`: read the spec instead of the literal.
7. `tools/study-templates.mjs`: read the same spec. Note that if the harness and
   the runtime disagree, `foldedRate` silently measures the wrong thing.
8. Python: thread the spec through `vec_create` and the constructors; set
   `Discrete(n)` from it (`env.py:131`); derive `_ACTIONS` names from it.
9. Update the generation contract (`GAME_TEMPLATE.md`, `gen/refine.py:71`) so a
   game can declare a non-default space. Consider whether generated games should
   be *allowed* to vary it, or whether it stays an operator-level setting — this
   is a design decision, flag it rather than deciding silently.

## Verification

- `native/gate_qjs.sh` passes unchanged with the default spec.
- Bit-identical replay across two engines, same seed and actions, still holds —
  this underwrites the paper's determinism claim (§2, Reproducibility).
- A non-default spec (e.g. 10 actions adding `UP_D` and `DOWN_D`) runs end to end
  through both the native and Node paths and produces a `Discrete(10)` env that
  the IMPALA trainer accepts with no trainer edits.
- An out-of-range action index is rejected rather than reading out of bounds.
- Throughput on the default spec is unchanged — this is the hot loop, and the
  paper's headline numbers come from it. A per-host vector lookup should be free,
  but measure rather than assume.

## Out of scope, and why

`mouseX`, `mouseIsPressed`, and `mousePressed` appear in **none** of the runtimes
— not `runtime/p5/p5-shim.mjs`, not `native/runtime/p5.cpp`, not the QuickJS
hosts. Continuous or gamepad input therefore needs a new input channel in every
runtime, an ABI that carries floats per env rather than one int, and a continuous
policy head in the trainer. Estimated at a week-plus and touching
`playtrain-trainers`. Do not begin it as part of this change.

## Reporting back

The paper's appendix section on the action space is being written in parallel. It
needs, from this work: the final spec format, the exact default table, whether
generated games may declare their own space, and whether a non-default space was
actually demonstrated end to end. Report those four things explicitly.
