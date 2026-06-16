# Montezuma's Revenge → gym-gen port — Plan

A `games/js/montezuma_revenge.js` that **feels** like Montezuma's Revenge while fully
conforming to `GAME_TEMPLATE.md`. Faithfulness is in the **dynamics and mechanics**
(how Joe moves, jumps, climbs, dies; the player-to-room ratio; the palette) — *not* in
replicating the exact 24-room layout, the sparse-reward structure, or bit-exact RAM.

The `montezuma_revenge` entry already exists in `games/catalogs/atari_games.json`
(`mechanic: "platformer exploration, collect keys + avoid traps"`,
actions `LEFT RIGHT UP DOWN D LEFT+D RIGHT+D`).

---

## 1. The one tension, resolved

A *literal* Montezuma port would break the gym-gen contract in several places. We
honor the contract and pull "faithfulness" only from the parts that don't conflict:

| Real Montezuma | gym-gen contract | Our resolution |
|---|---|---|
| Fixed 24-room pyramid | Seed MUST drive level layout | **Seeded procedural** rooms in Montezuma's *style* (ladders, platforms, pits, a key + a door) |
| Multi-phase: keys → doors → boss | "One core mechanic", no multi-phase | **One mechanic: reach the key, then the door.** Keep it to a single key+door, not a chain |
| Sparse reward (the famous hard-exploration problem) | First reward within 20–50 steps; learnable in 1–5M | **Dense shaping**: reward progress toward key/door, sub-goals, not just the win |
| Instant death on any hazard | "Death possible but not instant"; a few lives | Keep hazards lethal but give **3–4 lives** + respawn at room entry |
| Pixel-exact 2600 art | ProcGen 64×64 flat shapes | **Montezuma palette + proportions**, ProcGen-clean shapes |

What we *do* take faithfully (the "feel"):
- **Movement dynamics** — walk speed, jump arc shape, climb speed, fall accel — from
  captured RAM movement tables (`data/ram_*.csv`).
- **Player-to-room ratio** — Joe's size vs room dimensions, derived from the native
  160×210 frame + RAM→pixel calibration.
- **Mechanic vocabulary** — run, jump gaps, climb ladders, avoid a moving hazard
  (skull/snake), grab a key, exit through a door.

---

## 2. Contract checklist (from GAME_TEMPLATE.md) — non-negotiable

- `setup()` / `draw()` / `getGameState()` / `resetGame(seed)` globals; single file, no imports.
- Action space **Discrete(8)**; read via `keyIsDown()` / `keyPressed()`. SPACE (action 5/6/7) is a **one-frame press** — use it for jump.
- `getGameState()` → `{ score:Number, lives:Number, gameState:'PLAYING'|'WIN'|'GAMEOVER' }`.
- Seeded RNG: `rng = mulberry32(seed)` (copy verbatim); **all** randomness via `rng()`.
- Canvas 256–512 px, downscaled to 64×64×3 by the runtime — author so it reads at 64×64.
- ProcGen visuals: dark bg, one hue per entity type, solid fills, **no text HUD**, no decorations.
- Episode must reach WIN/GAMEOVER; determinism (same seed+actions ⇒ identical frames).

Action mapping for this game:
`LEFT/RIGHT` = run · `UP/DOWN` = climb ladders / descend · `D (SPACE)` = jump · `LEFT+D / RIGHT+D` = running jump.

---

## 3. Two data sources (do not confuse them)

```
RAM  (dynamics)            ROM / pixels (geometry + art)
  player x/y, room           room wall/ladder/platform shapes
  per-frame dx/dy            sprite art (Joe, key, door, skull)
  enemy timers               the Montezuma palette
  lives                      player-to-room pixel ratio
     │                              │
     ▼                              ▼
  movement tables            style reference (NOT copied 1:1 —
  + feel constants            we generate our own seeded rooms)
```

RAM gives the **numbers that make it feel right**. Pixels give the **style we imitate**.
Geometry is NOT in RAM (128 bytes total) — it's rendered by the TIA, so it comes from
the captured frame PNGs, used only as art/proportion reference.

---

## 4. Capture pipeline (scaffolded — `capture/`)

