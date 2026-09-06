# Plan: continuous input (mouse / gamepad) via input frames

Working document, 2026-08-22. Builds on the configurable discrete action-space
work (branch `action-spaces`, `c4e9d12`) and the design discussion behind it.
Companion docs: `ACTION_SPACE_PLAN.md` (executed), `PLAYTRAIN_3D_PLAN.md`.

**STATUS (2026-08-22, branch `continuous-input`, `9ff7ad0` + trainers
`continuous-input` `2d1b087`): Phases 1 and 2 executed** — input frames in all
runtimes + browser tester, `aimgrid18`/`mouse2d`/`gamepad2s` spaces, the
`aim_trainer` reference pointer game, `vec_step_q`/`vec_set_input_map`/
`vec_set_action_analog` ABI, box `gym.spaces.Box` support in QuickJSEnv /
PlayTrainEnv / NativeVecEnv, `ActorCritic(continuous=True)` + `train_ppo_box`.
Verified: box AND discrete-analog paths bit-exact V8-vs-QuickJS (3 seeds each);
vec-vs-single bit-exact; default gate + 87 tests byte-identical/green; hot loop
unchanged (434k vs 430k best, within noise). **Learning demonstrated**:
continuous mouse2d PPO on aim_trainer reaches mean return 13.2 vs random 4.44
(2.5M steps, ~4k sps on M4 Pro MPS; needed proximity shaping + log_std init
−1.0 — std 1.0 saturates a clamped [0,1] channel). Still open (Phase 2/3 tail): box
on the async/PingPong host and PlayTrainVecEnv, full train_ppo_clean box
integration, gamepad browser capture (Gamepad API), study-harness pointer
logging, generation-catalog pointer games.

## Goal

Let policies emit continuous (or hybrid) actions — pointer position, analog
stick — and let games read them through idiomatic p5 input (`mouseX`, `mouseY`,
`mouseIsPressed`, `mousePressed()`), without giving up the platform's pillars:
bit-exact cross-engine replay, seeded determinism, the discrete fast path's
throughput, and human-play identity.

## The design principle: quantize at the wire

**Continuous above the interface, bit-exact below it.** The runtimes never see
raw floats from a policy or a human. They see an *input frame* whose analog
channels are fixed-point (uint16 per axis, dequantized identically in every
engine — same spirit as the frozen fdlibm transcendentals). At 64×64 obs this
is indistinguishable from continuous for the policy, but the gate, replay
verification, and human-session logs stay exactly reproducible. Without this,
continuous input and the determinism story are mutually exclusive; with it,
they compose.

## Three layers

### 1. Input frame (new substrate)

Per env, per step:

```
struct InputFrame {          // wire form; all runtimes decode identically
  held_keys[]                // key codes down this step (as today)
  press_key                  // optional keyPressed() event   (as today)
  pointer_x, pointer_y       // uint16 fixed-point in [0,1]^2, canvas-relative
  buttons                    // bitmask: mouse-down, right, gamepad A/B...
  axes[4]                    // uint16 fixed-point in [-1,1], stick x/y etc.
}
```

Games read p5 idioms; the runtime sets globals from the frame before `draw()`
(`mouseX = pointer_x * width`, etc. — dequantization spec is part of the
contract). `mousePressed()` fires on button rising edge, mirroring
`simulateKeyPress`'s one-frame semantics. Gamepad = the same axes/buttons
channels; no separate mechanism.

Touch points (the same four the ActionTable work unified):
`runtime/p5/p5-shim.mjs`, `native/runtime/p5.{hpp,cpp}` (per-env state, like
`setKeysDown`), both QuickJS hosts via a shared-header extension, and the
study/tester browser harness (which *captures* real pointer events, quantizes
them at source, and logs input frames — replay is then bit-exact by
construction, and `foldedRate` ceases to exist for pointer games).

### 2. Action spaces = mappings onto input frames

`runtime/action_spaces.json` grows two things:

- **Discrete entries gain analog fields** (DMLab-style fixed deltas):
  `{ "name": "AIM_NE_FIRE", "axes": [0.7, -0.7], "buttons": ["mouse"] }`.
  Still Categorical, trainers untouched (proven by the thrust10 run).
- **A continuous entry type**:
  ```jsonc
  "mouse2d": { "type": "box",
    "channels": ["pointer_x", "pointer_y", "button:mouse"],
    // button channels thresholded at 0.5 -> one Gaussian head, no hybrid policy
  }
  ```
  Resolved by the same loader; `env.action_space` becomes
  `gym.spaces.Box(-1, 1, (k,))`.

