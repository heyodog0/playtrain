# Craftax-Classic, first person, free movement (variant)

The playable sibling of `craftax_fp`. Same world, same first-person raycast,
same inventory strip — but you can **turn in place, walk backwards, and
strafe**.

**This is not a parity port.** It adds six actions to Craftax's seventeen, so
the action space, and therefore the task, is not Craftax's. An agent trained
here is not comparable to one trained on `craftax_classic`. If you want the
first-person observation *with* exact Craftax dynamics, that is `craftax_fp`
next door, and it stays that way.

## Why it exists

Craftax's `movePlayer` does this, before it moves anything:

```js
st.playerDir[0] = action;
```

unconditionally. Every direction action is a **turn and a move together**.
There is no action that changes facing without stepping, and none that steps
without changing facing. Turning in place only happens incidentally, when
something blocks you.

For an agent looking at a top-down tile view that is irrelevant. In a
first-person view it is the whole feel of the game: you cannot back away from
a zombie while watching it, and pressing left spins you a quarter *and* walks
you sideways. `craftax_fp` lives with that because its claim is exactness.
This variant does not.

## The six added actions

| # | action | facing | position |
|---|---|---|---|
| 17 | `MOVE_FORWARD` | unchanged | one cell the way you face |
| 18 | `MOVE_BACK` | unchanged | one cell behind you |
| 19 | `STRAFE_LEFT` | unchanged | one cell to your left |
| 20 | `STRAFE_RIGHT` | unchanged | one cell to your right |
| 21 | `TURN_LEFT` | a quarter left | unchanged |
| 22 | `TURN_RIGHT` | a quarter right | unchanged |

Every move goes through Craftax's **own** guards, in Craftax's order — in
bounds, not solid, not occupied — so a step is always exactly one cell and
nothing walks through a wall.

## Controls

> **UP/DOWN** walk forward and back without turning. **LEFT/RIGHT** turn in
> place. **A/D** strafe. **SPACE** interacts with the cell ahead. **TAB**
> sleeps. **1-4** place stone/table/furnace/sapling. **5-7** craft pickaxes,
> **8-9-0** craft swords. **I/J/K/L** are Craftax's original absolute moves.

Unlike `craftax_fp`, this game does **not** define `relativeArrow()`. It does
not need to: its actions are already relative, so the page sends arrows
straight through. Remapping them would turn a turn into a turn-and-step.

I/J/K/L exist because a host drives an action index by pressing that action's
keys and letting the game read them — an action with no binding would silently
become a NOOP, and the corpus gate below would then be passing for the wrong
reason.

## What is still exact

**Craftax's seventeen actions are untouched, and that is gated.** Stepped over
the whole committed corpus — 210 episodes, 49,061 steps, every action in
0..16 — this game produces `craftax_classic`'s 6,880-byte canonical state
**byte for byte, every step**, and the same 1,345-float symbolic observation.
The six new actions are strictly additional.

That is worth stating precisely, because it is a narrower claim than
`craftax_fp`'s. It says: *adding actions did not perturb the existing ones, and
the step order — which is the RNG specification — is intact.* It does **not**
say this is the same task. It is not.

The renderer is shared with `craftax_fp` by manifest path, so the frame is the
same and the cross-engine guarantee carries over: `gate_qjs.sh craftax_fp_free
3000` passes on seeds 1, 42 and 777, QuickJS against V8, observation hash
compared every step.

## How the fork is built

`src/72_move_free.js` is the only new logic, and it reuses rather than copies:

- `movePlayerFree` delegates actions 1-4 straight to Craftax's own
  `movePlayer`, so their behaviour is upstream's by construction, not by a copy
  that could drift.
- `stepGame` is **overridden** by redeclaration — the bundle is a plain
  concatenation and these are function declarations, so the later one wins and
  is what the hosts call. Two lines differ from `70_step.js`: the clamp bound
  (`NUM_ACTIONS_FREE`, or every new action would be pinned to 16) and the
  mover. The call order is untouched.

This is why the manifest must list `72_move_free.js` **after** `70_step.js`.
Everything else — worldgen, mobs, crafting, intrinsics, the renderer, the
inventory — is reused from `craftax_classic` and `craftax_fp` by path.

## Gates

```sh
uv run pytest examples/games/multifile/variants/craftax_fp_free/tests -q
```

| gate | what it holds |
|---|---|
| `test_craftax_s_own_actions_are_untouched` | 49,061 corpus steps byte-identical to craftax_classic |
| `test_turning_does_not_move_you` | the thing Craftax cannot do |
| `test_walking_does_not_turn_you` | the other thing Craftax cannot do |
| `test_forward_and_back_are_opposites` | walk out and back, same cell, same facing |
| `test_four_turns_return_you_to_the_start` | and visit all four facings |
| `test_every_action_has_its_own_key` | no action silently becomes a NOOP |
| `test_every_engine_agrees` | QuickJS vs V8, 3000 steps × 3 seeds |
| `test_it_does_not_claim_parity` | the sidecar says what this is |

## Playing it

```sh
node tools/build-pages.mjs --games examples/games/multifile/variants/craftax_fp_free/dist \
     --out dist/craftax-fp-free-play --title "Craftax first-person (free movement)"
uv run python -m http.server 8001 -d dist/craftax-fp-free-play
# http://localhost:8001/game/craftax_fp_free/
```

The smooth camera from `craftax_fp` comes along with the renderer, so turns
glide and half-turns snap.
