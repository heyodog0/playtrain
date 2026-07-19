# Beamrider — mechanics bible

Faithful design spec distilled from the Activision 1983 manual + Wikipedia + ALE.
This is the "reference layer" that Atari games lack (procgen games get `procgen_src/*.cpp`;
Atari games only had a one-line `mechanic`). Feed this to the generator instead of a slogan.

Sources:
- AtariAge manual (HTML): https://atariage.com/manual_html_page.php?SoftwareID=860
- Wikipedia: https://en.wikipedia.org/wiki/Beamrider
- ALE env: https://ale.farama.org/environments/beam_rider/

> Numbers marked *(approx)* are RL-tuned for reward shaping — the original exact point
> values aren't cleanly documented online. Relative magnitudes preserve the game's feel
> (saucer < torpedo kill < Sentinel). Everything else is faithful to the original.

## The view — this is what makes it *Beamrider*

- Black space. A **perspective grid of 5 vertical "beams" (lanes)** fans out from a single
  **vanishing point** near top-center down to 5 evenly-spaced points across the bottom.
  Draw the beams as thin lines converging to the vanishing point.
- The player **Light Ship** sits at the **bottom** and occupies exactly **one of the 5 beams**.
  It never moves vertically — only snaps between beams.
- Enemies **spawn at the vanishing point** and **travel down a beam toward the player**,
  **growing larger as they approach** (perspective scaling). This rushing-toward-you cadence
  is the core feel — not a flat vertical shooter.

## Controls (mapped onto template Discrete(8))

| Action | Effect |
|---|---|
| LEFT / RIGHT | Snap the ship one beam left/right (discrete lane change, clamp at edges). |
| D (fire) | Fire **laser** up the current beam. Unlimited, ~8–12 frame cooldown. |
| UP (torpedo) | Fire **torpedo** up the current beam. **Only 3 per sector** (ammo counter). |

The **laser-vs-torpedo economy is central**: torpedoes are scarce and are the *only* way to
kill the Sentinel and certain enemies. Spending them carelessly is the key mistake.

## Enemies (spawn at vanishing point, descend a beam, scale up)

| Enemy | Color | Intro sector | Rule |
|---|---|---|---|
| Enemy Saucer | White | 1 | **Primary target.** Destroy with laser. Kill **15 to clear the sector.** |
| Space Debris | Brown | 2 | **Cannot be shot — must be dodged** by changing beams. Collision = lose a life. |
| Chirper | Yellow | 4 | Destroyed by laser (points, optional). |
| Blocker / Bounce | Green | 6/8 | Dodge only. |
| Charger / Zig Bomb | Blue/Red | 10/14 | Laser deflects but doesn't kill — dodge. |

For learnability keep **2–3 types live at once** (white saucer + brown debris + one torpedo-only
threat). Enemies may **jitter between adjacent beams** as they descend, forcing the player to
track and re-align.

## Sentinel Ship

After the **15 white saucers** are destroyed, a **Sentinel Ship crosses horizontally** across
the top. Hit it with a **torpedo** for a big bonus (**+ bonus per remaining torpedo**). Then the
sector clears: respawn enemies, **refill torpedoes to 3**, and **increase enemy speed / spawn rate**.

## Yellow Rejuvenator (power-up)

Occasionally descends a beam. **Catch it** (ship touches it) → **+1 life**. **Shoot it** → it turns
into **damaging debris** (collision = lose a life). Encodes a "don't shoot everything" decision.

## Lives / terminal

- Start with **3 lives**. Lose one on: collision with debris, a saucer reaching your beam,
  or self-made debris from a shot Rejuvenator.
- `0 lives → GAMEOVER`. Reaching a target sector (e.g. sector 4) may fire `WIN`, else GAMEOVER-driven.

## Scoring (RL-tuned; relative feel preserved)

| Event | Points |
|---|---|
| White saucer via laser | +25 |
| Enemy killed via torpedo | +50 |
| Sentinel via torpedo | +300, plus +50 per remaining torpedo |
| Catch a Rejuvenator | +100 (and +1 life) |
| Clear a sector | +200 |
| Wasted shot / lose a life | no negative reward (lost future score is signal enough) |

## What the seed controls

Spawn beam choices, spawn timing, per-spawn enemy-type mix, Rejuvenator timing/beam, Sentinel
crossing direction. Seed must **not** change speeds, rules, or scoring.

## Faithfulness checklist (the things the one-liner dropped)

- [ ] Lane-snapped movement across a **converging perspective grid** (not free horizontal)
- [ ] Enemies **descend the beams** and **scale up** with perspective
- [ ] **Laser (unlimited) vs torpedo (3/sector)** economy
- [ ] **15 saucers → Sentinel → sector clear** loop
- [ ] **Brown debris must be dodged**, not shot
- [ ] **Rejuvenator**: catch = life, shoot = hazard