| File | Role |
|---|---|
| `capture/ale_ram_logger.py` | **Primary.** ALE/Gymnasium per-frame RAM + frame-PNG logger. |
| `capture/bizhawk_log_ram.lua` | Alternative GUI emulator logger (hand frame-stepping). |
| `capture/ram_map.json` | Address map + calibration slots (all `verify:false` until confirmed). |
| `capture/walk_right.txt` | Sample movement-table action script. |
| `capture/README.md` | How to run each. |
| `data/` | Capture outputs (`ram_*.csv`, `frames_*/`). |

Install once: `uv pip install "ale-py>=0.10" "gymnasium>=1.1" pillow`.

---

## 5. Bottlenecks to respect (even for a "feel" port)

1. **RAM ≠ pixel x/y** — calibrate (`--calibrate`) before trusting positions.
2. **Per-frame, not endpoint** — the jump arc is a fixed dy *pattern*; capture it frame-by-frame.
3. **Cadence** — drive logic at fixed 60-step ticks; don't tie to wall-clock `deltaTime`.
4. **Collision feel** — Joe's effective box ≠ his sprite; tune the AABB box to where he actually stops/dies, using `climber.js`-style swept AABB as the base.
5. **Ladder state machine** — climbing suspends gravity; mind the on/off-ladder transitions (a classic source of "feels wrong").
6. **Player-to-room ratio** — author in a 160×210-proportioned world, scale up; keep Joe ≥12×12 on the source canvas (contract minimum).
7. **Reward shaping vs. fidelity** — real Montezuma's sparseness is the *opposite* of what RL needs here; lean into dense shaping and accept that divergence.

---

## 6. Build phases

**Phase 0 — Capture & calibrate** *(tooling done; data pending)*
- [ ] Install ALE deps; run `--random 600 --frames` and `--script walk_right.txt --frames`.
- [ ] Verify `ram_map.json` addresses (room/x/y/lives) against observed bytes; set `verify:true`.
- [ ] Run `--calibrate`; fill `calibration.x/y`.
- [ ] Extract **feel constants** from `data/ram_*.csv`: walk speed (px/frame), jump initial dy + gravity, climb speed, fall cap. Write them into a constants block.

**Phase 1 — One-room proof** (conforms to contract from the start)
- [ ] Fork `games/js/climber.js` structure (swept AABB, blocks/coins/enemies, camera).
- [ ] Single seeded room: floor + platforms + 1–2 ladders + a pit hazard + 1 moving skull + a key + a door.
- [ ] Plug in Phase-0 feel constants; tune collision box until movement *feels* like the captures.
- [ ] Reward: small + for moving toward key, + for key, big + for door (WIN); − on death; GAMEOVER at 0 lives.

**Phase 2 — Montezuma feel pass**
- [ ] Palette + proportions from `frames_*/` (Joe blue, key/door yellow, hazard red, walls tan — ProcGen-clean).
- [ ] Jump arc + ladder transitions matched to capture tables.
- [ ] Tune so a random agent occasionally scores (contract: easy early seeds).

**Phase 3 — Seeded variation & validate**
- [ ] Seed controls room layout, ladder/platform/pit placement, key+door positions, hazard timing — never mechanics/rewards/canvas.
- [ ] Optional: 2–3 chained rooms for "exploration" flavor (keep total learnable).
- [ ] Run gym-gen validation (`just validate montezuma_revenge`) + a `just smoke`.

---

## 7. Validation gates (GAME_TEMPLATE.md §Validation)

- [ ] `resetGame(42)` runs clean; `getGameState()` shape correct.
- [ ] 200 steps, seed 42, identical actions ⇒ bit-identical frames.
- [ ] Frames non-degenerate; reads clearly at 64×64.
- [ ] Score changes within 500 random steps; reaches WIN/GAMEOVER within 5000.
- [ ] No exceptions over 1000 random steps.
- [ ] **Feel check (human):** side-by-side with a captured clip — does jump/climb/run cadence match?

---

## 8. Open decisions (defaults chosen; flag to change)

1. **Room count** — default **single room** for Phase 1; expand to 2–3 in Phase 3. (More rooms = harder to learn.)
2. **Hazard set** — default **one moving skull** + **one static pit**. Snakes/spiders/laser-gates are optional flavor.
3. **Win condition** — default **grab key → reach door = WIN**. (Closest single-mechanic echo of the real game.)
4. **Capture emulator** — default **ALE Python**; BizHawk if you want hands-on frame-stepping.