Humans/replays bypass this layer — they produce input frames directly.

### 3. Policy heads

- Discrete presets: Categorical everywhere (IMPALA + PPO), unchanged.
- Continuous: **PPO only**, tanh-squashed Gaussian head (CleanRL continuous
  variants as reference). The historical 3D vec path already prototyped
  per-env `Float32Array(7)` actions (`threejs-archive:runtime/three/vec-game-env.mjs`).
- IMPALA continuous: explicitly out of scope — V-trace with continuous actions
  is nonstandard and the stack assumes int actions down to the actor wire
  protocol (`remote_proto.py`). Do not start it as part of this.

## ABI

Keep `vec_step` (one int32 per env) byte-for-byte as-is — the discrete fast
path must not pay anything. Add:

```c
// actions: n_envs * action_dim floats in [-1,1]; the host quantizes to the
// input-frame wire format (spec'd rounding) before the frame is applied.
void vec_step_f(void* h, const float* actions, int action_dim,
                uint8_t* obs, float* rew, uint8_t* term, uint8_t* trunc);
void vec_set_input_map(void* h, /* channel spec, mirroring vec_set_actions */);
```

Quantization happens host-side so every consumer (Python, Node, browser
harness) sees identical dequantized values. `qjs_host` serve protocol gains a
float step command; `game-worker.mjs` a float action message.

## Trainer changes (playtrain-trainers)

- `train_ppo_clean`: Gaussian head + Box-space branch in the agent class,
  logprob/entropy for Normal, prev-action feed becomes the raw float vector
  instead of one-hot. Moderate, well-understood.
- Eval/bench plumbing that assumes `n_actions` int: audit
  (`ppo_eval.py`, `policy.py` constructor paths).
- IMPALA: untouched (discrete-only documented).

## Contract & validation

- `GAME_TEMPLATE.md`: a "pointer tier" — games may read mouse globals; must
  remain playable by the random-agent check under the declared space.
- Validator: for a Box-space game, the random-action check samples uniform in
  the Box; determinism check unchanged (input frames are exact).
- Generated-game policy: same as the discrete decision — the space a game is
  *authored for* is declared per game (catalog metadata), but the 2D catalog
  default stays default8; pointer games are a new family, not a migration.

## Tasks, in order

**Phase 1 — input frames + discrete analog presets (~3-4 days). Ships mouse
games; trainers untouched.**
1. Wire-format spec (quantization + dequantization, documented in the template).
2. p5-shim + study/tester harness: pointer globals, event capture, frame logging.
3. `p5.cpp` per-env pointer/axes state; shared-header InputFrame; both hosts.
4. Discrete entries with `axes`/`buttons`/`pointer` fields; loader + ActionTable extension.
5. One hand-written pointer game (e.g. aim-trainer); gate it cross-engine
   (this proves the quantized channel is bit-exact end to end).
6. Full existing gate + tests stay byte-identical (default path untouched).

**Phase 2 — Box spaces + float ABI + PPO (~1.5-2 weeks incl. training runs).**
7. `vec_step_f` + input-map ABI + Python `Box` action_space support.
8. PPO Gaussian head; train on the pointer game; compare vs the best discrete
   preset on the same game — that comparison is the paper-grade artifact.
9. Node worker float path (portability parity).

**Phase 3 — ecosystem.** Template tier docs, an examples/ walkthrough
("declare a space in JSON, write a game against p5 input, train with the
provided PPO config"), gamepad preset. Third parties add control schemes with
zero C++/trainer changes — same extensibility story as the discrete work,
one level deeper.

## Verification

- Existing gate + 81-test suite byte-identical (Phase 1 is purely additive).
- New pointer game passes the cross-engine gate bit-exact with quantized
  pointer trajectories (the load-bearing new check).
- A human session on the pointer game replays to the same score.
- PPO-Box agent trains to non-trivial score; discrete-vs-continuous comparison
  on the same game reported.
- `vec_step` throughput unchanged (A/B, as done for the ActionTable change).

## Out of scope

IMPALA continuous; touch input; mouse for the existing catalog games
(they're keyboard games; pointer games are a new family); 3D — though the
input-frame substrate is deliberately the same thing the 3D vec prototype
wanted (`Float32Array` actions), so PlayTrain-3D inherits this for free.

## Reporting back

1. The wire-format spec (quantization bits, dequantization formula).
2. Whether the pointer game gated bit-exact cross-engine.
3. Discrete-preset vs continuous-PPO scores on the same game.
4. Throughput deltas (discrete path must be zero; float path measured).
